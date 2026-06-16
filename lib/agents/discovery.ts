/**
 * Discovery Agent — lib/agents/discovery.ts
 *
 * Drives a friendly, streaming conversation with non-technical users to gather
 * the information needed to build ONE linear automation workflow.
 *
 * Supported triggers : webhook/form · schedule · email
 * Supported actions  : google_sheets_append · send_email · telegram_send
 * No loops, no branches.
 *
 * When enough detail has been collected the model calls the `emit_workflow_spec`
 * tool, which we intercept to validate, persist, and forward to the client.
 */

import { anthropic } from "@/lib/anthropic/client";
import { MODELS } from "@/lib/anthropic/models";
import { workflowSpecSchema, type WorkflowSpec } from "@/types";
import { saveConversation, saveSpec } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface DiscoveryRequest {
  userId: string;
  conversationId?: string;
  messages: ChatMessage[];
}

// SSE event shapes emitted on the ReadableStream
export type SSEEvent =
  | { type: "delta"; text: string }
  | { type: "spec_ready"; spec: WorkflowSpec; specId: string; conversationId: string }
  | { type: "error"; message: string }
  | { type: "done" };

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a friendly automation assistant helping non-technical users set up simple workflow automations.

Your goal is to gather the information needed to build ONE linear automation: a single trigger followed by 1 to 3 actions. Keep the conversation simple and approachable — avoid technical jargon.

SUPPORTED TRIGGERS (pick exactly one):
- webhook / form   — something submits a form or sends data to a URL
- schedule         — runs at a fixed time (e.g. every Monday at 9 am)
- email            — triggered when an email arrives (e.g. a Gmail filter)

SUPPORTED ACTIONS (pick 1–3):
- google_sheets_append — add a row to a Google Sheet
- send_email           — send an email
- telegram_send        — send a Telegram message

CONVERSATION RULES:
1. Ask for ONE missing piece of information at a time — never overwhelm the user.
2. Follow this order: trigger source → target app(s) → field mappings → notification target.
3. Once you have all required fields (see below), call the emit_workflow_spec tool immediately — do NOT keep asking.
4. Never mention "webhooks", "APIs", "JSON", or any technical term unless the user brings it up first.
5. Rephrase technical concepts in plain English (e.g. "a link your form will send data to").

REQUIRED FIELDS before calling emit_workflow_spec:
- A clear title and one-sentence description of what the automation does
- Trigger type and basic config (e.g. schedule cron expression, or that it listens for form submissions)
- At least one action type and what data it uses
- Which credentials will be needed (e.g. "google_sheets" if appending to sheets)

Keep responses short, warm, and encouraging. When the user is done, call emit_workflow_spec.`;

// ---------------------------------------------------------------------------
// Template mapping heuristic
// ---------------------------------------------------------------------------

type TemplateId =
  | "tmpl_form_to_sheet_email"
  | "tmpl_newrow_welcome_email"
  | "tmpl_schedule_message"
  | "tmpl_form_telegram"
  | "tmpl_lead_followup";

function pickTemplateId(spec: {
  trigger: { type: string };
  actions: { type: string }[];
}): TemplateId {
  const triggerType = spec.trigger.type;
  const actionTypes = spec.actions.map((a) => a.type);

  const hasSheets = actionTypes.includes("google_sheets_append");
  const hasEmail = actionTypes.includes("send_email");
  const hasTelegram = actionTypes.includes("telegram_send");

  if (triggerType === "webhook" || triggerType === "email") {
    if (hasSheets && hasEmail) return "tmpl_form_to_sheet_email";
    if (hasTelegram) return "tmpl_form_telegram";
    if (hasEmail) return "tmpl_lead_followup";
    if (hasSheets) return "tmpl_newrow_welcome_email";
  }

  if (triggerType === "schedule") {
    return "tmpl_schedule_message";
  }

  // fallback
  return "tmpl_form_to_sheet_email";
}

// ---------------------------------------------------------------------------
// emit_workflow_spec tool definition
// The schema intentionally omits `id` and `status` — we fill those ourselves.
// ---------------------------------------------------------------------------

const EMIT_WORKFLOW_SPEC_TOOL: Parameters<typeof anthropic.messages.stream>[0]["tools"] = [
  {
    name: "emit_workflow_spec",
    description:
      "Call this tool when you have collected enough information to define the workflow. Do NOT call it until you have all required fields.",
    input_schema: {
      type: "object" as const,
      required: ["title", "description", "trigger", "actions", "required_credentials"],
      properties: {
        title: {
          type: "string",
          description: "Short, plain-English title for the automation (e.g. 'Save contact form submissions to Google Sheets').",
        },
        description: {
          type: "string",
          description: "One sentence describing what the automation does.",
        },
        trigger: {
          type: "object",
          required: ["type", "config"],
          properties: {
            type: {
              type: "string",
              enum: ["webhook", "schedule", "email"],
              description: "The trigger mechanism.",
            },
            config: {
              type: "object",
              description: "Trigger-specific configuration key-value pairs (e.g. {cron: '0 9 * * 1'} for schedules).",
              additionalProperties: true,
            },
          },
        },
        actions: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: {
            type: "object",
            required: ["type", "config"],
            properties: {
              type: {
                type: "string",
                enum: ["google_sheets_append", "send_email", "telegram_send"],
              },
              config: {
                type: "object",
                description: "Action-specific configuration key-value pairs.",
                additionalProperties: true,
              },
            },
          },
        },
        required_credentials: {
          type: "array",
          items: { type: "string" },
          description: "List of credential provider keys needed (e.g. ['google_sheets', 'gmail']).",
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Helper: encode SSE event
// ---------------------------------------------------------------------------

function encodeSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// ---------------------------------------------------------------------------
// Core: run discovery stream
// Returns a ReadableStream that emits SSE-formatted text.
// ---------------------------------------------------------------------------

export function runDiscoveryStream(req: DiscoveryRequest): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (event: SSEEvent) => {
        controller.enqueue(encoder.encode(encodeSSE(event)));
      };

      // Guard: API key must exist
      if (!process.env.ANTHROPIC_API_KEY) {
        enqueue({
          type: "error",
          message:
            "The automation assistant is not configured yet. Please contact support (missing API key).",
        });
        enqueue({ type: "done" });
        controller.close();
        return;
      }

      try {
        // Persist the incoming messages immediately so we have a conversationId
        const savedConv = await saveConversation(
          req.userId,
          req.messages,
          req.conversationId
        );
        const conversationId = savedConv.id;

        // Build Anthropic message list (exclude any prior system turns)
        const anthropicMessages = req.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        // Stream from Claude
        const sdkStream = anthropic.messages.stream({
          model: MODELS.DISCOVERY,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          tools: EMIT_WORKFLOW_SPEC_TOOL,
          messages: anthropicMessages,
        });

        let accumulatedText = "";
        let toolUseBlock: { id: string; name: string; input: Record<string, unknown> } | null = null;
        let toolInputAccumulator = "";

        // Stream text deltas to the client in real time
        sdkStream.on("text", (text) => {
          accumulatedText += text;
          enqueue({ type: "delta", text });
        });

        // Accumulate tool_use input JSON (arrives via input_json_delta)
        sdkStream.on("inputJson", (partialJson) => {
          toolInputAccumulator += partialJson;
        });

        // Wait for the full response
        const finalMessage = await sdkStream.finalMessage();

        // Check for tool use
        for (const block of finalMessage.content) {
          if (block.type === "tool_use" && block.name === "emit_workflow_spec") {
            toolUseBlock = {
              id: block.id,
              name: block.name,
              input: block.input as Record<string, unknown>,
            };
            break;
          }
        }

        if (toolUseBlock) {
          // Build and validate the WorkflowSpec
          const rawInput = toolUseBlock.input;
          const id = crypto.randomUUID();
          const templateId = pickTemplateId(
            rawInput as { trigger: { type: string }; actions: { type: string }[] }
          );

          const candidate = {
            id,
            status: "draft" as const,
            template_id: templateId,
            ...rawInput,
          };

          // Validate with zod — throws ZodError if the model hallucinated an invalid shape
          const spec = workflowSpecSchema.parse(candidate);

          // Persist spec and conversation
          const [savedSpec] = await Promise.all([
            saveSpec(req.userId, spec),
            saveConversation(
              req.userId,
              [
                ...req.messages,
                { role: "assistant", content: accumulatedText || "[workflow spec emitted]" },
              ],
              conversationId
            ),
          ]);

          enqueue({
            type: "spec_ready",
            spec,
            specId: savedSpec.id,
            conversationId,
          });
        } else {
          // Plain conversational reply — persist the updated conversation
          const updatedMessages: ChatMessage[] = [
            ...req.messages,
            { role: "assistant", content: accumulatedText },
          ];
          await saveConversation(req.userId, updatedMessages, conversationId);
        }

        enqueue({ type: "done" });
        controller.close();
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred.";
        enqueue({ type: "error", message });
        enqueue({ type: "done" });
        controller.close();
      }
    },
  });

  return stream;
}
