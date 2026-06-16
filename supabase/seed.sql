-- =============================================================================
-- supabase/seed.sql
-- Inserts the 5 workflow template rows.
-- Run with: supabase db seed  OR  psql -f seed.sql
-- Uses ON CONFLICT DO UPDATE so it is safe to re-run.
-- =============================================================================

insert into templates (id, name, description, trigger_type, action_types, n8n_json_template, required_credentials)
values
  (
    'tpl-webhook-sheets-email',
    'Form / Webhook → Google Sheets + Email Notify',
    'Receives a webhook POST, appends the payload as a new row in Google Sheets, then sends an email notification.',
    'webhook',
    ARRAY['google_sheets_append', 'send_email'],
    '{
      "name": "Form to Sheets + Email",
      "nodes": [
        {
          "id": "node-webhook-trigger",
          "name": "Webhook Trigger",
          "type": "n8n-nodes-base.webhook",
          "typeVersion": 1,
          "position": [240, 300],
          "parameters": {
            "httpMethod": "POST",
            "path": "{{webhook_path}}",
            "responseMode": "onReceived",
            "responseData": "allEntries"
          }
        },
        {
          "id": "node-sheets-append",
          "name": "Append to Google Sheets",
          "type": "n8n-nodes-base.googleSheets",
          "typeVersion": 4,
          "position": [480, 300],
          "credentials": {
            "googleSheetsOAuth2Api": "{{google_sheets_credential_name}}"
          },
          "parameters": {
            "operation": "append",
            "documentId": { "__rl": true, "value": "{{sheet_id}}", "mode": "id" },
            "sheetName": { "__rl": true, "value": "{{sheet_name}}", "mode": "name" },
            "columns": { "mappingMode": "defineBelow", "value": "={{$json}}", "matchingColumns": [], "schema": [] },
            "options": {}
          }
        },
        {
          "id": "node-email-send",
          "name": "Send Email Notification",
          "type": "n8n-nodes-base.emailSend",
          "typeVersion": 2,
          "position": [720, 300],
          "credentials": { "smtp": "{{send_email_credential_name}}" },
          "parameters": {
            "fromEmail": "{{from_email}}",
            "toEmail": "={{$node[''Webhook Trigger''].json[''email''] || ''{{notify_email}}''}}",
            "subject": "{{notify_subject}}",
            "text": "{{notify_body}}",
            "options": {}
          }
        }
      ],
      "connections": {
        "Webhook Trigger": { "main": [[{ "node": "Append to Google Sheets", "type": "main", "index": 0 }]] },
        "Append to Google Sheets": { "main": [[{ "node": "Send Email Notification", "type": "main", "index": 0 }]] }
      },
      "settings": { "executionOrder": "v1" },
      "staticData": null,
      "tags": [],
      "pinData": {},
      "versionId": "1.0.0",
      "meta": { "instanceId": "automation-app" }
    }'::jsonb,
    ARRAY['google_sheets', 'send_email']
  ),
  (
    'tpl-schedule-sheets-telegram',
    'Scheduled Report → Google Sheets + Telegram',
    'Runs on a cron schedule, fetches data, appends to Google Sheets, and sends a Telegram message.',
    'schedule',
    ARRAY['google_sheets_append', 'telegram_send'],
    '{"_todo": "Full n8n workflow JSON to be authored in a later sprint", "nodes": [], "connections": {}}'::jsonb,
    ARRAY['google_sheets', 'telegram']
  ),
  (
    'tpl-email-parse-sheets',
    'Inbound Email Parser → Google Sheets',
    'Monitors an IMAP inbox, parses structured data from matching emails, and appends extracted fields to Google Sheets.',
    'email',
    ARRAY['google_sheets_append'],
    '{"_todo": "Full n8n workflow JSON to be authored in a later sprint", "nodes": [], "connections": {}}'::jsonb,
    ARRAY['email_imap', 'google_sheets']
  ),
  (
    'tpl-webhook-telegram-notify',
    'Webhook → Telegram Notification',
    'Receives a webhook POST and forwards a formatted message to a Telegram bot/channel.',
    'webhook',
    ARRAY['telegram_send'],
    '{"_todo": "Full n8n workflow JSON to be authored in a later sprint", "nodes": [], "connections": {}}'::jsonb,
    ARRAY['telegram']
  ),
  (
    'tpl-schedule-email-report',
    'Scheduled Email Digest',
    'Compiles a periodic digest from configured data sources and sends it as a formatted email.',
    'schedule',
    ARRAY['send_email'],
    '{"_todo": "Full n8n workflow JSON to be authored in a later sprint", "nodes": [], "connections": {}}'::jsonb,
    ARRAY['send_email']
  )
on conflict (id) do update set
  name                = excluded.name,
  description         = excluded.description,
  trigger_type        = excluded.trigger_type,
  action_types        = excluded.action_types,
  n8n_json_template   = excluded.n8n_json_template,
  required_credentials = excluded.required_credentials;
