-- Inbox support: who is on my team, and numbers per automation.

-- Browsers cannot read auth.users, so team members (with their e-mail) come from here.
-- Only members of the caller's own workspaces are returned.
create or replace function org_team() returns table (user_id uuid, email text, role text)
language sql stable security definer set search_path = public, auth as $$
  select m.user_id, u.email::text, m.role
  from org_members m join auth.users u on u.id = m.user_id
  where m.org_id in (select org_id from org_members where user_id = auth.uid())
  order by u.email;
$$;
revoke all on function org_team() from public, anon;
grant execute on function org_team() to authenticated;

-- Per-automation numbers. security invoker: row level security limits it to the caller's workspace.
create or replace function automation_stats() returns table (automation_id uuid, runs bigint, contacts bigint, sent bigint, taps bigint, docs bigint)
language sql stable security invoker set search_path = public as $$
  select a.id,
    (select count(*) from events e where e.automation_id = a.id and e.type = 'trigger_fired'),
    (select count(distinct e.contact_id) from events e where e.automation_id = a.id and e.type = 'trigger_fired'),
    (select count(*) from messages m where m.automation_id = a.id and m.direction = 'out' and m.status in ('sent','delivered','read')),
    (select count(*) from events e where e.automation_id = a.id and e.type = 'quick_reply_tapped'),
    (select count(*) from messages m where m.automation_id = a.id and m.kind = 'doc' and m.status in ('sent','delivered','read'))
  from automations a;
$$;
revoke all on function automation_stats() from public, anon;
grant execute on function automation_stats() to authenticated;
