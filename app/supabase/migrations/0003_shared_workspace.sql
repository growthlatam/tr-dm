-- One shared workspace per company e-mail domain.
-- The first person from a domain creates the workspace and owns it; later people from the same domain join it
-- as editors instead of getting a private empty one. Public mail providers never auto-join.

alter table orgs add column auto_join_domain text;
create unique index orgs_auto_join_domain_key on orgs (lower(auto_join_domain)) where auto_join_domain is not null;

create or replace function create_org(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_domain text := lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 2));
  v_public text[] := array['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','icloud.com','me.com','proton.me','protonmail.com','aol.com'];
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
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
