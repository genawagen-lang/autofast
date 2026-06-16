# Automation App

A Next.js SaaS platform that lets users describe automation workflows in plain language. An AI discovery agent translates the description into a structured `WorkflowSpec`, gathers credentials, then deploys the workflow to n8n.

## Folder structure

```
automation app/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx          # Magic-link login
│   │   └── auth/callback/route.ts  # OAuth code exchange
│   ├── (dashboard)/
│   │   └── dashboard/page.tsx      # Protected dashboard
│   └── layout.tsx / globals.css
├── components/
│   └── ui/                         # shadcn/ui components
├── lib/
│   ├── anthropic/
│   │   ├── client.ts               # Anthropic SDK client
│   │   └── models.ts               # Model ID constants
│   └── supabase/
│       ├── client.ts               # Browser client
│       ├── server.ts               # Server client
│       └── middleware.ts           # Session refresh helper
├── types/
│   └── index.ts                    # Shared contracts (source of truth)
├── middleware.ts                   # Route protection
├── .env.example                    # All required env vars documented
└── README.md
```

## Types (source of truth)

All agents import from `@/types`. The authoritative contracts are:

```ts
import { WorkflowSpec, workflowSpecSchema } from "@/types";
// also: Json, UserRow, ConversationRow, WorkflowSpecRow,
//        CredentialRow, TemplateRow, DeploymentRow
```

`WorkflowSpec` shape:

```ts
{
  id: string;            // uuid
  title: string;
  description: string;
  trigger: { type: "webhook" | "schedule" | "email"; config: Record<string, unknown> };
  actions: Array<{ type: "google_sheets_append" | "send_email" | "telegram_send"; config: Record<string, unknown> }>;
  required_credentials: string[];
  template_id: string;
  status: "draft" | "needs_credentials" | "testing" | "ready" | "deployed" | "error";
}
```

Use `workflowSpecSchema.parse(data)` to validate at runtime.

## Setup

1. Copy `.env.example` to `.env.local` and fill in your values:

   ```
   cp .env.example .env.local
   ```

2. Required env vars:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from your Supabase project settings
   - `SUPABASE_SERVICE_ROLE_KEY` — from Supabase > Settings > API
   - `ANTHROPIC_API_KEY` — from console.anthropic.com

3. Install dependencies:

   ```
   npm install
   ```

4. Run the dev server:

   ```
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000) to see the app. Without Supabase configured, the login page will load but auth operations will fail with a clear error.

## Model IDs

| Constant | Default | Override via |
|----------|---------|-------------|
| `MODELS.DISCOVERY` | `claude-haiku-4-5-20251001` | `ANTHROPIC_DISCOVERY_MODEL` |
| `MODELS.BUILDER` | `claude-sonnet-4-6` | `ANTHROPIC_BUILDER_MODEL` |
