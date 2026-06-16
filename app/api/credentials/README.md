# Credential API routes

All routes require an authenticated Supabase session (checked server-side via `lib/supabase/server`).
Tokens are **never** returned to the browser — they flow from provider → server → `saveCredential()`.

## Routes

### `GET /api/credentials/google/start`
Initiates Google OAuth.

**Production path:**
1. Builds Google consent URL with scopes: `spreadsheets` + `gmail.send` + `openid` + `email`.
2. Redirects the user to Google's consent screen.
3. After consent, Google redirects to `/api/credentials/google/callback`.

**Dev stub (when `GOOGLE_OAUTH_CLIENT_ID` is unset):**
- Skips OAuth entirely.
- Calls `saveCredential(userId, "google_sheets", "dev-stub-token")` and `saveCredential(userId, "send_email", "dev-stub-token")`.
- Redirects to `/connections?notice=google_dev_stub`.
- Logged with `console.warn("[DEV STUB] ...")`.

### `GET /api/credentials/google/callback`
Exchanges the authorization code for tokens server-side.

**Production path:**
1. Exchanges `code` for `access_token` + `refresh_token` via `https://oauth2.googleapis.com/token`.
2. Stores `{access_token, refresh_token}` (JSON-encoded) via `saveCredential()` for both `google_sheets` and `send_email` providers.
3. Redirects to `/connections?notice=google_connected`.

**Dev stub (when `GOOGLE_OAUTH_CLIENT_ID` is unset):**
- Same stub behavior as `/start` — guards against direct URL access in dev.

**Error cases:** redirects to `/connections?error=<reason>`.

### `POST /api/credentials/telegram`
Validates and stores a Telegram bot token.

**Request body:** `{ token: string }`

**Production path:**
1. Calls `https://api.telegram.org/bot<token>/getMe` to verify the token.
2. On success, calls `saveCredential(userId, "telegram", token)`.
3. Returns `{ ok: true }`.
4. On failure, returns `{ error: "<friendly message>" }`.

**Dev stub (when token is empty/missing in non-production):**
- Stores `"dev-stub-telegram-token"` via `saveCredential`.
- Returns `{ ok: true, stub: true }`.

### `GET /api/credentials/status`
Returns connection status for all providers — used by the connections page.

**Response:** `[{ provider: string, connected: boolean }]`

Providers returned: `google_sheets`, `send_email`, `telegram`.

Never returns raw tokens or credential details.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Prod only | Google OAuth client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Prod only | Google OAuth client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | Optional | Override callback URL (default: `$NEXT_PUBLIC_APP_URL/api/credentials/google/callback`) |
| `NEXT_PUBLIC_APP_URL` | Recommended | Base URL for redirects (default: `http://localhost:3000`) |

## Dependency on `@/lib/db`

All routes use a dynamic `require("@/lib/db")` wrapped in try/catch.
If `lib/db` is unavailable (sibling Wave 1A in progress), routes degrade gracefully:
- `/status` returns all providers as disconnected.
- `/google/start` and `/google/callback` log a warning and skip persistence.
- `/telegram` logs a warning and skips persistence.
