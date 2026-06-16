# lib/n8n

n8n client abstraction used throughout the application.

## Interface

```ts
interface N8nClient {
  createWorkflow(json: unknown): Promise<{ id: string }>;
  activateWorkflow(id: string): Promise<void>;
  deleteWorkflow(id: string): Promise<void>;
  getWorkflow(id: string): Promise<unknown>;
}

getN8nClient(): N8nClient
getN8nStub(): N8nClient & { __injectError(id, msg): void; __reset(): void }
```

## Modes

| `N8N_MODE` | Behaviour |
|---|---|
| `live` | REST calls to `N8N_BASE_URL` using `N8N_API_KEY` |
| *(anything else)* | In-memory stub (default) |

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `N8N_MODE` | — | Set to `"live"` for production |
| `N8N_BASE_URL` | `http://localhost:5678` | n8n instance URL |
| `N8N_API_KEY` | — | n8n API key |

## Stub test hook: `__injectError`

In tests, use the stub to simulate a failed workflow run:

```ts
import { getN8nStub } from "@/lib/n8n";

const stub = getN8nStub();

// 1. Create a workflow normally
const { id } = await stub.createWorkflow({ nodes: [], connections: {} });

// 2. Inject an error so the next getWorkflow() call throws
stub.__injectError(id, "Node 'SendEmail' timed out");

// 3. The testing agent or monitoring path will catch this and surface it
await stub.getWorkflow(id); // throws "Node 'SendEmail' timed out"

// 4. Reset all state between tests
stub.__reset();
```

The injected error fires exactly once (it is consumed on the first call), then subsequent calls succeed normally.

## How to test locally

1. Start the Next.js dev server (`npm run dev`)
2. Leave `N8N_MODE` unset (stub is used)
3. POST to `/api/spec/{id}/deploy` — the stub will fabricate a workflow id
4. To simulate an error, call `getN8nStub().__injectError(workflowId, "oops")` from a test script, then POST to `/api/webhooks/n8n-error` with `{ workflow: { id: workflowId }, execution: { error: { message: "oops" } } }`
