-- App-level additions on top of the base schema.

-- What the quick wizard saved (null once the flow was edited in the canvas) and whether the canvas owns the flow.
alter table automations add column wizard jsonb;
alter table automations add column custom boolean not null default false;
alter table automations add column default_language text not null default 'pt-BR'
  check (default_language in ('en','pt-BR','es-AR'));

-- First sign-in: the person creates their workspace and becomes its owner.
-- RLS blocks a direct insert into orgs (nobody is a member yet), so this runs with the table owner's rights
-- but only ever acts on auth.uid().
create or replace function create_org(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from org_members where user_id = auth.uid()) then
    raise exception 'already in a workspace';
  end if;
  insert into orgs (name) values (left(trim(p_name), 120)) returning id into v_org;
  insert into org_members (org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  return v_org;
end $$;
revoke all on function create_org(text) from public, anon;
grant execute on function create_org(text) to authenticated;

-- Publish = snapshot the draft as the next immutable version and make it live.
-- security invoker: row level security still decides who may do this.
create or replace function publish_automation(p_id uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare a automations%rowtype; v int; vid uuid;
begin
  select * into a from automations where id = p_id for update;
  if not found then raise exception 'automation not found'; end if;
  select coalesce(max(version), 0) + 1 into v from automation_versions where automation_id = p_id;
  insert into automation_versions (automation_id, org_id, version, graph, published_by)
    values (p_id, a.org_id, v, a.draft_graph, auth.uid()) returning id into vid;
  update automations set live_version_id = vid, status = 'live', has_unpublished_changes = false where id = p_id;
  return vid;
end $$;
revoke all on function publish_automation(uuid) from public, anon;
grant execute on function publish_automation(uuid) to authenticated;
