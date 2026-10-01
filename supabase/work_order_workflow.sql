create or replace function public.set_work_order_number() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$ begin if new.work_order_number is null or btrim(new.work_order_number)='' then new.work_order_number:='WO-'||lpad(new.id::text,greatest(6,length(new.id::text)),'0'); end if;return new;end $$;
alter table public.work_orders add column deadline_date date,add column special_terms text not null default '' check(length(special_terms)<=5000),add column expense_account text not null default '' check(length(expense_account)<=200);
create table public.work_order_dispatches(
 id bigint generated always as identity primary key,
 work_order_id bigint not null references public.work_orders(id) on delete cascade,
 block_id bigint not null references public.blocks(id),
 contractor_id bigint not null references public.contractors(id),
 recipient_email text not null,
 snapshot jsonb not null,
 email_status text not null default 'Pending' check(email_status in ('Pending','Sent','Failed')),
 created_at timestamptz not null default now(),sent_at timestamptz,
 unique(work_order_id,contractor_id,recipient_email)
);
create table public.work_order_submissions(
 id uuid primary key,
 dispatch_id bigint not null references public.work_order_dispatches(id) on delete cascade,
 job_card_path text not null unique,
 invoice_path text not null unique,
 job_card_name text not null check(length(job_card_name) between 1 and 200),
 invoice_name text not null check(length(invoice_name) between 1 and 200),
 uploaded_by text not null,
 uploaded_at timestamptz not null default now(),
 notification_status text not null default 'Pending' check(notification_status in ('Pending','Sent','Failed')),
 notified_at timestamptz,
 check(job_card_path like dispatch_id::text||'/'||id::text||'/job-card.%' and invoice_path like dispatch_id::text||'/'||id::text||'/invoice.%')
);
create index work_order_dispatch_block_idx on public.work_order_dispatches(block_id);
create index work_order_dispatch_contractor_idx on public.work_order_dispatches(contractor_id);
create index work_order_submission_dispatch_idx on public.work_order_submissions(dispatch_id);
create or replace function private.can_access_work_order_dispatch(p_id bigint,p_manager_only boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.work_order_dispatches d join public.work_orders w on w.id=d.work_order_id join public.blocks b on b.id=d.block_id join public.contractors c on c.id=d.contractor_id where d.id=p_id and (
 exists(select 1 from public.portal_members m where m.email=lower(auth.jwt()->>'email') and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager)))
 or (not p_manager_only and d.recipient_email=lower(auth.jwt()->>'email') and w.contractor_id=d.contractor_id and lower(c.email)=d.recipient_email and w.status<>'Cancelled')
 ));
$$;
revoke all on function private.can_access_work_order_dispatch(bigint,boolean) from public,anon;
grant execute on function private.can_access_work_order_dispatch(bigint,boolean) to authenticated;
alter table public.work_order_dispatches enable row level security;
alter table public.work_order_submissions enable row level security;
revoke all on public.work_order_dispatches,public.work_order_submissions from anon,authenticated;
grant select on public.work_order_dispatches,public.work_order_submissions to authenticated;
grant insert(id,dispatch_id,job_card_path,invoice_path,job_card_name,invoice_name,uploaded_by) on public.work_order_submissions to authenticated;
create policy "assigned contractor and scoped managers read dispatch" on public.work_order_dispatches for select to authenticated using(private.can_access_work_order_dispatch(id));
create policy "assigned contractor and scoped managers read submissions" on public.work_order_submissions for select to authenticated using(private.can_access_work_order_dispatch(dispatch_id));
create policy "assigned contractor submits invoice and job card" on public.work_order_submissions for insert to authenticated with check(
 uploaded_by=lower((select auth.jwt()->>'email')) and exists(select 1 from public.work_order_dispatches d where d.id=dispatch_id and d.recipient_email=uploaded_by and private.can_access_work_order_dispatch(d.id))
 and exists(select 1 from storage.objects o where o.bucket_id='work-order-documents' and o.name=job_card_path)
 and exists(select 1 from storage.objects o where o.bucket_id='work-order-documents' and o.name=invoice_path)
);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('work-order-documents','work-order-documents',false,10485760,array['application/pdf','image/jpeg','image/png']) on conflict(id) do nothing;
create policy "work order document readers" on storage.objects for select to authenticated using(bucket_id='work-order-documents' and case when split_part(name,'/',1)~'^[0-9]+$' then private.can_access_work_order_dispatch(split_part(name,'/',1)::bigint) else false end);
create policy "contractor uploads work order documents" on storage.objects for insert to authenticated with check(bucket_id='work-order-documents' and case when split_part(name,'/',1)~'^[0-9]+$' then exists(select 1 from public.work_order_dispatches d where d.id=split_part(name,'/',1)::bigint and d.recipient_email=lower((select auth.jwt()->>'email')) and private.can_access_work_order_dispatch(d.id)) else false end);
create policy "contractor removes unsubmitted uploads" on storage.objects for delete to authenticated using(bucket_id='work-order-documents' and case when split_part(name,'/',1)~'^[0-9]+$' then exists(select 1 from public.work_order_dispatches d where d.id=split_part(name,'/',1)::bigint and d.recipient_email=lower((select auth.jwt()->>'email')) and private.can_access_work_order_dispatch(d.id)) else false end and not exists(select 1 from public.work_order_submissions s where s.job_card_path=name or s.invoice_path=name));
