/**
 * lib/orchestrator/index.ts
 *
 * Workflow Orchestrator — drives the spec state machine from discovery through
 * deployment.  Only the orchestrator calls builder/testing agents; agents do
 * NOT call each other directly.
 *
 * State machine transitions (using statuses from WorkflowSpec["status"]):
 *
 *   draft
 *     └─ (advance() called) → run build pipeline
 *
 *   Build pipeline:
 *     Builder succeeds + creds missing  → needs_credentials
 *     Builder succeeds + all creds ok   → testing
 *     Builder throws                    → error
 *
 *   needs_credentials
 *     All creds now connected           → testing → ready (if passes)
 *     Still missing                     → needs_credentials (stable wait)
 *
 *   testing
 *     PASS                              → ready
 *     FAIL (up to MAX_BUILD_RETRIES)   → draft (loop back; failure in description)
 *     FAIL after max retries            → error
 *
 *   ready
 *     Waiting for deploy route call     → deployed (set by deploy route)
 *
 *   deployed  — terminal, advance() no-ops
 *   error     — terminal, advance() no-ops
 *
 * Note: "draft" doubles as "in progress of building" since the schema has no
 * "building" status.  The orchestrator sets draft → needs_credentials|testing|error
 * within a single advance() call, so the spec never rests in draft after advance().
 *
 * Exported signature:
 *   advance(specId: string): Promise<{ status: WorkflowSpec["status"]; detail?: string }>
 */

import { type WorkflowSpec } from "@/types";
// @/lib/db is provided by the sibling db agent — coded against documented sigs.
import {
  getSpec,
  updateSpecStatus,
  getCredentialStatus,
} from "@/lib/db";
import { buildWorkflow } from "@/lib/agents/builder";
import { testWorkflow } from "@/lib/agents/testing";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum build→test loop iterations before we give up and set status=error */
const MAX_BUILD_RETRIES = 3;

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Check whether all required credentials for a spec are connected.
 * Returns the list of missing providers (empty array = all connected).
 */
async function getMissingCredentials(
  userId: string,
  required: string[]
): Promise<string[]> {
  const checks = await Promise.all(
    required.map(async (provider) => {
      const status = await getCredentialStatus(userId, provider);
      return { provider, connected: status === "connected" };
    })
  );
  return checks.filter((c) => !c.connected).map((c) => c.provider);
}

// ---------------------------------------------------------------------------
// Orchestrator state machine
// ---------------------------------------------------------------------------

export interface AdvanceResult {
  status: WorkflowSpec["status"];
  detail?: string;
}

/**
 * Advance the spec's state machine by one or more steps.
 *
 * The orchestrator may make multiple transitions in a single call (e.g.
 * draft→testing→ready if all credentials are already connected and tests pass).
 * It stops when it reaches a stable wait state or a terminal state.
 */
export async function advance(specId: string): Promise<AdvanceResult> {
  // Load the current spec row
  const row = await getSpec(specId);
  if (!row) {
    throw new Error(`Spec not found: ${specId}`);
  }

  const spec = row.spec as unknown as WorkflowSpec;
  const userId = row.user_id;

  // Terminal states — no-op
  if (row.status === "deployed" || row.status === "error") {
    return { status: row.status };
  }

  // ready → just waiting for the deploy route
  if (row.status === "ready") {
    return { status: "ready" };
  }

  // -------------------------------------------------------------------------
  // needs_credentials → re-check; advance to testing if all connected
  // -------------------------------------------------------------------------
  if (row.status === "needs_credentials") {
    const missing = await getMissingCredentials(
      userId,
      spec.required_credentials
    );
    if (missing.length > 0) {
      return {
        status: "needs_credentials",
        detail: `Waiting for credentials: ${missing.join(", ")}`,
      };
    }
    // All credentials are now connected — run build→test pipeline
    return await runBuildTest(specId, userId, spec, 0);
  }

  // -------------------------------------------------------------------------
  // draft (or testing status from a prior incomplete run) → run full pipeline
  // -------------------------------------------------------------------------
  return await runBuildTest(specId, userId, spec, 0);
}

// ---------------------------------------------------------------------------
// Build → Test pipeline (internal; called recursively up to MAX_BUILD_RETRIES)
// ---------------------------------------------------------------------------

async function runBuildTest(
  specId: string,
  userId: string,
  spec: WorkflowSpec,
  retryCount: number
): Promise<AdvanceResult> {
  if (retryCount >= MAX_BUILD_RETRIES) {
    await updateSpecStatus(specId, "error");
    return {
      status: "error",
      detail: `Build/test loop exceeded ${MAX_BUILD_RETRIES} retries`,
    };
  }

  // --- Build ---
  let buildResult: Awaited<ReturnType<typeof buildWorkflow>>;
  try {
    buildResult = await buildWorkflow(spec);
  } catch (err: unknown) {
    await updateSpecStatus(specId, "error");
    return {
      status: "error",
      detail: err instanceof Error ? err.message : "Builder failed",
    };
  }

  // --- Credential gate ---
  const missing = await getMissingCredentials(
    userId,
    buildResult.required_credentials
  );
  if (missing.length > 0) {
    await updateSpecStatus(specId, "needs_credentials");
    return {
      status: "needs_credentials",
      detail: `Connect these credentials to continue: ${missing.join(", ")}`,
    };
  }

  // --- Test ---
  await updateSpecStatus(specId, "testing");
  return await runTesting(specId, userId, spec, retryCount, buildResult);
}

async function runTesting(
  specId: string,
  userId: string,
  spec: WorkflowSpec,
  retryCount: number,
  buildResult?: Awaited<ReturnType<typeof buildWorkflow>>
): Promise<AdvanceResult> {
  // If we don't have buildResult (called from needs_credentials path), rebuild
  if (!buildResult) {
    try {
      buildResult = await buildWorkflow(spec);
    } catch (err: unknown) {
      await updateSpecStatus(specId, "error");
      return {
        status: "error",
        detail: err instanceof Error ? err.message : "Builder failed on retry",
      };
    }
  }

  const testResult = await testWorkflow({
    userId,
    spec,
    n8nJson: buildResult.n8nJson,
  });

  if (testResult.pass) {
    await updateSpecStatus(specId, "ready");
    return {
      status: "ready",
      detail: testResult.preview,
    };
  }

  // Test failed — loop back; embed failure context so Builder LLM can adjust.
  // Only the spec (no credentials) is passed — security contract preserved.
  const enrichedSpec: WorkflowSpec = {
    ...spec,
    description:
      `${spec.description} [Previous build failed: ${testResult.reason ?? "unknown reason"}` +
      (testResult.failedNode ? ` at node '${testResult.failedNode}'` : "") +
      `]`,
  };

  // Set status back to draft to signal "needs rebuild"
  await updateSpecStatus(specId, "draft");
  return await runBuildTest(specId, userId, enrichedSpec, retryCount + 1);
}
