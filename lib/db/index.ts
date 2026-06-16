/**
 * lib/db/index.ts — SERVER-ONLY
 *
 * All database operations for the automation app.
 * Credentials are encrypted via Vault before storage; raw tokens never leave
 * the server and are never placed in LLM context.
 *
 * Uses the async createClient() from lib/supabase/server.ts (anon key, RLS
 * enforced).  The getDecryptedCredential function additionally uses the
 * service-role Vault wrappers (lib/vault).
 */

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { storeSecret, retrieveSecret } from "@/lib/vault";
import type {
  WorkflowSpec,
  WorkflowSpecRow,
  ConversationRow,
  TemplateRow,
  DeploymentRow,
} from "@/types";

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/**
 * Persist or update a conversation (append-safe: always writes full messages).
 * If conversationId is supplied the existing row is updated, otherwise a new
 * row is created.
 */
export async function saveConversation(
  userId: string,
  messages: unknown[],
  conversationId?: string
): Promise<{ id: string }> {
  const db = await createClient();

  if (conversationId) {
    const { data, error } = await db
      .from("conversations")
      .update({ messages: messages as object[] })
      .eq("id", conversationId)
      .eq("user_id", userId)
      .select("id")
      .single();

    if (error) throw new Error(`saveConversation update: ${error.message}`);
    return { id: (data as { id: string }).id };
  }

  const { data, error } = await db
    .from("conversations")
    .insert({ user_id: userId, messages: messages as object[] })
    .select("id")
    .single();

  if (error) throw new Error(`saveConversation insert: ${error.message}`);
  return { id: (data as { id: string }).id };
}

/**
 * Fetch a conversation by id.  Returns null if not found or not owned by caller.
 */
export async function getConversation(
  conversationId: string
): Promise<ConversationRow | null> {
  const db = await createClient();

  const { data, error } = await db
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .single();

  if (error) return null;
  return data as ConversationRow;
}

// ---------------------------------------------------------------------------
// Workflow Specs
// ---------------------------------------------------------------------------

/**
 * Insert a new versioned workflow spec row.
 * Version increments from the highest existing version for this spec id.
 * For brand-new specs pass a spec whose id is a fresh UUID (caller's responsibility).
 */
export async function saveSpec(
  userId: string,
  spec: WorkflowSpec
): Promise<{ id: string; version: number }> {
  const db = await createClient();

  // Find current max version for this spec id (0 if brand new)
  const { data: existing } = await db
    .from("workflow_specs")
    .select("version")
    .eq("id", spec.id)
    .order("version", { ascending: false })
    .limit(1);

  const currentMax = (existing as Array<{ version: number }> | null)?.[0]?.version ?? 0;
  const nextVersion = currentMax + 1;

  const { data, error } = await db
    .from("workflow_specs")
    .insert({
      id: spec.id,
      user_id: userId,
      version: nextVersion,
      spec: spec as unknown as object,
      status: spec.status,
    })
    .select("id, version")
    .single();

  if (error) throw new Error(`saveSpec: ${error.message}`);
  const row = data as { id: string; version: number };
  return { id: row.id, version: row.version };
}

/**
 * Fetch a spec by id (returns the highest-version row).
 */
export async function getSpec(specId: string): Promise<WorkflowSpecRow | null> {
  const db = await createClient();

  const { data, error } = await db
    .from("workflow_specs")
    .select("*")
    .eq("id", specId)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (error) return null;
  return data as WorkflowSpecRow;
}

/**
 * Update the status field of the latest version of a spec.
 */
export async function updateSpecStatus(
  specId: string,
  status: WorkflowSpec["status"]
): Promise<void> {
  const db = await createClient();

  // Update the row with the max version
  const { data: latest } = await db
    .from("workflow_specs")
    .select("id, version")
    .eq("id", specId)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (!latest) throw new Error(`updateSpecStatus: spec ${specId} not found`);

  const { error } = await db
    .from("workflow_specs")
    .update({ status })
    .eq("id", specId)
    .eq("version", (latest as { version: number }).version);

  if (error) throw new Error(`updateSpecStatus: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * Store a credential for a user+provider pair, encrypting the token via Vault.
 * Only the vault reference id is persisted in the credentials table.
 * Upserts so re-connecting a provider refreshes the token.
 */
export async function saveCredential(
  userId: string,
  provider: string,
  token: string
): Promise<void> {
  // Encrypt first — token never enters DB
  const vaultSecretId = await storeSecret(userId, provider, token);

  const db = await createClient();

  const { error } = await db.from("credentials").upsert(
    {
      user_id: userId,
      provider,
      vault_secret_id: vaultSecretId,
      status: "active",
    },
    { onConflict: "user_id,provider" }
  );

  if (error) throw new Error(`saveCredential: ${error.message}`);
}

/**
 * Returns whether a credential exists and is active for user+provider.
 * Does NOT return the token.
 */
export async function getCredentialStatus(
  userId: string,
  provider: string
): Promise<"connected" | "not_connected"> {
  const db = await createClient();

  const { data, error } = await db
    .from("credentials")
    .select("status")
    .eq("user_id", userId)
    .eq("provider", provider)
    .single();

  if (error || !data) return "not_connected";
  return (data as { status: string }).status === "active"
    ? "connected"
    : "not_connected";
}

/**
 * List all credential statuses (not tokens) for a user.
 */
export async function listCredentialStatuses(
  userId: string
): Promise<Array<{ provider: string; status: string }>> {
  const db = await createClient();

  const { data, error } = await db
    .from("credentials")
    .select("provider, status")
    .eq("user_id", userId);

  if (error) return [];
  return (data as Array<{ provider: string; status: string }>) ?? [];
}

/**
 * SERVER-ONLY: Decrypt and return the raw credential token.
 * Must never be called from a client component or returned in an API response
 * that the browser can read.
 */
export async function getDecryptedCredential(
  userId: string,
  provider: string
): Promise<string | null> {
  const db = await createClient();

  const { data, error } = await db
    .from("credentials")
    .select("vault_secret_id, status")
    .eq("user_id", userId)
    .eq("provider", provider)
    .single();

  if (error || !data) return null;

  const row = data as { vault_secret_id: string | null; status: string };
  if (row.status !== "active" || !row.vault_secret_id) return null;

  return retrieveSecret(row.vault_secret_id);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** List all templates (public, no user filter). */
export async function listTemplates(): Promise<TemplateRow[]> {
  const db = await createClient();

  const { data, error } = await db.from("templates").select("*");
  if (error) throw new Error(`listTemplates: ${error.message}`);
  return (data as TemplateRow[]) ?? [];
}

/** Get a single template by id. */
export async function getTemplate(templateId: string): Promise<TemplateRow | null> {
  const db = await createClient();

  const { data, error } = await db
    .from("templates")
    .select("*")
    .eq("id", templateId)
    .single();

  if (error) return null;
  return data as TemplateRow;
}

// ---------------------------------------------------------------------------
// Deployments
// ---------------------------------------------------------------------------

/** Create a new deployment record. */
export async function saveDeployment(d: {
  spec_id: string;
  n8n_workflow_id: string;
  status: string;
}): Promise<{ id: string }> {
  const db = await createClient();

  const { data, error } = await db
    .from("deployments")
    .insert({
      spec_id: d.spec_id,
      n8n_workflow_id: d.n8n_workflow_id,
      status: d.status,
    })
    .select("id")
    .single();

  if (error) throw new Error(`saveDeployment: ${error.message}`);
  return { id: (data as { id: string }).id };
}

/** Get the deployment associated with a spec (most recent). */
export async function getDeploymentBySpec(
  specId: string
): Promise<DeploymentRow | null> {
  const db = await createClient();

  const { data, error } = await db
    .from("deployments")
    .select("*")
    .eq("spec_id", specId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error) return null;
  return data as DeploymentRow;
}

/** Set last_error on a deployment identified by n8n_workflow_id. */
export async function updateDeploymentError(
  n8nWorkflowId: string,
  error: string
): Promise<void> {
  const db = await createClient();

  const { error: dbError } = await db
    .from("deployments")
    .update({ status: "error", last_error: error })
    .eq("n8n_workflow_id", n8nWorkflowId);

  if (dbError) throw new Error(`updateDeploymentError: ${dbError.message}`);
}

/** List all deployments for workflows owned by userId. */
export async function listDeployments(userId: string): Promise<DeploymentRow[]> {
  const db = await createClient();

  // Join through workflow_specs to enforce ownership
  const { data, error } = await db
    .from("deployments")
    .select("*, workflow_specs!inner(user_id)")
    .eq("workflow_specs.user_id", userId);

  if (error) throw new Error(`listDeployments: ${error.message}`);

  // Strip the joined column before returning
  return ((data as Array<DeploymentRow & { workflow_specs: unknown }>) ?? []).map(
    ({ workflow_specs: _ws, ...rest }) => rest as DeploymentRow
  );
}
