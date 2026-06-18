/**
 * lib/n8n/index.ts
 *
 * n8n client abstraction. Returns a live REST client when N8N_MODE === "live",
 * otherwise returns an in-memory stub suitable for testing and local dev.
 *
 * Stub features:
 *   - In-memory workflow map (survives the lifetime of the Node.js process)
 *   - Fabricated UUIDs via crypto.randomUUID()
 *   - __injectError(workflowId, msg) — causes the next getWorkflow() call for
 *     that id to throw, simulating a failed n8n run so the monitoring/webhook
 *     path can be exercised in tests
 */

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface N8nClient {
  /** Create a workflow. Returns the workflow id assigned by n8n (or the stub). */
  createWorkflow(json: unknown): Promise<{ id: string }>;
  /** Activate (enable) a workflow by id. */
  activateWorkflow(id: string): Promise<void>;
  /** Delete a workflow by id. */
  deleteWorkflow(id: string): Promise<void>;
  /** Fetch a workflow by id. Throws if the workflow is not found. */
  getWorkflow(id: string): Promise<unknown>;
  /** Create a credential in n8n's own store. Returns the new credential id. */
  createCredential(input: {
    name: string;
    type: string;
    data: Record<string, unknown>;
  }): Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Live REST client (used when N8N_MODE === "live")
// ---------------------------------------------------------------------------

function buildLiveClient(): N8nClient {
  const baseUrl = process.env.N8N_BASE_URL ?? "http://localhost:5678";
  const apiKey = process.env.N8N_API_KEY ?? "";

  const headers = (): HeadersInit => ({
    "Content-Type": "application/json",
    "X-N8N-API-KEY": apiKey,
  });

  async function request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${baseUrl}/api/v1${path}`;
    const res = await fetch(url, {
      method,
      headers: headers(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      throw new Error(`n8n ${method} ${path} → ${res.status}: ${text}`);
    }
    // Some n8n endpoints return 204 No Content
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  return {
    createWorkflow(json: unknown) {
      // n8n's public API only accepts { name, nodes, connections, settings } on
      // create and rejects extra/read-only fields (active, id, tags, staticData,
      // pinData, versionId, meta) and unknown settings keys. Sanitize first.
      return request<{ id: string }>(
        "POST",
        "/workflows",
        toN8nCreatePayload(json)
      );
    },
    activateWorkflow(id: string) {
      // n8n public API uses POST (not PATCH) for activate.
      return request<void>("POST", `/workflows/${id}/activate`);
    },
    deleteWorkflow(id: string) {
      return request<void>("DELETE", `/workflows/${id}`);
    },
    getWorkflow(id: string) {
      return request<unknown>("GET", `/workflows/${id}`);
    },
    createCredential(input) {
      return request<{ id: string }>("POST", "/credentials", input);
    },
  };
}

// ---------------------------------------------------------------------------
// Payload sanitization for n8n's public API create endpoint
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

/** Drop credential refs that are still unresolved placeholder strings — n8n
 *  expects { id, name } objects, and rejects bare strings. Leaving them out
 *  lets the workflow import; the user attaches the credential in the n8n UI. */
function sanitizeNode(node: unknown): unknown {
  if (!isObject(node)) return node;
  const out: Record<string, unknown> = { ...node };
  if (isObject(out.credentials)) {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(out.credentials)) {
      if (isObject(v) && "id" in v) cleaned[k] = v;
    }
    if (Object.keys(cleaned).length > 0) out.credentials = cleaned;
    else delete out.credentials;
  }
  return out;
}

function toN8nCreatePayload(json: unknown): {
  name: string;
  nodes: unknown[];
  connections: Record<string, unknown>;
  settings: Record<string, unknown>;
} {
  const wf = isObject(json) ? json : {};
  return {
    name: typeof wf.name === "string" ? wf.name : "Automation",
    nodes: Array.isArray(wf.nodes) ? wf.nodes.map(sanitizeNode) : [],
    connections: isObject(wf.connections) ? wf.connections : {},
    settings: { executionOrder: "v1" },
  };
}

// ---------------------------------------------------------------------------
// In-memory stub (default when N8N_MODE !== "live")
// ---------------------------------------------------------------------------

interface StubWorkflow {
  id: string;
  active: boolean;
  json: unknown;
}

// Module-level map so the stub is stateful within a process lifetime.
const stubStore = new Map<string, StubWorkflow>();
// workflowId → error message to throw on next getWorkflow call
const injectedErrors = new Map<string, string>();

function buildStubClient(): N8nClient & {
  __injectError(workflowId: string, msg: string): void;
  __reset(): void;
} {
  return {
    // Test helper — simulates a failed n8n run so error-monitoring paths fire
    __injectError(workflowId: string, msg: string) {
      injectedErrors.set(workflowId, msg);
    },

    // Test helper — wipe all state
    __reset() {
      stubStore.clear();
      injectedErrors.clear();
    },

    async createWorkflow(json: unknown) {
      const id = crypto.randomUUID();
      stubStore.set(id, { id, active: false, json });
      return { id };
    },

    async activateWorkflow(id: string) {
      const wf = stubStore.get(id);
      if (!wf) throw new Error(`Stub: workflow ${id} not found`);
      wf.active = true;
    },

    async deleteWorkflow(id: string) {
      const existed = stubStore.delete(id);
      if (!existed) throw new Error(`Stub: workflow ${id} not found`);
    },

    async getWorkflow(id: string) {
      const errorMsg = injectedErrors.get(id);
      if (errorMsg) {
        injectedErrors.delete(id);
        throw new Error(errorMsg);
      }
      const wf = stubStore.get(id);
      if (!wf) throw new Error(`Stub: workflow ${id} not found`);
      return wf;
    },

    async createCredential() {
      // Stub: fabricate a credential id; the stub doesn't actually run nodes.
      return { id: crypto.randomUUID() };
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton + factory
// ---------------------------------------------------------------------------

let _client: N8nClient | null = null;

/**
 * Returns a singleton N8nClient.
 * Set N8N_MODE=live and N8N_BASE_URL / N8N_API_KEY env vars for the real
 * n8n REST API; otherwise an in-memory stub is returned.
 */
export function getN8nClient(): N8nClient {
  if (_client) return _client;
  _client =
    process.env.N8N_MODE === "live" ? buildLiveClient() : buildStubClient();
  return _client;
}

/**
 * Returns the underlying stub client with test helpers exposed.
 * Throws if N8N_MODE === "live".
 */
export function getN8nStub(): ReturnType<typeof buildStubClient> {
  if (process.env.N8N_MODE === "live") {
    throw new Error("getN8nStub() is only available in stub mode");
  }
  return getN8nClient() as ReturnType<typeof buildStubClient>;
}
