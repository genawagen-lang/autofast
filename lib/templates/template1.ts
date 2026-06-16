/**
 * lib/templates/template1.ts
 *
 * Template 1: "Form/Webhook → Google Sheets append + email notify"
 *
 * Linear workflow:
 *   Webhook trigger → Google Sheets append → SMTP email send
 *
 * Parameter map (filled at deploy time):
 *   sheet_id          — Google Sheets spreadsheet ID
 *   sheet_name        — Sheet/tab name (e.g. "Sheet1")
 *   column_mapping    — Object mapping n8n field names to spreadsheet columns
 *   notify_email      — Recipient email address for notifications
 *   notify_subject    — Email subject template
 *   notify_body       — Email body template (supports {{field}} interpolation)
 *
 * required_credentials: ["google_sheets", "send_email"]
 */

import type { Json } from "@/types";

// ---------------------------------------------------------------------------
// n8n workflow JSON (structurally valid: nodes[] + connections{})
// ---------------------------------------------------------------------------
export const template1N8nJson: Json = {
  name: "Form to Sheets + Email",
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
      id: "node-sheets-append",
      name: "Append to Google Sheets",
      type: "n8n-nodes-base.googleSheets",
      typeVersion: 4,
      position: [480, 300],
      credentials: {
        googleSheetsOAuth2Api: "{{google_sheets_credential_name}}",
      },
      parameters: {
        operation: "append",
        documentId: {
          __rl: true,
          value: "{{sheet_id}}",
          mode: "id",
        },
        sheetName: {
          __rl: true,
          value: "{{sheet_name}}",
          mode: "name",
        },
        columns: {
          mappingMode: "defineBelow",
          value: "={{$json}}",
          matchingColumns: [],
          schema: [],
        },
        options: {},
      },
    },
    {
      id: "node-email-send",
      name: "Send Email Notification",
      type: "n8n-nodes-base.emailSend",
      typeVersion: 2,
      position: [720, 300],
      credentials: {
        smtp: "{{send_email_credential_name}}",
      },
      parameters: {
        fromEmail: "{{from_email}}",
        toEmail: "={{$node['Webhook Trigger'].json['email'] || '{{notify_email}}'}}",
        subject: "{{notify_subject}}",
        text: "{{notify_body}}",
        options: {},
      },
    },
  ],
  connections: {
    "Webhook Trigger": {
      main: [
        [
          {
            node: "Append to Google Sheets",
            type: "main",
            index: 0,
          },
        ],
      ],
    },
    "Append to Google Sheets": {
      main: [
        [
          {
            node: "Send Email Notification",
            type: "main",
            index: 0,
          },
        ],
      ],
    },
  },
  settings: {
    executionOrder: "v1",
  },
  staticData: null,
  tags: [],
  pinData: {},
  versionId: "1.0.0",
  meta: {
    instanceId: "automation-app",
  },
};

/**
 * Parameter map for Template 1.
 * These are the deploy-time substitutions that the orchestrator must fill.
 */
export const template1ParameterMap = {
  sheet_id: {
    description: "Google Sheets spreadsheet ID (from the URL)",
    example: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
    required: true,
  },
  sheet_name: {
    description: "Name of the worksheet tab to append to",
    example: "Sheet1",
    required: true,
  },
  column_mapping: {
    description:
      "Object mapping incoming webhook field names to spreadsheet column headers",
    example: { name: "A", email: "B", message: "C" },
    required: true,
  },
  notify_email: {
    description: "Recipient email address for notifications",
    example: "admin@example.com",
    required: true,
  },
  notify_subject: {
    description: "Subject line of the notification email",
    example: "New form submission received",
    required: false,
  },
  notify_body: {
    description: "Body of the notification email; supports {{field}} tokens",
    example: "A new submission was received and appended to the sheet.",
    required: false,
  },
  from_email: {
    description: "Sender address shown in the notification email",
    example: "noreply@yourapp.com",
    required: true,
  },
  webhook_path: {
    description: "URL path segment for the webhook (auto-generated at deploy time)",
    example: "form-submit-abc123",
    required: false,
  },
};
