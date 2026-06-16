# Automation App — Natural-Language → n8n (MVP v1)

A SaaS web app where non-technical users describe an automation in plain language and
the system builds, tests, and deploys a working **n8n** workflow for them. The user only
(1) describes what they want, (2) connects their accounts, (3) approves.

This repo is the **MVP foundation + one complete vertical slice**:
**Form/Webhook → Google Sheets append + email notify**, running end-to-end through every
agent stage behind local-dev stubs.

## How it works (the pipeline)

```
User chat ──▶ Discovery Agent ──▶ WorkflowSpec ──▶ Builder Agent ──▶ n8n JSON
 (Haiku)      (one Q at a time)   (shared          (adapts a verified   │
                                   contract)        template, Sonnet)   ▼
 Dashboard ◀── Deployment ◀── approve ◀── Testing Agent ◀── Orchestrator (state machine)
 (status,     (n8n REST or                (validate JSON +
  errors)      in-memory stub)             credential status + dry-run)
```

Agents never call each other directly — the **Orchestrator** (`lib/orchestrator`) drives
the state machine and all communication flows through the **WorkflowSpec** (`@/types`)
and the DB. Credentials are stored in Supabase Vault and **never** reach the client or any
LLM prompt.

## Architecture / key folders

```
app/
  (auth)/login, auth/callback        magic-link auth
  (dashboard)/dashboard              workflow list + status + last error
  (dashboard)/new                    chat (Discovery) + AI-Understanding approval card
  (dashboard)/connections            connect Google + Telegram (status pills)
  (dashboard)/workflows/[id]         Test → Deploy stepper (PASS/FAIL)
  api/chat                           streaming Discovery endpoint (Haiku, SSE)
  api/spec/[id]/{build,test,deploy}  Builder / Testing / Deployment
  api/orchestrator                   state-machine transitions
  api/credentials/{google,telegram}  OAuth + bot-token (real + dev stub)
  api/webhooks/n8n-error             failed-run sink → deployments.last_error
lib/
  agents/{discovery,builder,testing} the three Claude agents
  db/                                14-fn typed data layer (server-only)
  vault/                             Supabase Vault wrappers (+ dev fallback)
  n8n/                               REST client + in-memory stub (N8N_MODE)
  orchestrator/                      advance(specId) state machine
  templates/                         Template 1 (full) + 4 stubs + seed
  anthropic/                         Claude client + model config
  supabase/                          browser/server/middleware clients
types/index.ts                       WorkflowSpec + zod + DB row types (source of truth)
supabase/migrations, supabase/seed   schema (6 tables + RLS + Vault) + template seed
```

## WorkflowSpec (shared contract)

```ts
import { WorkflowSpec, workflowSpecSchema } from "@/types";
{
  id, title, description,
  trigger: { type: "webhook"|"schedule"|"email", config },
  actions: [{ type: "google_sheets_append"|"send_email"|"telegram_send", config }],
  required_credentials: string[],
  template_id, 
  status: "draft"|"needs_credentials"|"testing"|"ready"|"deployed"|"error",
}
```
`workflowSpecSchema.parse(data)` validates at runtime. (Note: the orchestrator uses
`"draft"` as the build-in-progress marker since the enum has no `"building"` state.)

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
```

The app **boots and renders without any keys** (`.env.local` ships with placeholder
Supabase values). Every screen is clickable; only the live operations below need keys.

### Adding keys (enables the real pipeline)

Copy `.env.example` → `.env.local` and fill in:

| Key | Unlocks | Without it |
|-----|---------|-----------|
| `ANTHROPIC_API_KEY` | Discovery chat + Builder | chat returns a friendly error event |
| `NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | auth + persistence + Vault | login/persistence fail with a clear message; Vault uses a marked `dev_fallback:` path |
| `GOOGLE_OAUTH_CLIENT_ID` / `..._SECRET` / `..._REDIRECT_URI` | real Google connect | `/connections` uses a clearly-labelled **dev stub** that marks Google "connected" |
| `TELEGRAM_BOT_TOKEN` (or paste in UI) | real Telegram validate | dev stub token |
| `N8N_MODE=live` + `N8N_BASE_URL` + `N8N_API_KEY` | deploy to a real n8n | `N8N_MODE=stub` (default) uses an in-memory n8n |

After setting Supabase keys, apply the schema + seed:
`supabase/migrations/0001_init.sql` then `supabase/seed.sql` (via Supabase CLI or SQL editor).

## Model IDs

| Constant | Default | Override |
|----------|---------|----------|
| `MODELS.DISCOVERY` | `claude-haiku-4-5-20251001` | `ANTHROPIC_DISCOVERY_MODEL` |
| `MODELS.BUILDER` | `claude-sonnet-4-6` | `ANTHROPIC_BUILDER_MODEL` (e.g. `claude-opus-4-8`) |

## Verify end-to-end (after keys)

1. Sign in via magic link at `/login`.
2. At `/new`, type: *"When someone submits my form, add them to a Google Sheet and email me."*
   Discovery asks for missing details, then shows the **AI Understanding** card.
3. Approve → `/workflows/[id]`: Builder adapts **Template 1**, Testing runs, status advances.
4. `/connections`: connect Google + email (real or dev stub) → status pills flip to Connected.
5. Approve & Deploy → workflow pushed to n8n (stub by default) → `/dashboard` shows it Live.
6. Monitoring: a failed run hits `/api/webhooks/n8n-error` → surfaces as plain-language
   `last_error` on the dashboard. (Stub exposes `getN8nStub().__injectError(id, msg)` to simulate.)

## Status of this build

- `npx tsc --noEmit` ✅ clean · `npm run build` ✅ clean (19 routes) · all pages render ✅
- Credentials never reach client/LLM ✅
- **Gated on your keys:** the live Claude pipeline run and real persistence (Anthropic +
  Supabase). The n8n deploy/monitoring path runs fully on the in-memory stub today.

## Deferred to v2 (out of scope)

Templates 2–5 full authoring (metadata-only now), loops/branches, mobile,
WhatsApp / Meta Lead Ads / Stripe, auto self-healing, production Google OAuth verification,
live hosted n8n.
```
