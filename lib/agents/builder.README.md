# lib/agents/builder.ts

Builder Agent — given a completed `WorkflowSpec`, selects the best matching template and uses an LLM tool-use call to fill its parameters, producing final n8n workflow JSON.

## Exported signature

```ts
buildWorkflow(spec: WorkflowSpec): Promise<{
  n8nJson: unknown;          // n8n workflow JSON (nodes[] + connections{})
  required_credentials: string[];
  template_id: string;
}>
```

## How it works

1. **Template selection** — calls `listTemplates()` from `@/lib/templates`, scores each template against the spec (trigger type + action types), picks the highest scorer. Never invents from scratch.
2. **Parameter filling** — asks OpenAI (`MODELS.BUILDER`) with a forced `tool_choice` to call `fill_template_parameters`. The LLM receives the spec and template structure only — **no credential tokens ever enter this call**.
3. **Template application** — replaces `{{key}}` placeholders in the template JSON with the values the LLM returned.
4. **Shape validation** — asserts `nodes[]` and `connections{}` exist on the result.

## Security contract

Credentials never appear in LLM context. The Builder only knows credential *provider names* from `spec.required_credentials` (e.g. `"google_sheets"`). Decrypted tokens are handled exclusively in `lib/n8n` at deploy time, reading from the vault server-side.

## How to test

```bash
# Via the API route
curl -X POST http://localhost:3000/api/spec/<uuid>/build

# Direct import (unit test)
import { buildWorkflow } from "@/lib/agents/builder";
const result = await buildWorkflow(mySpec);
console.log(result.n8nJson);
```

## Sibling dependencies

- `@/lib/templates` — `listTemplates()` (Wave 1A agent)
- `@/lib/openai/client` — OpenAI SDK instance
- `@/lib/openai/models` — `MODELS.BUILDER`
