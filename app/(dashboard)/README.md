# Dashboard routes

All routes inside `app/(dashboard)/` require an authenticated Supabase session.
Unauthenticated requests are redirected to `/login` by middleware.

## Pages

### `/dashboard` — Automation list
- Server component.
- Calls `listDeployments(userId)` from `@/lib/db` (Wave 1A).
- Shows a card per workflow with a plain-language status pill and any error message.
- If `lib/db` is not yet resolved, renders an empty state gracefully (no crash).
- "Create automation" button links to `/new`.

### `/new` — Chat / Discovery
- Client component.
- Streams from `POST /api/chat` using SSE (`ReadableStream` + `TextDecoder`).
- Handles three event shapes:
  - `{type:"token", token:"..."}` / `{delta:"..."}` — appends to the streaming message.
  - `{type:"message", content:"..."}` — replaces the streaming message.
  - `{type:"spec_ready", spec:{...}, specId:"..."}` — stops streaming and shows the **AI Understanding** card.
- On Approve: `POST /api/orchestrator {specId, action:"approve"}` → navigates to `/workflows/[specId]`.
- Enter key sends; Shift+Enter inserts a newline.

### `/connections` — Connected accounts
- Client component.
- Fetches `GET /api/credentials/status` on mount.
- Shows three integrations: Google (Sheets + Gmail), Telegram.
- Google "Connect" → navigates to `/api/credentials/google/start`.
- Telegram "Connect" → Dialog where user pastes bot token → `POST /api/credentials/telegram`.

### `/workflows/[id]` — Test → Deploy view
- Client component.
- Fetches `GET /api/spec/[id]` for the plain-language summary.
- On mount, calls `POST /api/orchestrator {specId}` and polls every 3 s while status is `building` or `testing`.
- Renders a 4-step stepper: Building → Connect accounts → Running a test → Going live.
- On `test_passed`/`ready`: shows a preview card + "Approve & deploy" button.
- On `test_failed`: shows a plain-language reason + "Retry test" button.
- On `needs_credentials`: shows a link to `/connections`.
- On `deployed`: shows a "Live" banner.

## Component dependencies

| Component | Purpose |
|---|---|
| `components/chat/ChatMessage.tsx` | Renders user/assistant chat bubbles |
| `components/chat/SpecCard.tsx` | AI Understanding approval card |
| `components/workflow/WorkflowStepper.tsx` | 4-step progress stepper |
| `components/workflow/StatusPill.tsx` | Coloured badge for deployment status |

## Non-technical language

All user-facing text avoids terms like "n8n", "webhook", "OAuth", "token",
"API", "JSON". Technical concepts map to plain English throughout.
