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

import { openai } from "@/lib/openai/client";
import { MODELS } from "@/lib/openai/models";
import { workflowSpecSchema, type WorkflowSpec } from "@/types";
import { saveConversation, saveSpec } from "@/lib/db";
import type OpenAI from "openai";

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

const SYSTEM_PROMPT = `You are a warm, competent automation assistant for non-technical users. You design ONE simple linear automation: a single trigger followed by 1–3 actions.

Be concise and decisive. Keep every reply to 1–2 short sentences. Ask only for details you genuinely need — ONE question at a time — and infer sensible defaults instead of over-asking. Never show technical jargon, error messages, or internal field names.

TRIGGERS — trigger.type MUST be exactly one of these three values:
- "webhook" — something sends data IN: a form submission, an external app calling in, OR an incoming message to a bot (e.g. a Telegram chatbot receiving a message).
- "schedule" — runs at a fixed time (e.g. every Monday 9am).
- "email" — runs when an email arrives.
There is NO "telegram", "message", or "chat" trigger. If the user wants a bot that replies to incoming messages (e.g. a Telegram chatbot), use trigger.type "webhook".

ACTIONS — action.type MUST be one of these (choose 1–3):
- "google_sheets_append" — add a row to a Google Sheet
- "send_email" — send an email
- "telegram_send" — send a Telegram message

HOW TO BEHAVE:
- As soon as you know the trigger, at least one action, and can write a short title, call emit_workflow_spec. Don't keep interrogating the user.
- Fill the config objects with reasonable defaults; you do NOT need every detail.
- Set required_credentials from the apps involved (e.g. ["telegram"], or ["google_sheets","send_email"]).
- If a request can't be done exactly with these triggers/actions, pick the CLOSEST supported setup and proceed cheerfully — never refuse or lecture about limitations.
- For "a Telegram chatbot that answers messages": trigger "webhook", action "telegram_send", required_credentials ["telegram"]. Just build it.

When you have enough to proceed, call emit_workflow_spec immediately.`;

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
// Normalization — coerce loose model output into the strict WorkflowSpec shape
// so a model that emits, e.g., trigger.type "telegram" doesn't blow up
// validation. We map common synonyms and infer sensible defaults.
// ---------------------------------------------------------------------------

type ActionType = "google_sheets_append" | "send_email" | "telegram_send";

const TRIGGER_ALIASES: Record<string, "webhook" | "schedule" | "email"> = {
  webhook: "webhook", form: "webhook", telegram: "webhook", message: "webhook",
  chat: "webhook", chatbot: "webhook", bot: "webhook", http: "webhook", api: "webhook",
  schedule: "schedule", cron: "schedule", timer: "schedule", time: "schedule", recurring: "schedule",
  email: "email", gmail: "email", mail: "email", imap: "email", inbox: "email",
};

const ACTION_ALIASES: Record<string, ActionType> = {
  google_sheets_append: "google_sheets_append", google_sheets: "google_sheets_append",
  sheets: "google_sheets_append", spreadsheet: "google_sheets_append", sheet: "google_sheets_append",
  send_email: "send_email", email: "send_email", gmail: "send_email", smtp: "send_email", mail: "send_email",
  telegram_send: "telegram_send", telegram: "telegram_send", message: "telegram_send", reply: "telegram_send",
};

const CRED_FOR_ACTION: Record<ActionType, string> = {
  google_sheets_append: "google_sheets",
  send_email: "send_email",
  telegram_send: "telegram",
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function normalizeEmitInput(raw: Record<string, unknown>) {
  const trigger = asRecord(raw.trigger);
  const triggerType =
    TRIGGER_ALIASES[asString(trigger.type).toLowerCase().trim()] ?? "webhook";

  const rawActions = Array.isArray(raw.actions) ? raw.actions : [];
  let actions = rawActions
    .map((a) => {
      const obj = asRecord(a);
      const mapped = ACTION_ALIASES[asString(obj.type).toLowerCase().trim()];
      return mapped ? { type: mapped, config: asRecord(obj.config) } : null;
    })
    .filter((a): a is { type: ActionType; config: Record<string, unknown> } => a !== null)
    .slice(0, 3);

  const rawCreds = Array.isArray(raw.required_credentials)
    ? raw.required_credentials.map(asString).filter(Boolean)
    : [];

  if (actions.length === 0) {
    // Infer a default action from any credentials the model mentioned.
    const lc = rawCreds.map((c) => c.toLowerCase());
    const t: ActionType = lc.some((c) => c.includes("sheet"))
      ? "google_sheets_append"
      : lc.some((c) => c.includes("mail"))
        ? "send_email"
        : "telegram_send";
    actions = [{ type: t, config: {} }];
  }

  const required_credentials =
    rawCreds.length > 0
      ? rawCreds
      : Array.from(new Set(actions.map((a) => CRED_FOR_ACTION[a.type])));

  return {
    title: asString(raw.title).trim() || "My automation",
    description: asString(raw.description),
    trigger: { type: triggerType, config: asRecord(trigger.config) },
    actions,
    required_credentials,
  };
}

// ---------------------------------------------------------------------------
// emit_workflow_spec tool definition
// The schema intentionally omits `id` and `status` — we fill those ourselves.
// ---------------------------------------------------------------------------

const EMIT_WORKFLOW_SPEC_TOOL: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "emit_workflow_spec",
      description:
        "Call this tool when you have collected enough information to define the workflow. Do NOT call it until you have all required fields.",
      parameters: {
        type: "object",
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
      if (!process.env.OPENAI_API_KEY) {
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

        // Build OpenAI message list with the system prompt first.
        const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
          { role: "system", content: SYSTEM_PROMPT },
          ...req.messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        ];

        // Stream from OpenAI
        const sdkStream = await openai.chat.completions.create({
          model: MODELS.DISCOVERY,
          // max_completion_tokens (not max_tokens) for forward-compatibility with GPT-5.x.
          max_completion_tokens: 1024,
          tools: EMIT_WORKFLOW_SPEC_TOOL,
          messages: openaiMessages,
          stream: true,
        });

        let accumulatedText = "";
        // Accumulate streamed tool-call fragments keyed by their index.
        const toolCallAccumulators: Record<
          number,
          { name: string; args: string }
        > = {};

        for await (const chunk of sdkStream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          // Stream text deltas to the client in real time
          if (delta.content) {
            accumulatedText += delta.content;
            enqueue({ type: "delta", text: delta.content });
          }

          // Accumulate tool-call name + argument JSON fragments
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallAccumulators[idx]) {
                toolCallAccumulators[idx] = { name: "", args: "" };
              }
              if (tc.function?.name) {
                toolCallAccumulators[idx].name = tc.function.name;
              }
              if (tc.function?.arguments) {
                toolCallAccumulators[idx].args += tc.function.arguments;
              }
            }
          }
        }

        // Find an emit_workflow_spec tool call, if any
        const emitCall = Object.values(toolCallAccumulators).find(
          (tc) => tc.name === "emit_workflow_spec"
        );

        if (emitCall) {
          // Normalize loose model output into the strict schema (e.g. a Telegram
          // chatbot → webhook trigger) before validating, so the user NEVER sees
          // a raw validation error.
          let rawInput: Record<string, unknown> = {};
          try {
            rawInput = JSON.parse(emitCall.args) as Record<string, unknown>;
          } catch {
            rawInput = {};
          }

          const normalized = normalizeEmitInput(rawInput);
          const candidate = {
            id: crypto.randomUUID(),
            status: "draft" as const,
            template_id: pickTemplateId(normalized),
            ...normalized,
          };

          const result = workflowSpecSchema.safeParse(candidate);

          if (result.success) {
            const spec = result.data;
            const [savedSpec] = await Promise.all([
              saveSpec(req.userId, spec),
              saveConversation(
                req.userId,
                [
                  ...req.messages,
                  { role: "assistant", content: accumulatedText || "[workflow spec ready]" },
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
            // Never surface raw validation errors. Recover with a friendly nudge.
            console.error(
              "Discovery: spec validation failed after normalization:",
              JSON.stringify(result.error.issues)
            );
            const recover =
              accumulatedText ||
              "Almost there — which app should this use (Telegram, Google Sheets, or email), and what should it do?";
            if (!accumulatedText) enqueue({ type: "delta", text: recover });
            await saveConversation(
              req.userId,
              [...req.messages, { role: "assistant", content: recover }],
              conversationId
            );
          }
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
