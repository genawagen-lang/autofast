// Google OAuth start — builds the consent URL and redirects the user.
// DEV STUB: If GOOGLE_OAUTH_CLIENT_ID is unset, immediately marks the
// credential as "connected" using a dev stub token and redirects to
// /connections?notice=google_dev_stub.
//
// Scopes requested:
//   - https://www.googleapis.com/auth/spreadsheets   (Google Sheets)
//   - https://www.googleapis.com/auth/gmail.send     (Send email via Gmail)

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Dynamically import saveCredential to avoid crashing if lib/db is absent
async function tryImportSaveCredential() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db = require("@/lib/db");
    return db.saveCredential as (
      userId: string,
      provider: string,
      token: string
    ) => Promise<void>;
  } catch {
    return null;
  }
}

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
];

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"));
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;

  // ---- DEV STUB PATH -------------------------------------------------------
  // CLEARLY MARKED: when GOOGLE_OAUTH_CLIENT_ID is not set, skip real OAuth
  // and mark both Google credentials as connected with a dev stub token.
  if (!clientId) {
    console.warn(
      "[DEV STUB] GOOGLE_OAUTH_CLIENT_ID not set — marking google credentials as connected with stub token"
    );

    const saveCredential = await tryImportSaveCredential();
    if (saveCredential) {
      try {
        await saveCredential(user.id, "google_sheets", "dev-stub-token");
        await saveCredential(user.id, "send_email", "dev-stub-token");
      } catch (err) {
        console.error("[DEV STUB] saveCredential failed:", err);
      }
    } else {
      console.warn("[DEV STUB] lib/db not available — credential not persisted");
    }

    return NextResponse.redirect(
      new URL(
        "/connections?notice=google_dev_stub",
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
      )
    );
  }
  // ---- REAL OAUTH PATH -----------------------------------------------------

  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/credentials/google/callback`;

  const state = crypto.randomUUID(); // CSRF protection — in production store in session/cookie

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline"); // get refresh token
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
