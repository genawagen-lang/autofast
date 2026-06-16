/**
 * POST /api/spec/[id]/test
 *
 * Wraps the Testing Agent.  Accepts an optional n8nJson body; if omitted,
 * re-runs the Builder Agent first to get fresh workflow JSON.
 *
 * Request body (optional):
 *   { n8nJson?: unknown }
 *
 * Response (200):
 *   { pass: boolean; preview?: string; reason?: string; failedNode?: string }
 *
 * Response (4xx/5xx):
 *   { error: string }
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { getSpec } from "@/lib/db";
import { buildWorkflow } from "@/lib/agents/builder";
import { testWorkflow } from "@/lib/agents/testing";
import { type WorkflowSpec } from "@/types";

const paramsSchema = z.object({ id: z.string().uuid() });

const bodySchema = z
  .object({ n8nJson: z.unknown().optional() })
  .optional()
  .default({});

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

  let body: { n8nJson?: unknown } = {};
  try {
    const raw = await request.json().catch(() => ({}));
    const bodyParsed = bodySchema.safeParse(raw);
    if (bodyParsed.success) body = bodyParsed.data;
  } catch {
    // body is optional; keep the default
  }

  try {
    const spec = row.spec as unknown as WorkflowSpec;
    const userId = row.user_id;

    // Use provided n8nJson or (re)build from the spec
    const n8nJson =
      body.n8nJson !== undefined
        ? body.n8nJson
        : (await buildWorkflow(spec)).n8nJson;

    const result = await testWorkflow({ userId, spec, n8nJson });
    return Response.json(result, { status: 200 });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Testing agent failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
