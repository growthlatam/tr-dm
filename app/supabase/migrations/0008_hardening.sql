-- Findings from the automated security review of the first commit.

-- 1) Channel accounts are written only by the server (the connect and disconnect routes use the service role).
--    Before this, any editor could insert a row claiming another workspace's Instagram id and receive its events.
revoke insert, update, delete on channel_accounts from authenticated, anon;
drop policy if exists channel_accounts_write on channel_accounts;
-- One workspace per Instagram account and per Page, whichever column holds the id.
create unique index if not exists channel_accounts_ig_unique on channel_accounts (channel, external_ig_id) where external_ig_id is not null;
create unique index if not exists channel_accounts_page_unique on channel_accounts (channel, external_page_id);

-- 2) Only owners create, change or remove owners. Admins manage everyone else.
drop policy if exists org_members_write on org_members;
create policy org_members_insert on org_members for insert to authenticated
  with check (has_org_role(org_id, array['owner']) or (has_org_role(org_id, array['admin']) and role <> 'owner'));
create policy org_members_update on org_members for update to authenticated
  using (has_org_role(org_id, array['owner']) or (has_org_role(org_id, array['admin']) and role <> 'owner'))
  with check (has_org_role(org_id, array['owner']) or (has_org_role(org_id, array['admin']) and role <> 'owner'));
create policy org_members_delete on org_members for delete to authenticated
  using (has_org_role(org_id, array['owner']) or (has_org_role(org_id, array['admin']) and role <> 'owner'));
