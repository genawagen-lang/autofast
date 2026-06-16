/**
 * lib/agents/testing.ts
 *
 * Testing Agent — validates that a built n8n workflow JSON is structurally
 * sound, that all required credentials are connected for the user, and
 * performs a safe dry-run (with the stub, simulates success).
 *
 * Exported signature:
 *   testWorkflow(args: {
 *     userId: string;
 *     spec: WorkflowSpec;
 *     n8nJson: unknown;
 *   }): Promise<{
 *     pass: boolean;
 *     preview?: string;
 *     reason?: string;
 *     failedNode?: string;
 *   }>
 */

import { type WorkflowSpec } from "@/types";
// @/lib/db is provided by the sibling db agent — coded against its documented
// signatures.  Import may be absent during tsc if sibling is not yet written.
import { getCredentialStatus } from "@/lib/db";
import { getN8nClient } from "@/lib/n8n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestArgs {
  userId: string;
  spec: WorkflowSpec;
  n8nJson: unknown;
}

export interface TestResult {
  pass: boolean;
  preview?: string;
  reason?: string;
  failedNode?: string;
}

// ---------------------------------------------------------------------------
// Structural validation helpers
// ---------------------------------------------------------------------------

interface N8nNode {
  name: string;
  type: string;
  [key: string]: unknown;
}

interface N8nJson {
  nodes: N8nNode[];
  connections: Record<string, unknown>;
}

function parseN8nJson(json: unknown): N8nJson {
  if (typeof json !== "object" || json === null) {
    throw new Error("Workflow JSON must be a non-null object");
  }
  const obj = json as Record<string, unknown>;
  if (!Array.isArray(obj["nodes"])) {
    throw new Error("Workflow JSON missing 'nodes' array");
  }
  if (typeof obj["connections"] !== "object" || obj["connections"] === null) {
    throw new Error("Workflow JSON missing 'connections' object");
  }
  return obj as unknown as N8nJson;
}

function validateStructure(parsed: N8nJson): string | null {
  if (parsed.nodes.length === 0) {
    return "Workflow has no nodes";
  }
  for (const node of parsed.nodes) {
    if (!node.name || typeof node.name !== "string") {
      return `Node is missing a 'name' field`;
    }
    if (!node.type || typeof node.type !== "string") {
      return `Node '${node.name}' is missing a 'type' field`;
    }
  }
  return null; // valid
}

// ---------------------------------------------------------------------------
// Credential check
// ---------------------------------------------------------------------------

async function checkCredentials(
  userId: string,
  required: string[]
): Promise<{ missing: string[] }> {
  const results = await Promise.all(
    required.map(async (provider) => {
      const status = await getCredentialStatus(userId, provider);
      return { provider, connected: status === "connected" };
    })
  );
  const missing = results
    .filter((r) => !r.connected)
    .map((r) => r.provider);
  return { missing };
}

// ---------------------------------------------------------------------------
// Dry-run via n8n client
// ---------------------------------------------------------------------------

/**
 * Push the workflow to n8n (or the stub), activate it, then immediately
 * clean up.  In stub mode this always succeeds unless an error has been
 * injected via __injectError.  In live mode we rely on n8n's own validation.
 *
 * Returns null on success; a { reason, failedNode } object on failure.
 */
async function dryRun(
  n8nJson: unknown,
  parsed: N8nJson
): Promise<{ reason: string; failedNode?: string } | null> {
  const client = getN8nClient();
  let workflowId: string | null = null;

  try {
    const created = await client.createWorkflow(n8nJson);
    workflowId = created.id;

    // Verify the workflow is retrievable (this is where __injectError fires)
    await client.getWorkflow(workflowId);

    // In live mode, activation validates the workflow further
    await client.activateWorkflow(workflowId);

    return null; // success
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Try to identify which node caused the error by scanning node names
    let failedNode: string | undefined;
    for (const node of parsed.nodes) {
      if (message.toLowerCase().includes(node.name.toLowerCase())) {
        failedNode = node.name;
        break;
      }
    }

    return { reason: message, failedNode };
  } finally {
    // Always clean up the test workflow
    if (workflowId) {
      const client2 = getN8nClient();
      await client2.deleteWorkflow(workflowId).catch(() => {
        // Cleanup failure is non-fatal
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Plain-language preview builder
// ---------------------------------------------------------------------------

function buildPreview(spec: WorkflowSpec, parsed: N8nJson): string {
  const trigger = spec.trigger.type;
  const actionNames = spec.actions.map((a) => a.type.replace(/_/g, " "));
  const nodeCount = parsed.nodes.length;

  return (
    `This workflow is triggered by a ${trigger} event and runs ${nodeCount} node(s). ` +
    `It will: ${actionNames.join(", then ")}. ` +
    `All required credentials are connected and the workflow passed structural validation.`
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function testWorkflow(args: TestArgs): Promise<TestResult> {
  const { userId, spec, n8nJson } = args;

  // 1. Structural validation
  let parsed: N8nJson;
  try {
    parsed = parseN8nJson(n8nJson);
  } catch (err: unknown) {
    return {
      pass: false,
      reason: err instanceof Error ? err.message : "Invalid workflow JSON",
      failedNode: undefined,
    };
  }

  const structureError = validateStructure(parsed);
  if (structureError) {
    return { pass: false, reason: structureError };
  }

  // 2. Credential check
  const { missing } = await checkCredentials(userId, spec.required_credentials);
  if (missing.length > 0) {
    return {
      pass: false,
      reason: `The following credentials are not connected: ${missing.join(", ")}. Please connect them before testing.`,
    };
  }

  // 3. Dry-run
  const dryRunError = await dryRun(n8nJson, parsed);
  if (dryRunError) {
    return {
      pass: false,
      reason: dryRunError.reason,
      failedNode: dryRunError.failedNode,
    };
  }

  // 4. All checks passed
  return {
    pass: true,
    preview: buildPreview(spec, parsed),
  };
}
