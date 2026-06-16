/**
 * POST /api/spec/[id]/build
 *
 * Triggers the Builder Agent for the given spec and returns the built n8n
 * workflow JSON and credential requirements.
 *
 * Requires the spec to exist and belong to the authenticated user.
 * Does not change the spec's status — that is the orchestrator's job.
 *
 * Response (200):
 *   { n8nJson: unknown; required_credentials: string[]; template_id: string }
 *
 * Response (4xx/5xx):
 *   { error: string }
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { getSpec } from "@/lib/db";
import { buildWorkflow } from "@/lib/agents/builder";
import { type WorkflowSpec } from "@/types";

const paramsSchema = z.object({ id: z.string().uuid() });

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

  try {
    const spec = row.spec as unknown as WorkflowSpec;
    const result = await buildWorkflow(spec);
    return Response.json(result, { status: 200 });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Builder agent failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
