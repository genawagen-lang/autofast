# lib/templates — Workflow Template Catalog

Defines the five built-in workflow templates and provides a `seedTemplates()`
helper to populate the `templates` DB table.

---

## Template 1 — COMPLETE: Form / Webhook → Google Sheets + Email Notify

**File:** `template1.ts`

### n8n Workflow Structure

Three linear nodes with connections:

| # | Node Name | n8n Type | Role |
|---|-----------|----------|------|
| 1 | Webhook Trigger | `n8n-nodes-base.webhook` | Entry point; receives POST |
| 2 | Append to Google Sheets | `n8n-nodes-base.googleSheets` v4 | Appends payload as new row |
| 3 | Send Email Notification | `n8n-nodes-base.emailSend` v2 | Sends SMTP notification |

**Connections:**
```
Webhook Trigger  →  Append to Google Sheets  →  Send Email Notification
```

### Parameter Map (deploy-time substitutions)

| Parameter | Required | Description |
|-----------|----------|-------------|
| `sheet_id` | yes | Google Sheets spreadsheet ID |
| `sheet_name` | yes | Worksheet tab name |
| `column_mapping` | yes | Field → column header mapping |
| `notify_email` | yes | Notification recipient |
| `from_email` | yes | Sender address |
| `notify_subject` | no | Email subject line |
| `notify_body` | no | Email body text |
| `webhook_path` | no | URL path (auto-generated) |

### Required Credentials
- `google_sheets` — Google Sheets OAuth2
- `send_email` — SMTP credentials

---

## Templates 2–5 — Stubs

| ID | Name | Trigger | Actions |
|----|------|---------|---------|
| `tpl-schedule-sheets-telegram` | Scheduled Report → Sheets + Telegram | schedule | google_sheets_append, telegram_send |
| `tpl-email-parse-sheets` | Inbound Email Parser → Sheets | email | google_sheets_append |
| `tpl-webhook-telegram-notify` | Webhook → Telegram | webhook | telegram_send |
| `tpl-schedule-email-report` | Scheduled Email Digest | schedule | send_email |

Each stub has `n8n_json_template: { _todo: "...", nodes: [], connections: {} }`.
Full workflow JSON will be authored in a later sprint.

---

## Seeding

**SQL seeder** (`supabase/seed.sql`):
```sh
supabase db seed
# or
psql $DATABASE_URL -f supabase/seed.sql
```

**TypeScript seeder** (programmatic, e.g. in a migration script):
```ts
import { seedTemplates } from "@/lib/templates";
await seedTemplates();  // idempotent upsert
```

Requires `SUPABASE_SERVICE_ROLE_KEY` in the environment.
