/**
 * lib/vault/index.ts
 *
 * Supabase Vault wrappers — server-side only.
 *
 * Vault stores secrets via `vault.create_secret(secret, name, description)`
 * and retrieves them via the `vault.decrypted_secrets` view.
 *
 * DEV FALLBACK:
 * When Vault is unavailable (no real SUPABASE_SERVICE_ROLE_KEY or vault
 * extension not running locally), storeSecret returns a synthetic reference id
 * prefixed with "dev_fallback:" and the plaintext is base64-encoded into the
 * reference itself so the flow keeps working.  retrieveSecret detects this
 * prefix and decodes on the fly.  This is intentionally insecure and logs a
 * warning so it is never used silently in production.
 */

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Service-role client — bypasses RLS; NEVER expose to the browser
// ---------------------------------------------------------------------------
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return null;
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// DEV FALLBACK helpers
// ---------------------------------------------------------------------------
const DEV_PREFIX = "dev_fallback:";

function makeDevRef(token: string): string {
  console.warn(
    "[vault] WARN: Using insecure dev fallback — Vault unavailable. " +
      "Never use this in production."
  );
  return DEV_PREFIX + Buffer.from(token, "utf8").toString("base64");
}

function isDevRef(ref: string): boolean {
  return ref.startsWith(DEV_PREFIX);
}

function decodeDevRef(ref: string): string {
  return Buffer.from(ref.slice(DEV_PREFIX.length), "base64").toString("utf8");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * storeSecret — encrypt a token in Vault and return a vault reference id.
 *
 * @param userId   Supabase auth user id (used to name the secret)
 * @param provider Credential provider slug (e.g. "google_sheets")
 * @param token    Plaintext token/credential value to encrypt
 * @returns        vault secret uuid, or a dev-fallback reference string
 */
export async function storeSecret(
  userId: string,
  provider: string,
  token: string
): Promise<string> {
  const svc = getServiceClient();

  if (!svc) {
    // No service role key — use dev fallback
    return makeDevRef(token);
  }

  const secretName = `cred_${userId}_${provider}`;

  try {
    // Supabase Vault exposes vault.create_secret as a PostgREST RPC.
    // The JS client calls RPCs in the public schema by default; Supabase
    // proxies vault.create_secret through an rpc alias when the extension
    // is installed. Arg names match vault.create_secret(secret, name, description).
    const { data, error } = await svc.rpc("vault_create_secret" as never, {
      secret: token,
      name: secretName,
      description: `Credential for user ${userId}, provider ${provider}`,
    } as never);

    if (error) {
      // Vault RPC not available (e.g. local dev without vault extension)
      console.warn(
        `[vault] vault_create_secret failed (${error.message}). Falling back to dev mode.`
      );
      return makeDevRef(token);
    }

    // data is the uuid of the created secret
    return data as string;
  } catch (err) {
    console.warn("[vault] Unexpected error calling vault, using dev fallback:", err);
    return makeDevRef(token);
  }
}

/**
 * retrieveSecret — read back the plaintext token from Vault.
 * SERVER-SIDE ONLY.  Returns null if the secret cannot be found.
 *
 * @param vaultSecretId  The reference returned by storeSecret
 */
export async function retrieveSecret(
  vaultSecretId: string
): Promise<string | null> {
  // Dev fallback path — decode the embedded base64 token
  if (isDevRef(vaultSecretId)) {
    console.warn(
      "[vault] WARN: Decoding dev-fallback credential — not encrypted."
    );
    return decodeDevRef(vaultSecretId);
  }

  const svc = getServiceClient();
  if (!svc) {
    console.error("[vault] Cannot retrieve secret: no service-role client.");
    return null;
  }

  try {
    // vault.decrypted_secrets is a view in the vault schema.
    // We use the schema() selector to switch from the default public schema.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (svc as any)
      .schema("vault")
      .from("decrypted_secrets")
      .select("decrypted_secret")
      .eq("id", vaultSecretId)
      .single();

    if (error || !data) {
      console.error("[vault] Failed to retrieve secret:", error?.message);
      return null;
    }

    return (data as { decrypted_secret: string }).decrypted_secret;
  } catch (err) {
    console.error("[vault] Unexpected error retrieving secret:", err);
    return null;
  }
}
