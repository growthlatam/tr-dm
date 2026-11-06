-- Schema for the DM automation platform (Instagram + Messenger).
-- Postgres 15+ (Supabase). All times timestamptz (UTC). Multi-tenant by org_id.
-- Access rules: row level security, via is_org_member(org_id) / has_org_role(org_id, roles).

create extension if not exists pgcrypto;

create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;

-- ---------- tenancy ----------

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Sao_Paulo',
  default_language text not null default 'pt-BR'
    check (default_language in ('en','pt-BR','es-AR')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'agent'
    check (role in ('owner','admin','editor','agent','viewer')),
  ui_language text not null default 'pt-BR'
    check (ui_language in ('en','pt-BR','es-AR')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index on org_members (user_id);

create or replace function is_org_member(p_org uuid) returns boolean as $$
  select exists (select 1 from org_members m where m.org_id = p_org and m.user_id = auth.uid());
$$ language sql stable security definer;

create or replace function has_org_role(p_org uuid, p_roles text[]) returns boolean as $$
  select exists (select 1 from org_members m
                 where m.org_id = p_org and m.user_id = auth.uid() and m.role = any(p_roles));
$$ language sql stable security definer;

-- ---------- channels ----------

create table channel_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  channel text not null check (channel in ('instagram','messenger')),
  external_page_id text not null,          -- FB Page id
  external_ig_id text,                     -- IG professional account id (instagram only)
  display_name text not null,
  access_token_enc bytea not null,         -- encrypted at app layer (KMS key), never returned to client
  token_expires_at timestamptz,
  status text not null default 'connected'
    check (status in ('connected','token_expired','permission_missing','disconnected')),
  connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, external_page_id, external_ig_id)
);
create index on channel_accounts (org_id);

-- ---------- contacts ----------

create table contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  channel text not null check (channel in ('instagram','messenger')),
  external_id text not null,               -- PSID (messenger) or IGSID (instagram)
  status text not null default 'subscribed'
    check (status in ('subscribed','unsubscribed','blocked','visitor')),
  first_name text,
  last_name text,
  username text,                           -- IG handle
  email text,
  phone text,
  language text check (language in ('en','pt-BR','es-AR')),
  locale text,
  timezone text,
  follows_account boolean,
  follower_count integer,
  opted_in boolean not null default false,
  opt_in_source text check (opt_in_source in ('comment','ad','dm','ref_url','story','api','import')),
  window_expires_at timestamptz,           -- last user interaction + 24h
  last_interaction_at timestamptz,
  last_input_text text,
  last_trigger_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_account_id, external_id)
);
create index on contacts (org_id, status);
create index on contacts (org_id, language);
create index on contacts (org_id, last_interaction_at desc);
create index on contacts (window_expires_at) where window_expires_at is not null;

create table tags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

create table contact_tags (
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);
create index on contact_tags (tag_id);
create index on contact_tags (org_id);

create table field_defs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  scope text not null default 'user' check (scope in ('user','bot')),
  name text not null,
  type text not null check (type in ('text','number','date','datetime','boolean','array')),
  folder text,
  description text,
  archived boolean not null default false,
  bot_value jsonb,                         -- used only when scope = 'bot'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, scope, name)
);

create table contact_field_values (
  contact_id uuid not null references contacts(id) on delete cascade,
  field_id uuid not null references field_defs(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (contact_id, field_id)
);
create index on contact_field_values (field_id);
create index on contact_field_values (org_id);

create table segments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  filter jsonb not null,                   -- same condition schema the Condition node uses
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

-- ---------- assets (documents sent in replies) ----------

create table assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null check (kind in ('image','pdf','file','video','audio')),
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  storage_path text not null,
  language text check (language in ('en','pt-BR','es-AR')),   -- optional per-language document
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on assets (org_id, kind);

-- ---------- automations ----------

create table folders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

create table automations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  folder_id uuid references folders(id) on delete set null,
  name text not null,
  status text not null default 'draft' check (status in ('draft','live','paused','archived')),
  channels text[] not null default '{instagram,messenger}',
  languages text[] not null default '{pt-BR}',
  draft_graph jsonb not null default '{"nodes":[],"edges":[]}',   -- what the builder edits
  live_version_id uuid,                                           -- fk added below
  has_unpublished_changes boolean not null default false,
  locked_by_ad boolean not null default false,                    -- an active ad uses it; block edits
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on automations (org_id, status);
create index on automations (folder_id);

-- immutable snapshot taken at publish; runs always execute a version, never the draft
create table automation_versions (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references automations(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  version integer not null,
  graph jsonb not null,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (automation_id, version)
);
create index on automation_versions (org_id);
alter table automations
  add constraint automations_live_version_fk
  foreign key (live_version_id) references automation_versions(id) on delete set null;

create table triggers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  automation_id uuid not null references automations(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  type text not null check (type in (
    'ig_post_comment','ig_live_comment','ig_ad','ig_story_reply','ig_story_mention','ig_dm_keyword',
    'fb_post_comment','fb_ad','fb_keyword','ref_url')),
  enabled boolean not null default false,
  post_scope text check (post_scope in ('specific','all','next')),
  post_ids text[] not null default '{}',   -- IG media ids / FB post ids; "post ID" targeting
  ad_ids text[] not null default '{}',
  match_mode text not null default 'any'
    check (match_mode in ('any','is','contains','whole_word','begins_with','not_contains')),
  keywords text[] not null default '{}',
  exclude_keywords text[] not null default '{}',
  public_replies jsonb not null default '[]',   -- [{language, variations:[text,...]}]
  like_comment boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(keywords) <= 10),
  check (type not in ('ig_post_comment','fb_post_comment') or post_scope is not null)
);
create index on triggers (automation_id);
create index on triggers (channel_account_id, type) where enabled;
create index on triggers using gin (post_ids);
create index on triggers using gin (ad_ids);

-- one firing per contact per trigger per post (Meta rule: first comment only)
create table trigger_firings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  trigger_id uuid not null references triggers(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  post_external_id text not null default '',
  comment_external_id text,
  created_at timestamptz not null default now(),
  unique (trigger_id, contact_id, post_external_id)
);
create index on trigger_firings (org_id);
create index on trigger_firings (contact_id);

-- ---------- runtime ----------

create table runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  automation_id uuid not null references automations(id) on delete cascade,
  version_id uuid not null references automation_versions(id) on delete restrict,
  contact_id uuid not null references contacts(id) on delete cascade,
  trigger_id uuid references triggers(id) on delete set null,
  current_node_id text,
  status text not null default 'running'
    check (status in ('running','waiting','completed','failed','cancelled')),
  wait_until timestamptz,                  -- smart delay
  wait_for text check (wait_for in ('delay','user_reply','quick_reply')),
  context jsonb not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on runs (org_id, status);
create index on runs (automation_id);
create index on runs (contact_id);
create index on runs (wait_until) where status = 'waiting' and wait_for = 'delay';
create index on runs (contact_id) where status in ('running','waiting');

create table run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  automation_id uuid not null references automations(id) on delete cascade,
  node_id text not null,
  node_type text not null,
  outcome text not null check (outcome in ('entered','sent','skipped','failed','branch_yes','branch_no','waiting','passed')),
  detail jsonb,
  created_at timestamptz not null default now()
);
create index on run_steps (run_id);
create index on run_steps (automation_id, node_id, outcome);   -- per-node stats
create index on run_steps (org_id, created_at);

-- every inbound Meta webhook, deduped before processing
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'meta',
  external_event_id text not null,         -- comment id / message id / mid + type
  channel_account_id uuid references channel_accounts(id) on delete cascade,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received','processed','failed','ignored')),
  attempts integer not null default 0,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_event_id)
);
create index on webhook_events (status, received_at);

-- ---------- conversations ----------

create table conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  state text not null default 'open' check (state in ('open','closed')),
  assignee_id uuid references auth.users(id) on delete set null,
  labels text[] not null default '{}',
  automation_paused_until timestamptz,
  reminder_at timestamptz,
  unread_count integer not null default 0,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contact_id, channel_account_id)
);
create index on conversations (org_id, state, last_message_at desc);
create index on conversations (assignee_id, state);
create index on conversations (reminder_at) where reminder_at is not null;

create table messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  sender text not null check (sender in ('contact','bot','agent','broadcast','system')),
  sender_user_id uuid references auth.users(id) on delete set null,
  kind text not null,
  body jsonb not null,
  external_message_id text,
  automation_id uuid references automations(id) on delete set null,
  node_id text,
  status text not null default 'queued'
    check (status in ('queued','sent','delivered','read','failed')),
  failure_reason text,
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on messages (conversation_id, created_at);
create index on messages (org_id, created_at);
create index on messages (automation_id, node_id);
create unique index on messages (channel_account_id, external_message_id) where external_message_id is not null;
create index on messages (scheduled_for) where status = 'queued' and scheduled_for is not null;

create table conversation_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on conversation_notes (conversation_id);
create index on conversation_notes (org_id);

create table canned_responses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  shortcut text not null,
  body text not null,
  language text check (language in ('en','pt-BR','es-AR')),
  shared boolean not null default true,
  owner_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, shortcut, language)
);

-- ---------- broadcasts ----------

create table broadcasts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  name text not null,
  content jsonb not null,
  audience_filter jsonb not null,
  status text not null default 'draft'
    check (status in ('draft','scheduled','sending','sent','failed','cancelled')),
  scheduled_at timestamptz,
  sent_count integer not null default 0,
  delivered_count integer not null default 0,
  read_count integer not null default 0,
  clicked_count integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on broadcasts (org_id, status);
create index on broadcasts (scheduled_at) where status = 'scheduled';

-- ---------- analytics and audit ----------

create table events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  type text not null check (type in (
    'trigger_fired','message_sent','message_delivered','message_read','link_clicked',
    'quick_reply_tapped','data_collected','tag_added','lead_captured','handover','unsubscribed')),
  contact_id uuid references contacts(id) on delete cascade,
  automation_id uuid references automations(id) on delete set null,
  trigger_id uuid references triggers(id) on delete set null,
  post_external_id text,
  ad_id text,
  source text check (source in ('organic','paid','dm','other')),
  created_at timestamptz not null default now()
);
create index on events (org_id, type, created_at);
create index on events (automation_id, created_at);
create index on events (post_external_id) where post_external_id is not null;
create index on events (ad_id) where ad_id is not null;

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,                     -- e.g. automation.publish, channel.connect, contact.delete
  entity text not null,
  entity_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index on audit_log (org_id, created_at desc);
create index on audit_log (entity, entity_id);

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  key_hash text not null unique,            -- store a hash, show the key once
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on api_keys (org_id);

-- ---------- updated_at triggers ----------

do $$
declare t text;
begin
  for t in select table_name from information_schema.columns
           where table_schema = 'public' and column_name = 'updated_at'
  loop
    execute format('create trigger trg_%I_updated before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- ---------- row level security ----------
-- Every tenant table: members of the org can read; writes by role. Service role (server jobs, webhooks) bypasses RLS.

do $$
declare t text;
begin
  for t in select table_name from information_schema.columns
           where table_schema = 'public' and column_name = 'org_id'
             and table_name not in ('org_members')
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (is_org_member(org_id))', t || '_read', t);
    execute format('create policy %I on %I for all using (has_org_role(org_id, array[''owner'',''admin'',''editor''])) with check (has_org_role(org_id, array[''owner'',''admin'',''editor'']))', t || '_write', t);
  end loop;
end $$;

alter table orgs enable row level security;
create policy orgs_read on orgs for select using (is_org_member(id));
create policy orgs_write on orgs for update using (has_org_role(id, array['owner','admin']));

alter table org_members enable row level security;
create policy org_members_read on org_members for select using (is_org_member(org_id));
create policy org_members_write on org_members for all
  using (has_org_role(org_id, array['owner','admin'])) with check (has_org_role(org_id, array['owner','admin']));

-- Agents can work conversations but not edit automations: widen only these tables.
create policy conversations_agent on conversations for all
  using (has_org_role(org_id, array['agent'])) with check (has_org_role(org_id, array['agent']));
create policy messages_agent on messages for all
  using (has_org_role(org_id, array['agent'])) with check (has_org_role(org_id, array['agent']));
create policy notes_agent on conversation_notes for all
  using (has_org_role(org_id, array['agent'])) with check (has_org_role(org_id, array['agent']));
create policy canned_agent on canned_responses for all
  using (has_org_role(org_id, array['agent'])) with check (has_org_role(org_id, array['agent']));

-- channel tokens must never reach the browser: revoke column-level read for client roles
-- (a column revoke does nothing while a table-wide grant exists, so revoke the table and grant the safe columns)
revoke select on channel_accounts from anon, authenticated;
grant select (id, org_id, channel, external_page_id, external_ig_id, display_name, token_expires_at,
              status, connected_by, created_at, updated_at) on channel_accounts to authenticated;
