-- Server-side engine support.

-- A channel can exist before its access token does (the account is known, the connection is not finished).
alter table channel_accounts alter column access_token_enc drop not null;

-- "First comment only": one firing per person per post per automation. A retried webhook just hits the constraint.
create table automation_firings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  automation_id uuid not null references automations(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  post_external_id text not null default '',
  comment_external_id text,
  created_at timestamptz not null default now(),
  unique (automation_id, contact_id, post_external_id)
);
create index on automation_firings (org_id);
create index on automation_firings (contact_id);
alter table automation_firings enable row level security;
create policy automation_firings_read on automation_firings for select using (is_org_member(org_id));

-- Which node a person's button belongs to, so a tap can continue the right flow.
alter table messages add column automation_run_id uuid references runs(id) on delete set null;

-- The engine reads and writes with the service role; browsers only read what their workspace owns (policies from 0001).
create index if not exists webhook_events_pending on webhook_events (received_at) where status = 'received';
