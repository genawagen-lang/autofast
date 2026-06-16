# lib/orchestrator

State machine orchestrator for workflow specs. Drives transitions from `draft` through `deployed`. Only the orchestrator calls the builder and testing agents — agents do not call each other.

## Exported signature

```ts
advance(specId: string): Promise<{ status: WorkflowSpec["status"]; detail?: string }>
```

## State machine

```
draft
 └─ → building  (advance() called)

building
 ├─ Builder succeeds + all creds connected  → testing
 ├─ Builder succeeds + creds missing        → needs_credentials
 └─ Builder throws                          → error

needs_credentials
 ├─ All creds now connected                 → testing
 └─ Still missing                           → needs_credentials (stable wait)

testing
 ├─ PASS                                    → ready
 └─ FAIL (up to 3 retries)                 → building  (failure reason injected into spec.description)
    └─ After 3 retries                      → error

ready
 └─ (deploy route called separately)        → deployed

deployed  — terminal, advance() no-ops
error     — terminal, advance() no-ops
```

## FAIL loop-back

When testing fails, the orchestrator embeds the failure reason (and failed node name if available) into `spec.description` before passing it back to the Builder Agent. This allows the LLM to read what went wrong and adjust the parameter map on the next build attempt. After `MAX_BUILD_RETRIES` (= 3) iterations the spec is marked `error`.

## API route

```
POST /api/orchestrator
Body: { "specId": "<uuid>" }
Response: { "status": "...", "detail": "..." }
```

## How to test

```bash
# 1. Create a spec via the discovery flow
# 2. Call advance
curl -X POST http://localhost:3000/api/orchestrator \
  -H "Content-Type: application/json" \
  -d '{"specId":"<uuid>"}'

# 3. Poll until status is "ready" or "deployed"
```

With `N8N_MODE` unset (stub), the full build→test→ready path runs without a real n8n instance.

## Sibling dependencies

- `@/lib/db` — `getSpec`, `updateSpecStatus`, `getCredentialStatus`
- `@/lib/agents/builder` — `buildWorkflow`
- `@/lib/agents/testing` — `testWorkflow`
