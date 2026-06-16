// Returns the connection status for each provider.
// Called by the connections page to show Connected / Not connected pills.
// Never returns raw tokens — only boolean status per provider.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const PROVIDERS = ["google_sheets", "send_email", "telegram"] as const;

type CredentialStatus = {
  provider: string;
  connected: boolean;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let listCredentialStatuses:
    | ((userId: string) => Promise<{ provider: string; status: string }[]>)
    | null = null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db = require("@/lib/db");
    listCredentialStatuses = db.listCredentialStatuses;
  } catch {
    // lib/db not available (sibling in progress) — return all as disconnected
  }

  if (!listCredentialStatuses) {
    const statuses: CredentialStatus[] = PROVIDERS.map((p) => ({
      provider: p,
      connected: false,
    }));
    return NextResponse.json(statuses);
  }

  try {
    const rows = await listCredentialStatuses(user.id);
    const statuses: CredentialStatus[] = PROVIDERS.map((provider) => {
      const row = rows.find((r) => r.provider === provider);
      return {
        provider,
        connected: row?.status === "active",
      };
    });
    return NextResponse.json(statuses);
  } catch {
    // DB error — return safe fallback
    return NextResponse.json(
      PROVIDERS.map((p) => ({ provider: p, connected: false }))
    );
  }
}
