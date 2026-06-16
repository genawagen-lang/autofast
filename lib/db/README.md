# lib/db — Database Interface

Server-side database access layer for the automation app.  All functions use
the Supabase SSR client (`lib/supabase/server.ts`) with RLS enforced.

The file is marked `server-only` — importing it in a client component is a
build error.

---

## Function Reference

### Conversations

```ts
saveConversation(userId, messages, conversationId?)  → { id }
getConversation(conversationId)                      → ConversationRow | null
```

- Pass `conversationId` to update an existing conversation.
- `messages` is stored as a JSONB array; pass the full array each time.

### Workflow Specs

```ts
saveSpec(userId, spec)            → { id, version }
getSpec(specId)                   → WorkflowSpecRow | null
updateSpecStatus(specId, status)  → void
```

- `saveSpec` auto-increments the version counter for the given `spec.id`.
  A brand-new spec should carry a `spec.id` from `crypto.randomUUID()`.
- `getSpec` returns the highest-version row.

### Credentials

```ts
saveCredential(userId, provider, token)         → void     // encrypts via Vault
getCredentialStatus(userId, provider)           → "connected" | "not_connected"
listCredentialStatuses(userId)                  → Array<{ provider, status }>
getDecryptedCredential(userId, provider)        → string | null  // SERVER-ONLY
```

- `saveCredential` calls `lib/vault/storeSecret` before writing; only the
  vault reference id is stored in the DB.  Raw tokens never touch the DB.
- `getDecryptedCredential` is gated by `server-only`; it must never be called
  from a route handler that returns the token to the browser.

### Templates

```ts
listTemplates()           → TemplateRow[]
getTemplate(templateId)   → TemplateRow | null
```

Templates are seeded via `supabase/seed.sql` or the `seedTemplates()` helper
in `lib/templates/index.ts`.

### Deployments

```ts
saveDeployment({ spec_id, n8n_workflow_id, status })  → { id }
getDeploymentBySpec(specId)                            → DeploymentRow | null
updateDeploymentError(n8nWorkflowId, error)            → void
listDeployments(userId)                                → DeploymentRow[]
```

- `listDeployments` joins through `workflow_specs` to enforce user ownership.

---

## Testing Locally

1. Start the Supabase local stack: `supabase start`
2. Apply migrations: `supabase db push` (or `supabase migration up`)
3. Seed templates: `supabase db seed` (uses `supabase/seed.sql`)
4. Set env vars in `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key>
   SUPABASE_SERVICE_ROLE_KEY=<local service role key>
   ```
5. Run the dev server: `npm run dev`
6. Exercise individual functions via a test route at `app/api/__test__/route.ts`
   (not committed; create ad-hoc).

### Vault in local dev

Supabase's local stack does not run Vault by default.  When
`SUPABASE_SERVICE_ROLE_KEY` is present but `vault.create_secret` RPC fails,
`lib/vault` degrades to a base64-encoded dev-fallback reference prefixed with
`dev_fallback:`.  A console warning is printed.  This fallback is intentionally
insecure and must not be used in production.
