// Google OAuth callback — exchanges the authorization code for tokens server-side.
// Tokens are NEVER sent to the browser; they go straight to saveCredential().
//
// DEV STUB PATH: If GOOGLE_OAUTH_CLIENT_ID is unset, skips exchange and stores
// a stub token (same as the /start stub path, guarding against direct URL hits).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const appBase = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (!user) {
    return NextResponse.redirect(new URL("/login", appBase));
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const errorParam = searchParams.get("error");

  // User denied consent
  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/connections?error=${encodeURIComponent(errorParam)}`, appBase)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/connections?error=missing_code", appBase)
    );
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;

  // ---- DEV STUB PATH -------------------------------------------------------
  if (!clientId) {
    console.warn(
      "[DEV STUB] GOOGLE_OAUTH_CLIENT_ID not set — callback reached in dev mode, storing stub token"
    );
    const saveCredential = await tryImportSaveCredential();
    if (saveCredential) {
      try {
        await saveCredential(user.id, "google_sheets", "dev-stub-token");
        await saveCredential(user.id, "send_email", "dev-stub-token");
      } catch (err) {
        console.error("[DEV STUB] saveCredential failed:", err);
      }
    }
    return NextResponse.redirect(
      new URL("/connections?notice=google_dev_stub", appBase)
    );
  }
  // ---- REAL TOKEN EXCHANGE -------------------------------------------------

  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    `${appBase}/api/credentials/google/callback`;

  if (!clientSecret) {
    console.error("GOOGLE_OAUTH_CLIENT_SECRET is not set");
    return NextResponse.redirect(
      new URL("/connections?error=server_config", appBase)
    );
  }

  let tokenData: {
    access_token?: string;
    refresh_token?: string;
    error?: string;
  };

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    tokenData = (await tokenRes.json()) as typeof tokenData;
  } catch (err) {
    console.error("Token exchange network error:", err);
    return NextResponse.redirect(
      new URL("/connections?error=token_exchange_failed", appBase)
    );
  }

  if (tokenData.error || !tokenData.access_token) {
    console.error("Token exchange error:", tokenData.error);
    return NextResponse.redirect(
      new URL(
        `/connections?error=${encodeURIComponent(tokenData.error ?? "no_access_token")}`,
        appBase
      )
    );
  }

  // Store as JSON string — the vault/saveCredential will encrypt it
  const credentialPayload = JSON.stringify({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token ?? null,
  });

  const saveCredential = await tryImportSaveCredential();
  if (saveCredential) {
    try {
      await saveCredential(user.id, "google_sheets", credentialPayload);
      await saveCredential(user.id, "send_email", credentialPayload);
    } catch (err) {
      console.error("saveCredential failed:", err);
      return NextResponse.redirect(
        new URL("/connections?error=save_failed", appBase)
      );
    }
  } else {
    console.warn("lib/db not available — credential not persisted");
  }

  return NextResponse.redirect(
    new URL("/connections?notice=google_connected", appBase)
  );
}
