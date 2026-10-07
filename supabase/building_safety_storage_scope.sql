-- Fix building-safety file scope using the deployed policy names.
-- Review and test in staging before running against production.
-- Does not change records, bucket visibility or staff/admin policies.
begin;

alter policy "portfolio scoped safety storage read" on storage.objects
using (
  bucket_id = 'building-safety-documents'
  and objects.name ~ '^[1-9][0-9]*/[^/]+$'
  and exists (
    select 1 from public.portal_members m
    join public.blocks b on b.id::text = split_part(objects.name, '/', 1)
    where m.email = lower((select auth.jwt()->>'email'))
      and (m.role = 'owner'
        or (m.role = 'manager' and m.portfolio_manager = b.manager))
  )
);

alter policy "portfolio scoped safety storage insert" on storage.objects
with check (
  bucket_id = 'building-safety-documents'
  and objects.name ~ '^[1-9][0-9]*/[^/]+$'
  and exists (
    select 1 from public.portal_members m
    join public.blocks b on b.id::text = split_part(objects.name, '/', 1)
    where m.email = lower((select auth.jwt()->>'email'))
      and (m.role = 'owner'
        or (m.role = 'manager' and m.portfolio_manager = b.manager))
  )
);

alter policy "portfolio scoped safety storage delete" on storage.objects
using (
  bucket_id = 'building-safety-documents'
  and objects.name ~ '^[1-9][0-9]*/[^/]+$'
  and exists (
    select 1 from public.portal_members m
    join public.blocks b on b.id::text = split_part(objects.name, '/', 1)
    where m.email = lower((select auth.jwt()->>'email'))
      and (m.role = 'owner'
        or (m.role = 'manager' and m.portfolio_manager = b.manager))
  )
);

commit;
