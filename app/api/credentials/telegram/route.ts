// Telegram credential route — validates a bot token by calling the
// Telegram Bot API (/getMe) then stores it via saveCredential.
//
// DEV STUB: If no token is provided AND we're in dev (NODE_ENV !== production),
// a stub token is accepted so the UI can be tested without a real bot.

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

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { token?: string };
  try {
    body = (await request.json()) as { token?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const token = body.token?.trim();

  // ---- DEV STUB PATH -------------------------------------------------------
  // Accepts an empty/missing token in development — clearly marked.
  if (!token) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "A bot token is required." },
        { status: 400 }
      );
    }
    // DEV STUB: accept missing token in non-production environments
    console.warn(
      "[DEV STUB] No Telegram token provided — storing stub token for development"
    );
    const saveCredential = await tryImportSaveCredential();
    if (saveCredential) {
      try {
        await saveCredential(user.id, "telegram", "dev-stub-telegram-token");
      } catch (err) {
        console.error("[DEV STUB] saveCredential failed:", err);
        return NextResponse.json(
          { error: "Could not save credential" },
          { status: 500 }
        );
      }
    } else {
      console.warn("[DEV STUB] lib/db not available — credential not persisted");
    }
    return NextResponse.json({ ok: true, stub: true });
  }
  // ---- REAL VALIDATION PATH ------------------------------------------------

  // Validate the token by calling Telegram's /getMe — cheap, read-only
  let botInfo: { ok: boolean; description?: string };
  try {
    const telegramRes = await fetch(
      `https://api.telegram.org/bot${token}/getMe`,
      { method: "GET" }
    );
    botInfo = (await telegramRes.json()) as typeof botInfo;
  } catch (err) {
    console.error("Telegram /getMe network error:", err);
    return NextResponse.json(
      { error: "Could not reach Telegram. Please check your connection." },
      { status: 502 }
    );
  }

  if (!botInfo.ok) {
    return NextResponse.json(
      {
        error:
          "That bot token doesn't seem to be valid. Check it in @BotFather and try again.",
      },
      { status: 400 }
    );
  }

  // Token is valid — store it
  const saveCredential = await tryImportSaveCredential();
  if (saveCredential) {
    try {
      await saveCredential(user.id, "telegram", token);
    } catch (err) {
      console.error("saveCredential failed:", err);
      return NextResponse.json(
        { error: "Could not save the bot token. Please try again." },
        { status: 500 }
      );
    }
  } else {
    console.warn("lib/db not available — Telegram credential not persisted");
  }

  return NextResponse.json({ ok: true });
}
