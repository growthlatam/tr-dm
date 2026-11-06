-- E-mail allowlist: the only way in. No passwords, no e-mails sent.
-- Browser clients can neither read nor write it; only the server (service role) and the database functions can.

create table allowed_emails (
  email text primary key check (email = lower(email) and position('@' in email) > 1),
  note text,
  created_at timestamptz not null default now()
);
alter table allowed_emails enable row level security;   -- no policies = no access for anon / authenticated
revoke all on allowed_emails from anon, authenticated;

-- Even if someone obtains a session by another route (for example a self sign-up through the public auth API),
-- they cannot get a workspace unless their e-mail is on the list. Without membership, row level security shows them nothing.
create or replace function create_org(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_domain text := split_part(v_email, '@', 2);
  v_public text[] := array['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','icloud.com','me.com','proton.me','protonmail.com','aol.com'];
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from allowed_emails where email = v_email) then raise exception 'e-mail not authorized'; end if;
  if exists (select 1 from org_members where user_id = auth.uid()) then
    raise exception 'already in a workspace';
  end if;
  if v_domain <> '' and not (v_domain = any (v_public)) then
    select id into v_org from orgs where lower(auto_join_domain) = v_domain;
    if v_org is not null then
      insert into org_members (org_id, user_id, role) values (v_org, auth.uid(), 'editor');
      return v_org;
    end if;
  end if;
  insert into orgs (name, auto_join_domain)
    values (left(trim(p_name), 120), case when v_domain <> '' and not (v_domain = any (v_public)) then v_domain end)
    returning id into v_org;
  insert into org_members (org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  return v_org;
end $$;
