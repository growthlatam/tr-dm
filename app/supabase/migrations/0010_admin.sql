-- Master administrator. Only people listed here can open the admin panel (users, workspaces, who is in which workspace).
-- Browsers can neither read nor write this table: the admin routes check it on the server with the service role.
create table app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table app_admins enable row level security;   -- no policies = no access for anon / authenticated
revoke all on app_admins from anon, authenticated;

-- Workspaces are now handed out by the administrator. Nobody creates one by signing in, and the domain auto-join is gone:
-- a person sees only the workspaces the administrator put them in.
create or replace function create_org(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from app_admins where user_id = auth.uid()) then raise exception 'only the administrator creates workspaces'; end if;
  insert into orgs (name) values (left(trim(p_name), 120)) returning id into v_org;
  insert into org_members (org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  return v_org;
end $$;
revoke all on function create_org(text) from public, anon;
grant execute on function create_org(text) to authenticated;
