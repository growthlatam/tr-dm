-- Private bucket for the documents sent in replies. Layout: <org id>/<random>.pdf
-- Only PDFs up to 25 MB (Meta's limit for file attachments). Nobody gets a public URL: the sender makes a short-lived signed URL.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assets', 'assets', false, 26214400, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 26214400, allowed_mime_types = array['application/pdf'];

-- The workspace an object path belongs to, or null if the first folder is not a uuid.
create or replace function org_of_path(p text) returns uuid language sql immutable as $$
  select case when split_part(p, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(p, '/', 1)::uuid end
$$;

create policy assets_read on storage.objects for select to authenticated
  using (bucket_id = 'assets' and is_org_member(org_of_path(name)));
create policy assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'assets' and has_org_role(org_of_path(name), array['owner','admin','editor']));
create policy assets_update on storage.objects for update to authenticated
  using (bucket_id = 'assets' and has_org_role(org_of_path(name), array['owner','admin','editor']))
  with check (bucket_id = 'assets' and has_org_role(org_of_path(name), array['owner','admin','editor']));
create policy assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'assets' and has_org_role(org_of_path(name), array['owner','admin','editor']));
