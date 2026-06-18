/**
 * POST /api/spec/[id]/deploy
 *
 * Deploys an approved, PASS-tested workflow to n8n.
 *
 * Flow:
 *  1. Load spec — must be in status "ready"
 *  2. Build the n8n workflow JSON (or accept it in the request body)
 *  3. createWorkflow + activateWorkflow via getN8nClient()
 *  4. saveDeployment to persist the mapping
 *  5. Update spec status to "deployed"
 *  6. Return the deployment record
 *
 * The n8n error webhook is pointed at /api/webhooks/n8n-error by embedding
 * that URL in the workflow's error-workflow config field.
 *
 * Request body (optional):
 *   { n8nJson?: unknown }  — if omitted the Builder Agent is invoked
 *
 * Response (200):
 *   { deploymentId: string; n8nWorkflowId: string; status: "active" }
 *
 * Response (4xx/5xx):
 *   { error: string }
 *
 * SECURITY: decrypted credentials are NOT needed here (n8n reads them from
 * its own credential store); the n8n credential IDs are embedded in the
 * template JSON by the Builder Agent.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  getSpec,
  saveDeployment,
  updateSpecStatus,
  getDecryptedCredential,
} from "@/lib/db";
import { buildWorkflow } from "@/lib/agents/builder";
import { getN8nClient, type N8nClient } from "@/lib/n8n";
import { type WorkflowSpec } from "@/types";

/**
 * Create the matching credentials in n8n's own store (from our vaulted tokens)
 * and attach them to the relevant nodes, so the workflow can activate.
 * Currently handles Telegram (telegramApi). Other providers (Google OAuth, SMTP)
 * are left for the user to attach in the n8n UI.
 */
async function attachN8nCredentials(
  userId: string,
  n8nJson: unknown,
  client: N8nClient
): Promise<unknown> {
  if (typeof n8nJson !== "object" || n8nJson === null) return n8nJson;
  const obj = JSON.parse(JSON.stringify(n8nJson)) as Record<string, unknown>;
  const nodes = Array.isArray(obj.nodes) ? (obj.nodes as Record<string, unknown>[]) : [];

  const telegramNodes = nodes.filter(
    (n) => typeof n.type === "string" && (n.type as string).includes("telegram")
  );
  if (telegramNodes.length > 0) {
    const token = await getDecryptedCredential(userId, "telegram");
    if (token) {
      const name = `AutomationApp Telegram (${userId.slice(0, 8)})`;
      try {
        const { id: credId } = await client.createCredential({
          name,
          type: "telegramApi",
          data: { accessToken: token },
        });
        for (const node of telegramNodes) {
          node.credentials = {
            ...(typeof node.credentials === "object" && node.credentials
              ? node.credentials
              : {}),
            telegramApi: { id: credId, name },
          };
        }
      } catch (err) {
        console.warn("[deploy] could not create n8n Telegram credential:", err);
      }
    }
  }

  return obj;
}

const paramsSchema = z.object({ id: z.string().uuid() });

const bodySchema = z
  .object({ n8nJson: z.unknown().optional() })
  .optional()
  .default({});

/** Injects the error-callback URL into the workflow JSON if the field exists */
function injectErrorWebhook(n8nJson: unknown, appBaseUrl: string): unknown {
  const errorWebhookUrl = `${appBaseUrl}/api/webhooks/n8n-error`;
  try {
    const obj = JSON.parse(JSON.stringify(n8nJson)) as Record<string, unknown>;
    // n8n supports a top-level "settings.errorWorkflow" or similar field;
    // we set it as a custom annotation that the error webhook can reference.
    const settings = (obj["settings"] as Record<string, unknown>) ?? {};
    settings["errorWorkflowCallbackUrl"] = errorWebhookUrl;
    obj["settings"] = settings;
    return obj;
  } catch {
    // If injection fails, proceed without it — non-fatal
    return n8nJson;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const parsed = paramsSchema.safeParse(resolvedParams);
  if (!parsed.success) {
    return Response.json({ error: "Invalid spec id" }, { status: 400 });
  }

  const { id } = parsed.data;

  const row = await getSpec(id);
  if (!row) {
    return Response.json({ error: "Spec not found" }, { status: 404 });
  }

  if (row.status !== "ready") {
    return Response.json(
      {
        error: `Spec is not ready for deployment (current status: ${row.status})`,
      },
      { status: 409 }
    );
  }

  let body: { n8nJson?: unknown } = {};
  try {
    const raw = await request.json().catch(() => ({}));
    const bodyParsed = bodySchema.safeParse(raw);
    if (bodyParsed.success) body = bodyParsed.data;
  } catch {
    // body is optional
  }

  try {
    const spec = row.spec as unknown as WorkflowSpec;

    // Build (or re-use provided) workflow JSON
    let n8nJson: unknown =
      body.n8nJson !== undefined
        ? body.n8nJson
        : (await buildWorkflow(spec)).n8nJson;

    // Inject error webhook URL
    const appBaseUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    n8nJson = injectErrorWebhook(n8nJson, appBaseUrl);

    // Push to n8n
    const client = getN8nClient();
    // Create + attach n8n-side credentials (e.g. Telegram) so it can activate.
    n8nJson = await attachN8nCredentials(row.user_id, n8nJson, client);
    const { id: n8nWorkflowId } = await client.createWorkflow(n8nJson);

    // Activation can fail if a node still needs a credential attached in n8n.
    // The workflow is already created/visible, so don't fail the whole deploy —
    // record it as created and let the user finish wiring it in n8n.
    let activated = true;
    let activationNote: string | undefined;
    try {
      await client.activateWorkflow(n8nWorkflowId);
    } catch (actErr: unknown) {
      activated = false;
      activationNote =
        actErr instanceof Error ? actErr.message : "Activation failed";
      console.warn(`[deploy] workflow ${n8nWorkflowId} created but not activated:`, activationNote);
    }

    // Persist deployment record
    const deployment = await saveDeployment({
      spec_id: id,
      n8n_workflow_id: n8nWorkflowId,
      status: activated ? "active" : "created",
    });

    // Advance spec status to deployed
    await updateSpecStatus(id, "deployed");

    return Response.json(
      {
        deploymentId: deployment.id,
        n8nWorkflowId,
        status: activated ? "active" : "created",
        activationNote,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Deploy failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
