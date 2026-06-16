// Fetches a single WorkflowSpec by ID.
// Used by the workflow detail page to display the spec in plain language.
// Returns { spec: WorkflowSpec } — never exposes internal implementation details.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { WorkflowSpec } from "@/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let getSpec:
    | ((specId: string) => Promise<{ spec: unknown; user_id: string } | null>)
    | null = null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db = require("@/lib/db");
    getSpec = db.getSpec;
  } catch {
    // lib/db not available — return 404
  }

  if (!getSpec) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const row = await getSpec(id);
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Ensure the spec belongs to the requesting user
    if (row.user_id !== user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ spec: row.spec as WorkflowSpec });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
