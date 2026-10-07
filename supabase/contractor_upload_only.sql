-- Apply after reviewing the deployed policies and deploying the matching UI.
-- Remove contractor document deletion; retain staff policies and own-file uploads/reads.
-- Transactional and safe to rerun. This does not delete any records or files.
begin;
drop policy if exists "contractors delete own documents" on public.contractor_documents;
drop policy if exists "contractors delete own storage" on storage.objects;
drop policy if exists "contractor removes unsubmitted uploads" on storage.objects;
commit;
