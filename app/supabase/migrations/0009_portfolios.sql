-- Workspace > Business Portfolio connection > Instagram account > automations.
-- A portfolio connection is one Meta login that shared several Instagram accounts. The token stays on each account row
-- (so the sender and webhook code did not change); the connection groups them and carries the name the team chose.

create table portfolio_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);
create index on portfolio_connections (org_id);
create trigger portfolio_connections_updated before update on portfolio_connections for each row execute function set_updated_at();

alter table portfolio_connections enable row level security;
-- members read; only the server (service role) writes, like channel_accounts
create policy portfolio_connections_read on portfolio_connections for select to authenticated using (is_org_member(org_id));
revoke insert, update, delete on portfolio_connections from authenticated, anon;

alter table channel_accounts add column portfolio_id uuid references portfolio_connections(id) on delete set null;
create index on channel_accounts (portfolio_id);
grant select (portfolio_id) on channel_accounts to authenticated;

-- Each automation belongs to exactly one account.
alter table automations add column channel_account_id uuid references channel_accounts(id) on delete cascade;
create index on automations (channel_account_id, status);

-- Existing automations: the workspace's first connected account (today every workspace has at most a few).
update automations a set channel_account_id = (
  select c.id from channel_accounts c where c.org_id = a.org_id order by (c.status = 'connected') desc, c.created_at limit 1
) where a.channel_account_id is null;

-- The account must belong to the same workspace as the automation (a browser could otherwise point at someone else's account id).
create or replace function automations_check_account() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.channel_account_id is not null
     and not exists (select 1 from channel_accounts c where c.id = new.channel_account_id and c.org_id = new.org_id) then
    raise exception 'account is not in this workspace';
  end if;
  return new;
end $$;
create trigger automations_account_check before insert or update of channel_account_id, org_id on automations
  for each row execute function automations_check_account();

-- Copy an automation to another account (the "export" button). RLS still decides who may do it: security invoker.
-- The copy is a draft: it never goes live on the other account until someone publishes it there.
create or replace function copy_automation(p_id uuid, p_account uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare a automations%rowtype; nid uuid := gen_random_uuid();
begin
  select * into a from automations where id = p_id;
  if not found then raise exception 'automation not found'; end if;
  -- same workspace only: the PDFs and tags of a flow live in its workspace, so a copy never reaches into another one
  if not exists (select 1 from channel_accounts c where c.id = p_account and c.org_id = a.org_id) then
    raise exception 'account is not in this workspace';
  end if;
  insert into automations (id, org_id, name, status, channels, languages, draft_graph, has_unpublished_changes, wizard, custom, default_language, channel_account_id, created_by)
  values (nid, a.org_id, left(a.name, 70) || ' (copy)', 'draft', a.channels, a.languages,
          coalesce(a.draft_graph, '{"nodes":[],"edges":[]}'), true, a.wizard, a.custom, a.default_language, p_account, auth.uid());
  return nid;
end $$;
revoke all on function copy_automation(uuid, uuid) from public, anon;
grant execute on function copy_automation(uuid, uuid) to authenticated;
