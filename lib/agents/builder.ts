/**
 * lib/agents/builder.ts
 *
 * Builder Agent — given a completed WorkflowSpec, selects the best matching
 * template from the DB, fills its parameters via a structured LLM tool-use
 * call, and returns final n8n workflow JSON plus credential requirements.
 *
 * SECURITY: credentials never enter LLM context. The LLM only sees the spec
 * and template structure; decrypted tokens are handled exclusively in deploy.
 *
 * Exported signature:
 *   buildWorkflow(spec: WorkflowSpec): Promise<{
 *     n8nJson: unknown;
 *     required_credentials: string[];
 *     template_id: string;
 *   }>
 */

import { anthropic } from "@/lib/anthropic/client";
import { MODELS } from "@/lib/anthropic/models";
import { type WorkflowSpec, type TemplateRow } from "@/types";
// listTemplates lives in @/lib/db (sibling db agent, Wave 1A).
import { listTemplates } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildResult {
  n8nJson: unknown;
  required_credentials: string[];
  template_id: string;
}

// Shape the LLM is asked to return via tool use
interface ParameterMap {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Template selection heuristic
// ---------------------------------------------------------------------------

/**
 * Score a template against the spec.  Higher is better.
 * Prefers templates whose trigger_type and action_types overlap the spec.
 */
function scoreTemplate(template: TemplateRow, spec: WorkflowSpec): number {
  let score = 0;
  if (template.trigger_type === spec.trigger.type) score += 10;
  const specActionTypes = spec.actions.map((a) => a.type);
  for (const at of template.action_types) {
    if (specActionTypes.includes(at as WorkflowSpec["actions"][number]["type"])) {
      score += 5;
    }
  }
  return score;
}

function pickBestTemplate(templates: TemplateRow[], spec: WorkflowSpec): TemplateRow {
  if (templates.length === 0) {
    throw new Error("No templates available in the database");
  }
  const ranked = [...templates].sort(
    (a, b) => scoreTemplate(b, spec) - scoreTemplate(a, spec)
  );
  return ranked[0];
}

// ---------------------------------------------------------------------------
// JSON shape validation helpers
// ---------------------------------------------------------------------------

function assertValidN8nJson(json: unknown): void {
  if (typeof json !== "object" || json === null) {
    throw new Error("n8n JSON must be a non-null object");
  }
  const obj = json as Record<string, unknown>;
  if (!Array.isArray(obj["nodes"])) {
    throw new Error("n8n JSON missing 'nodes' array");
  }
  if (typeof obj["connections"] !== "object" || obj["connections"] === null) {
    throw new Error("n8n JSON missing 'connections' object");
  }
}

// ---------------------------------------------------------------------------
// LLM tool definition for parameter filling
// ---------------------------------------------------------------------------

const FILL_PARAMS_TOOL = [
  {
    name: "fill_template_parameters",
    description:
      "Given a workflow spec and template structure, return a flat key-value map of parameters to substitute into the template. Only return parameter keys that exist in the template. Do not include credential tokens or secrets.",
    input_schema: {
      type: "object" as const,
      required: ["parameters"],
      properties: {
        parameters: {
          type: "object",
          description:
            "Key-value map of parameter substitutions. Keys must match placeholder names in the template JSON.",
          additionalProperties: true,
        },
      },
    },
  },
] satisfies Parameters<typeof anthropic.messages.create>[0]["tools"];

// ---------------------------------------------------------------------------
// Apply parameter map to template JSON
// ---------------------------------------------------------------------------

/**
 * Deep-clones the template JSON and substitutes {{key}} placeholders with
 * values from the parameter map.  Works on stringified JSON for simplicity.
 */
function applyParameters(templateJson: unknown, params: ParameterMap): unknown {
  let serialized = JSON.stringify(templateJson);
  for (const [key, value] of Object.entries(params)) {
    const placeholder = `{{${key}}}`;
    // Replace all occurrences; values are JSON-serialized so strings are safe
    serialized = serialized.split(placeholder).join(String(value));
  }
  return JSON.parse(serialized);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function buildWorkflow(spec: WorkflowSpec): Promise<BuildResult> {
  // 1. Load all templates and pick the best match
  const templates = await listTemplates();
  const template = pickBestTemplate(templates, spec);

  // 2. Ask the LLM to produce a parameter map from the spec + template shape.
  //    IMPORTANT: we pass only the spec and template structure — never tokens.
  const systemPrompt = `You are a workflow automation expert. Your task is to map a user's workflow specification onto a template's parameters. Return ONLY the parameter key-value pairs needed to customise the template — do not invent keys that are not in the template, and never include credential tokens or secrets.`;

  const userMessage = `Workflow spec:
${JSON.stringify(spec, null, 2)}

Template (id=${template.id}, name="${template.name}"):
${JSON.stringify(template.n8n_json_template, null, 2)}

Call fill_template_parameters with the parameter map that will make this template match the spec.`;

  const response = await anthropic.messages.create({
    model: MODELS.BUILDER,
    max_tokens: 2048,
    system: systemPrompt,
    tools: FILL_PARAMS_TOOL,
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: userMessage }],
  });

  // 3. Extract the tool-use block
  let params: ParameterMap = {};
  for (const block of response.content) {
    if (
      block.type === "tool_use" &&
      block.name === "fill_template_parameters"
    ) {
      const input = block.input as { parameters?: ParameterMap };
      params = input.parameters ?? {};
      break;
    }
  }

  // 4. Apply parameters to the template JSON
  const n8nJson = applyParameters(template.n8n_json_template, params);

  // 5. Validate the resulting JSON shape
  assertValidN8nJson(n8nJson);

  // 6. Derive required_credentials from spec (source of truth is the spec itself)
  const required_credentials = spec.required_credentials;

  return {
    n8nJson,
    required_credentials,
    template_id: template.id,
  };
}
