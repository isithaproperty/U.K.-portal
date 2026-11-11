-- Review-only additive proposal. Apply after work_order_workflow.sql, with explicit rollout approval.
-- No existing contractor policies, submissions, payment fields or email queues are changed.
begin;
create table public.staff_work_order_documents (
 id uuid primary key,
 work_order_id bigint not null references public.work_orders(id),
 contractor_id bigint not null references public.contractors(id),
 contractor_email text not null,
 document_type text not null check(document_type in ('invoice','job-card')),
 storage_path text not null unique,
 original_name text not null check(length(btrim(original_name)) between 1 and 200),
 uploaded_by uuid not null,
 uploaded_by_email text not null,
 uploaded_at timestamptz not null default now(),
 source text not null default 'Staff upload' check(source='Staff upload'),
 check(storage_path ~ '^[1-9][0-9]{0,17}/[0-9a-f-]{36}/(invoice|job-card)\.(pdf|jpg|png)$'),
 check(storage_path = work_order_id::text||'/'||id::text||'/'||document_type||'.'||split_part(storage_path,'.',2))
);
create index staff_wo_document_work_order_idx on public.staff_work_order_documents(work_order_id);
alter table public.staff_work_order_documents enable row level security;
revoke all on public.staff_work_order_documents from public,anon,authenticated;
grant select on public.staff_work_order_documents to authenticated;
grant insert(id,work_order_id,contractor_id,document_type,storage_path,original_name) on public.staff_work_order_documents to authenticated;
-- Private lookup needs to inspect the real portfolio independently of caller-visible rows.
create function private.staff_can_manage_wo_document(p_id bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from public.work_orders w join public.blocks b on b.id=w.block_id
 join public.portal_members m on m.email=lower(auth.jwt()->>'email')
 where w.id=p_id and (m.role in ('owner','admin') or (m.role='manager' and length(btrim(m.portfolio_manager))>0 and m.portfolio_manager=b.manager)));
$$;
create function private.staff_wo_storage_access(p_name text,p_write boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare wo bigint;
begin
 if auth.uid() is null or p_name !~ '^[1-9][0-9]{0,17}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(invoice|job-card)\.(pdf|jpg|png)$' then return false; end if;
 wo:=split_part(p_name,'/',1)::bigint;
 if private.staff_can_manage_wo_document(wo) then
  return not p_write or exists(select 1 from public.work_orders w where w.id=wo and w.contractor_id is not null and w.status<>'Cancelled');
 end if;
 if p_write then return false; end if;
 return exists(select 1 from public.staff_work_order_documents d
 join public.work_orders w on w.id=d.work_order_id join public.contractors c on c.id=d.contractor_id
 where d.storage_path=p_name and w.contractor_id=d.contractor_id and w.status<>'Cancelled'
 and d.contractor_email=lower(auth.jwt()->>'email') and lower(c.email)=d.contractor_email);
end $$;
create function private.prepare_staff_wo_document() returns trigger
language plpgsql security definer set search_path='' as $$
declare w public.work_orders%rowtype; mime text; bytes bigint;
begin
 if not private.staff_can_manage_wo_document(new.work_order_id) then raise exception 'Staff access required' using errcode='42501'; end if;
 select * into w from public.work_orders where id=new.work_order_id for update;
 if not private.staff_can_manage_wo_document(new.work_order_id) then raise exception 'Staff access changed' using errcode='42501'; end if;
 if w.contractor_id is null or w.status='Cancelled' then raise exception 'Choose an assigned, non-cancelled work order'; end if;
 if new.contractor_id is distinct from w.contractor_id then raise exception 'The assigned contractor changed. Reload before uploading'; end if;
 new.contractor_id:=w.contractor_id;
 select lower(coalesce(email,'')) into new.contractor_email from public.contractors where id=w.contractor_id;
 new.uploaded_by:=auth.uid(); new.uploaded_by_email:=lower(auth.jwt()->>'email'); new.uploaded_at:=now(); new.source:='Staff upload';
 select o.metadata->>'mimetype', (o.metadata->>'size')::bigint into mime,bytes from storage.objects o
 where o.bucket_id='staff-work-order-documents' and o.name=new.storage_path and o.owner_id=auth.uid()::text;
 if bytes is null or bytes<1 or bytes>10485760 or mime not in ('application/pdf','image/jpeg','image/png') or mime is null
 or split_part(new.storage_path,'.',2)<>(case mime when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' end)
 then raise exception 'A valid owned PDF, JPG or PNG upload up to 10 MB is required'; end if;
 return new;
end $$;
revoke all on function private.staff_can_manage_wo_document(bigint),private.staff_wo_storage_access(text,boolean),private.prepare_staff_wo_document() from public,anon,authenticated;
grant execute on function private.staff_can_manage_wo_document(bigint),private.staff_wo_storage_access(text,boolean) to authenticated;
create trigger prepare_staff_wo_document before insert on public.staff_work_order_documents for each row execute function private.prepare_staff_wo_document();
create policy "scoped staff insert work order documents" on public.staff_work_order_documents for insert to authenticated with check(private.staff_can_manage_wo_document(work_order_id) and uploaded_by=auth.uid());
create policy "scoped staff and assigned contractor read staff documents" on public.staff_work_order_documents for select to authenticated using(private.staff_wo_storage_access(storage_path,false));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('staff-work-order-documents','staff-work-order-documents',false,10485760,array['application/pdf','image/jpeg','image/png']);
create policy "staff upload work order files" on storage.objects for insert to authenticated with check(bucket_id='staff-work-order-documents' and owner_id=auth.uid()::text and private.staff_wo_storage_access(name,true));
create policy "scoped staff document readers" on storage.objects for select to authenticated using(bucket_id='staff-work-order-documents' and private.staff_wo_storage_access(name,false));
-- No update, overwrite or delete grants/policies. Unlinked failed uploads require administrator review.
commit;
