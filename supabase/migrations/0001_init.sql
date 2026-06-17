-- =============================================================================
-- Migration 0001_init.sql
-- Creates core tables: conversations, workflow_specs, credentials,
-- templates, deployments. Enables RLS with owner-only policies.
-- Enables Supabase Vault extension for secret storage.
-- =============================================================================

-- Enable Vault extension for encrypted credential storage
create extension if not exists supabase_vault with schema vault;

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  messages    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

alter table conversations enable row level security;

create policy "conversations: owner select"
  on conversations for select
  using (auth.uid() = user_id);

create policy "conversations: owner insert"
  on conversations for insert
  with check (auth.uid() = user_id);

create policy "conversations: owner update"
  on conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "conversations: owner delete"
  on conversations for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- workflow_specs  (versioned)
-- ---------------------------------------------------------------------------
create table if not exists workflow_specs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  version     integer not null default 1,
  spec        jsonb not null,
  status      text not null default 'draft'
                check (status in ('draft','needs_credentials','testing','ready','deployed','error')),
  created_at  timestamptz not null default now()
);

create index if not exists workflow_specs_user_id_idx on workflow_specs(user_id);

alter table workflow_specs enable row level security;

create policy "workflow_specs: owner select"
  on workflow_specs for select
  using (auth.uid() = user_id);

create policy "workflow_specs: owner insert"
  on workflow_specs for insert
  with check (auth.uid() = user_id);

create policy "workflow_specs: owner update"
  on workflow_specs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "workflow_specs: owner delete"
  on workflow_specs for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- credentials
-- Stores only a Vault secret reference id — never the raw token.
-- vault_secret_id references vault.secrets(id) (managed by Supabase Vault).
-- ---------------------------------------------------------------------------
create table if not exists credentials (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  provider          text not null,
  vault_secret_id   text,                  -- vault.secrets uuid (prod) or "dev_fallback:..." ref (local dev); null if unset
  status            text not null default 'active'
                      check (status in ('active','revoked','expired')),
  created_at        timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists credentials_user_id_idx on credentials(user_id);

alter table credentials enable row level security;

-- Credentials are never exposed client-side; RLS denies all direct access.
-- Server-side service-role client bypasses RLS for reads/writes.
create policy "credentials: owner select"
  on credentials for select
  using (auth.uid() = user_id);

create policy "credentials: owner insert"
  on credentials for insert
  with check (auth.uid() = user_id);

create policy "credentials: owner update"
  on credentials for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "credentials: owner delete"
  on credentials for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- templates  (read-only seed data; no user ownership needed)
-- ---------------------------------------------------------------------------
create table if not exists templates (
  id                  text primary key,   -- human-readable slug
  name                text not null,
  description         text not null,
  trigger_type        text not null
                        check (trigger_type in ('webhook','schedule','email')),
  action_types        text[] not null,
  n8n_json_template   jsonb not null,
  required_credentials text[] not null default '{}',
  created_at          timestamptz not null default now()
);

-- Public read; only service-role can insert/update (seed data)
alter table templates enable row level security;

create policy "templates: public read"
  on templates for select
  using (true);

-- ---------------------------------------------------------------------------
-- deployments
-- ---------------------------------------------------------------------------
create table if not exists deployments (
  id                uuid primary key default gen_random_uuid(),
  spec_id           uuid not null references workflow_specs(id) on delete cascade,
  n8n_workflow_id   text not null,
  status            text not null default 'pending'
                      check (status in ('pending','active','stopped','error')),
  last_run          timestamptz,
  last_error        text,
  created_at        timestamptz not null default now()
);

create index if not exists deployments_spec_id_idx on deployments(spec_id);

-- Deployments inherit access through spec_id; check via subquery on workflow_specs
alter table deployments enable row level security;

create policy "deployments: owner select"
  on deployments for select
  using (
    exists (
      select 1 from workflow_specs ws
      where ws.id = spec_id and ws.user_id = auth.uid()
    )
  );

create policy "deployments: owner insert"
  on deployments for insert
  with check (
    exists (
      select 1 from workflow_specs ws
      where ws.id = spec_id and ws.user_id = auth.uid()
    )
  );

create policy "deployments: owner update"
  on deployments for update
  using (
    exists (
      select 1 from workflow_specs ws
      where ws.id = spec_id and ws.user_id = auth.uid()
    )
  );

create policy "deployments: owner delete"
  on deployments for delete
  using (
    exists (
      select 1 from workflow_specs ws
      where ws.id = spec_id and ws.user_id = auth.uid()
    )
  );
