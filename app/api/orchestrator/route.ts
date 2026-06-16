/**
 * POST /api/orchestrator
 *
 * Advances the state machine for a given spec.  The orchestrator handles all
 * transitions from draft through deployed, including the build→test loop.
 *
 * Request body:
 *   { specId: string }
 *
 * Response (200):
 *   { status: WorkflowSpec["status"]; detail?: string }
 *
 * Response (4xx/5xx):
 *   { error: string }
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { advance } from "@/lib/orchestrator";

const bodySchema = z.object({
  specId: z.string().uuid("specId must be a UUID"),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { specId } = parsed.data;

  try {
    const result = await advance(specId);
    return Response.json(result, { status: 200 });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Orchestrator failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
