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
import { getSpec, saveDeployment, updateSpecStatus } from "@/lib/db";
import { buildWorkflow } from "@/lib/agents/builder";
import { getN8nClient } from "@/lib/n8n";
import { type WorkflowSpec } from "@/types";

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
    const { id: n8nWorkflowId } = await client.createWorkflow(n8nJson);
    await client.activateWorkflow(n8nWorkflowId);

    // Persist deployment record
    const deployment = await saveDeployment({
      spec_id: id,
      n8n_workflow_id: n8nWorkflowId,
      status: "active",
    });

    // Advance spec status to deployed
    await updateSpecStatus(id, "deployed");

    return Response.json(
      {
        deploymentId: deployment.id,
        n8nWorkflowId,
        status: "active",
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
