# Discovery Agent — `lib/agents/discovery.ts`

Drives a friendly, streaming conversation that helps non-technical users describe a simple
linear automation (trigger → 1–3 actions). When enough information has been gathered the
agent emits a validated `WorkflowSpec` draft.

---

## Endpoint

```
POST /api/chat
Content-Type: application/json
```

### Request body

```jsonc
{
  "userId": "uuid-of-authenticated-user",       // required
  "conversationId": "uuid-of-prior-conv",        // optional — omit to start new
  "messages": [
    { "role": "user",      "content": "I want to save form submissions to a spreadsheet." },
    { "role": "assistant", "content": "Great! Which form tool are you using?" },
    { "role": "user",      "content": "Typeform." }
  ]
}
```

| Field            | Type             | Required | Notes                              |
|------------------|------------------|----------|------------------------------------|
| `userId`         | `string`         | yes      | Authenticated user id              |
| `conversationId` | `string` (UUID)  | no       | Pass to continue an existing chat  |
| `messages`       | `ChatMessage[]`  | yes      | Full history including latest turn |

---

## Response

`Content-Type: text/event-stream` (SSE)

Each event is a JSON object on a `data:` line followed by two newlines:

```
data: {"type":"delta","text":"Hi! Let me help..."}

data: {"type":"spec_ready","spec":{...},"specId":"uuid","conversationId":"uuid"}

data: {"type":"done"}
```

### SSE event shapes

#### `delta`
Streamed as each assistant token arrives. Concatenate to reconstruct the full reply.

```ts
{ type: "delta"; text: string }
```

#### `spec_ready`
Emitted once, after all `delta` events, when the model has gathered enough information and
called the `emit_workflow_spec` tool. Contains the fully validated `WorkflowSpec`.

```ts
{
  type: "spec_ready";
  spec: WorkflowSpec;        // validated against workflowSpecSchema
  specId: string;            // id returned by saveSpec() — may differ from spec.id
  conversationId: string;    // id of the persisted conversation
}
```

#### `error`
Emitted if anything goes wrong (missing API key, validation failure, network error).
Always followed immediately by a `done` event.

```ts
{ type: "error"; message: string }
```

#### `done`
Always the final event. Signals that the stream is complete.

```ts
{ type: "done" }
```

---

## emit_workflow_spec tool schema

The model calls this tool when it has collected all required fields.
We intercept it, fill `id` and `status`, pick a `template_id`, and validate with zod.

```json
{
  "name": "emit_workflow_spec",
  "description": "Call this tool when you have collected enough information to define the workflow.",
  "input_schema": {
    "type": "object",
    "required": ["title", "description", "trigger", "actions", "required_credentials"],
    "properties": {
      "title":       { "type": "string" },
      "description": { "type": "string" },
      "trigger": {
        "type": "object",
        "required": ["type", "config"],
        "properties": {
          "type":   { "type": "string", "enum": ["webhook", "schedule", "email"] },
          "config": { "type": "object", "additionalProperties": true }
        }
      },
      "actions": {
        "type": "array",
        "minItems": 1,
        "maxItems": 3,
        "items": {
          "type": "object",
          "required": ["type", "config"],
          "properties": {
            "type":   { "type": "string", "enum": ["google_sheets_append", "send_email", "telegram_send"] },
            "config": { "type": "object", "additionalProperties": true }
          }
        }
      },
      "required_credentials": {
        "type": "array",
        "items": { "type": "string" }
      }
    }
  }
}
```

Fields NOT in the tool schema (filled by the agent code):

| Field         | How it is set                                      |
|---------------|----------------------------------------------------|
| `id`          | `crypto.randomUUID()`                              |
| `status`      | `"draft"` (always)                                 |
| `template_id` | Heuristic (see below)                              |

---

## template_id mapping heuristic

| Trigger   | Actions include                          | template_id                   |
|-----------|------------------------------------------|-------------------------------|
| webhook / email | sheets + email                     | `tmpl_form_to_sheet_email`    |
| webhook / email | telegram                           | `tmpl_form_telegram`          |
| webhook / email | email only                         | `tmpl_lead_followup`          |
| webhook / email | sheets only                        | `tmpl_newrow_welcome_email`   |
| schedule  | any                                      | `tmpl_schedule_message`       |
| fallback  | —                                        | `tmpl_form_to_sheet_email`    |

---

## curl example

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_abc123",
    "messages": [
      {
        "role": "user",
        "content": "I want to send a Telegram message every Monday morning to remind my team of weekly goals."
      }
    ]
  }'
```

### fetch example (browser / Node)

```ts
const response = await fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: "user_abc123",
    messages: [{ role: "user", content: "Save my Typeform submissions to Google Sheets." }],
  }),
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  for (const line of chunk.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const event = JSON.parse(line.slice(6));

    if (event.type === "delta")      process.stdout.write(event.text);
    if (event.type === "spec_ready") console.log("\nSpec ready:", event.spec);
    if (event.type === "error")      console.error("Error:", event.message);
    if (event.type === "done")       break;
  }
}
```

---

## Dependencies

| Import path          | Provided by             |
|----------------------|-------------------------|
| `@/lib/anthropic/client` | Foundation (Wave 0) |
| `@/lib/anthropic/models` | Foundation (Wave 0) |
| `@/types`            | Foundation (Wave 0)     |
| `@/lib/db`           | Wave 1A sibling agent   |

`@/lib/db` is built by a sibling agent in Wave 1A. The import will not resolve until
that agent's files are merged. TypeScript errors pointing to `@/lib/db` are expected
during isolated compilation.
