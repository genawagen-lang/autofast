/**
 * lib/templates/index.ts
 *
 * Canonical template definitions and seeder for the automation app.
 * All 5 templates are defined here; Template 1 carries a complete n8n workflow
 * JSON; Templates 2–5 are metadata stubs (n8n_json_template is a TODO object).
 *
 * Usage:
 *   import { seedTemplates } from "@/lib/templates";
 *   await seedTemplates();   // idempotent upsert
 */

import { createClient } from "@supabase/supabase-js";
import { template1N8nJson } from "./template1";
import type { Json } from "@/types";

// ---------------------------------------------------------------------------
// Template shape (matches the templates DB table)
// ---------------------------------------------------------------------------
interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  trigger_type: "webhook" | "schedule" | "email";
  action_types: string[];
  n8n_json_template: Json;
  required_credentials: string[];
}

// ---------------------------------------------------------------------------
// Template catalog
// ---------------------------------------------------------------------------
export const TEMPLATES: TemplateDefinition[] = [
  // -----------------------------------------------------------------------
  // Template 1: COMPLETE
  // -----------------------------------------------------------------------
  {
    id: "tpl-webhook-sheets-email",
    name: "Form / Webhook → Google Sheets + Email Notify",
    description:
      "Receives a webhook POST (e.g. from a form), appends the payload as a new row in Google Sheets, then sends an email notification to a configured recipient.",
    trigger_type: "webhook",
    action_types: ["google_sheets_append", "send_email"],
    required_credentials: ["google_sheets", "send_email"],
    n8n_json_template: template1N8nJson,
  },

  // -----------------------------------------------------------------------
  // Template 2: STUB
  // -----------------------------------------------------------------------
  {
    id: "tpl-schedule-sheets-telegram",
    name: "Scheduled Report → Google Sheets + Telegram",
    description:
      "Runs on a cron schedule, fetches data, appends a summary row to Google Sheets, and sends a Telegram message to a configured chat.",
    trigger_type: "schedule",
    action_types: ["google_sheets_append", "telegram_send"],
    required_credentials: ["google_sheets", "telegram"],
    n8n_json_template: {
      _todo: "Full n8n workflow JSON to be authored in a later sprint",
      nodes: [],
      connections: {},
    },
  },

  // -----------------------------------------------------------------------
  // Template 3: STUB
  // -----------------------------------------------------------------------
  {
    id: "tpl-email-parse-sheets",
    name: "Inbound Email Parser → Google Sheets",
    description:
      "Monitors an IMAP inbox, parses structured data from matching emails, and appends extracted fields to a Google Sheets spreadsheet.",
    trigger_type: "email",
    action_types: ["google_sheets_append"],
    required_credentials: ["email_imap", "google_sheets"],
    n8n_json_template: {
      _todo: "Full n8n workflow JSON to be authored in a later sprint",
      nodes: [],
      connections: {},
    },
  },

  // -----------------------------------------------------------------------
  // Template 4: STUB
  // -----------------------------------------------------------------------
  {
    id: "tpl-webhook-telegram-notify",
    name: "Webhook → Telegram Notification",
    description:
      "Receives a webhook POST and forwards a formatted message to a Telegram bot/channel. Ideal for alerting on external events or a simple reply bot.",
    trigger_type: "webhook",
    action_types: ["telegram_send"],
    required_credentials: ["telegram"],
    n8n_json_template: {
      name: "Webhook to Telegram Notification",
      nodes: [
        {
          id: "node-webhook-trigger",
          name: "Webhook Trigger",
          type: "n8n-nodes-base.webhook",
          typeVersion: 1,
          position: [240, 300],
          parameters: {
            httpMethod: "POST",
            path: "{{webhook_path}}",
            responseMode: "onReceived",
            responseData: "allEntries",
          },
        },
        {
          id: "node-telegram-send",
          name: "Send Telegram Message",
          type: "n8n-nodes-base.telegram",
          typeVersion: 1.2,
          position: [480, 300],
          credentials: { telegramApi: "{{telegram_credential_name}}" },
          parameters: {
            resource: "message",
            operation: "sendMessage",
            chatId: "{{chat_id}}",
            text: "{{message_text}}",
            additionalFields: {},
          },
        },
      ],
      connections: {
        "Webhook Trigger": {
          main: [[{ node: "Send Telegram Message", type: "main", index: 0 }]],
        },
      },
      settings: { executionOrder: "v1" },
      staticData: null,
      tags: [],
      pinData: {},
      versionId: "1.0.0",
      meta: { instanceId: "automation-app" },
    },
  },

  // -----------------------------------------------------------------------
  // Template 5: STUB
  // -----------------------------------------------------------------------
  {
    id: "tpl-schedule-email-report",
    name: "Scheduled Email Digest",
    description:
      "Compiles a periodic digest (daily/weekly) from configured data sources and sends it as a formatted email to one or more recipients.",
    trigger_type: "schedule",
    action_types: ["send_email"],
    required_credentials: ["send_email"],
    n8n_json_template: {
      _todo: "Full n8n workflow JSON to be authored in a later sprint",
      nodes: [],
      connections: {},
    },
  },
];

// ---------------------------------------------------------------------------
// seedTemplates — idempotent upsert via service-role client
// ---------------------------------------------------------------------------

/**
 * Upsert all template rows into the templates table.
 * Requires SUPABASE_SERVICE_ROLE_KEY in the environment (server-side only).
 * Safe to call repeatedly; existing rows are updated, new rows inserted.
 */
export async function seedTemplates(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "seedTemplates: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
    );
  }

  const svc = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { error } = await svc
    .from("templates")
    .upsert(TEMPLATES, { onConflict: "id" });

  if (error) {
    throw new Error(`seedTemplates: ${error.message}`);
  }

  console.log(`[templates] Seeded ${TEMPLATES.length} template(s) successfully.`);
}

// Re-export template1 helpers for orchestrator use
export { template1N8nJson, template1ParameterMap } from "./template1";
