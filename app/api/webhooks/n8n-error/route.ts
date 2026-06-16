/**
 * POST /api/webhooks/n8n-error
 *
 * Receives failed-run payloads from n8n's error-workflow feature and persists
 * the error so the dashboard can surface it in plain language.
 *
 * n8n sends a POST with a JSON body containing at minimum:
 *   {
 *     workflow: { id: string; name: string };
 *     execution: { id: string; error: { message: string; node?: { name: string } } };
 *   }
 *
 * We extract the workflow id and error message, then call updateDeploymentError
 * so the DeploymentRow.last_error column is updated.
 *
 * This endpoint is intentionally permissive about the payload shape so that
 * minor changes to n8n's error payload format don't break error capture.
 *
 * Response (200): { ok: true }
 * Response (4xx): { error: string }
 */

import { NextRequest } from "next/server";
import { updateDeploymentError } from "@/lib/db";

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  // Extract workflow id and error message using optional chaining so we
  // gracefully handle unexpected payload shapes.
  const p = payload as Record<string, unknown>;

  const workflowBlock = p["workflow"] as Record<string, unknown> | undefined;
  const executionBlock = p["execution"] as Record<string, unknown> | undefined;

  const n8nWorkflowId =
    typeof workflowBlock?.["id"] === "string" ? workflowBlock["id"] : null;

  let errorMessage = "An error occurred during workflow execution.";
  if (executionBlock) {
    const errBlock = executionBlock["error"] as Record<string, unknown> | undefined;
    if (typeof errBlock?.["message"] === "string" && errBlock["message"]) {
      const nodeName =
        typeof (errBlock["node"] as Record<string, unknown> | undefined)?.["name"] === "string"
          ? ` (at node: ${(errBlock["node"] as Record<string, unknown>)["name"]})`
          : "";
      errorMessage = `${errBlock["message"]}${nodeName}`;
    }
  }

  if (!n8nWorkflowId) {
    // Log but do not error — we don't want n8n to retry indefinitely
    console.warn("[n8n-error webhook] Missing workflow.id in payload", payload);
    return Response.json({ ok: true }, { status: 200 });
  }

  try {
    await updateDeploymentError(n8nWorkflowId, errorMessage);
  } catch (err: unknown) {
    // Failure to persist is non-fatal — we still ack to n8n
    console.error(
      "[n8n-error webhook] Failed to persist error",
      err instanceof Error ? err.message : err
    );
  }

  return Response.json({ ok: true }, { status: 200 });
}

export async function GET() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
