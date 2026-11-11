-- REVIEW SCRIPT ONLY: apply to the dedicated London database after review.
-- No seed data, dispatch, ledger posting or scheduling is performed.
-- Requires the existing blocks / portal_members / scoped portfolio migrations.
create table public.management_review_state (
 block_id bigint not null references public.blocks(id) on delete cascade,
 area text not null check(area in ('financials','leaseholders','debtors','creditors')),
 state jsonb not null check(jsonb_typeof(state)='object' and octet_length(state::text)<=1500000),
 revision bigint not null check(revision>0),
 updated_by text not null,
 updated_at timestamptz not null default now(),
 primary key(block_id,area)
);
create table public.management_review_history (
 block_id bigint not null,
 area text not null,
 revision bigint not null,
 state jsonb not null,
 updated_by text not null,
 updated_at timestamptz not null,
 primary key(block_id,area,revision),
 foreign key(block_id,area) references public.management_review_state(block_id,area) on delete cascade
);
alter table public.management_review_state enable row level security;
alter table public.management_review_history enable row level security;
revoke all on public.management_review_state,public.management_review_history from public,anon,authenticated;
grant select,insert,update on public.management_review_state to authenticated;
grant select,insert on public.management_review_history to authenticated;
create policy "scoped managers read review state" on public.management_review_state for select to authenticated using(
 exists(select 1 from public.portal_members m join public.blocks b on b.id=block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager)))
);
create policy "scoped managers insert review state" on public.management_review_state for insert to authenticated with check(
 updated_by=lower((select auth.jwt()->>'email')) and exists(select 1 from public.portal_members m join public.blocks b on b.id=block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager)))
);
create policy "scoped managers update review state" on public.management_review_state for update to authenticated using(
 exists(select 1 from public.portal_members m join public.blocks b on b.id=block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager)))
) with check(
 updated_by=lower((select auth.jwt()->>'email')) and exists(select 1 from public.portal_members m join public.blocks b on b.id=block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager)))
);
create policy "scoped managers read review history" on public.management_review_history for select to authenticated using(
 exists(select 1 from public.management_review_state s where s.block_id=management_review_history.block_id and s.area=management_review_history.area)
);
create policy "review history follows saved revision" on public.management_review_history for insert to authenticated with check(
 updated_by=lower((select auth.jwt()->>'email')) and exists(select 1 from public.management_review_state s where s.block_id=management_review_history.block_id and s.area=management_review_history.area and s.revision=management_review_history.revision and s.state=management_review_history.state and s.updated_at=management_review_history.updated_at and s.updated_by=management_review_history.updated_by)
);
create or replace function public.stamp_management_review() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 if tg_op='INSERT' and new.revision<>1 then raise exception 'Initial revision must be one';end if;
 if tg_op='UPDATE' and (new.block_id<>old.block_id or new.area<>old.area or new.revision<>old.revision+1) then raise exception 'Invalid revision or scope change';end if;
 new.updated_by:=lower(auth.jwt()->>'email');new.updated_at:=clock_timestamp();return new;
end $$;
create or replace function public.audit_management_review() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.management_review_history(block_id,area,revision,state,updated_by,updated_at) values(new.block_id,new.area,new.revision,new.state,new.updated_by,new.updated_at);
 return new;
end $$;
revoke all on function public.stamp_management_review(),public.audit_management_review() from public,anon,authenticated;
create trigger stamp_management_review before insert or update on public.management_review_state for each row execute function public.stamp_management_review();
create trigger audit_management_review after insert or update on public.management_review_state for each row execute function public.audit_management_review();
create or replace function public.save_management_review(p_block_id bigint,p_area text,p_state jsonb,p_expected_revision bigint)
 returns table(state jsonb,revision bigint,updated_at timestamptz) language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.portal_members m join public.blocks b on b.id=p_block_id where m.email=lower(auth.jwt()->>'email') and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))) then raise exception 'Manager block access required' using errcode='42501';end if;
 if p_expected_revision is null or p_expected_revision<0 then raise exception 'Loaded revision required';end if;
 if p_area not in ('financials','leaseholders','debtors','creditors') or p_state is null or jsonb_typeof(p_state)<>'object' or octet_length(p_state::text)>1500000 then raise exception 'Invalid review payload';end if;
 if p_expected_revision=0 then
  return query insert into public.management_review_state as target(block_id,area,state,revision,updated_by) values(p_block_id,p_area,p_state,1,lower(auth.jwt()->>'email')) on conflict(block_id,area) do nothing returning target.state,target.revision,target.updated_at;
 else
  return query update public.management_review_state as target set state=p_state,revision=target.revision+1 where target.block_id=p_block_id and target.area=p_area and target.revision=p_expected_revision returning target.state,target.revision,target.updated_at;
 end if;
 if not found then raise exception 'Review revision conflict' using errcode='40001';end if;
end $$;
revoke all on function public.save_management_review(bigint,text,jsonb,bigint) from public,anon;
grant execute on function public.save_management_review(bigint,text,jsonb,bigint) to authenticated;

-- The lock and revision check remain in the same transaction as the existing
-- atomic ledger importer. Saving a changed budget cannot race its approval.
-- Requires automatic_invoice_numbers.sql before this function is invoked.
create or replace function public.post_saved_management_batch(p_block_id bigint,p_batch_id text,p_expected_revision bigint,p_rows jsonb)
 returns integer language plpgsql security invoker set search_path='' as $$
declare saved public.management_review_state%rowtype;imported integer;
begin
 if auth.uid() is null or not exists(select 1 from public.portal_members m join public.blocks b on b.id=p_block_id where m.email=lower(auth.jwt()->>'email') and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))) then raise exception 'Manager block access required' using errcode='42501';end if;
 select * into saved from public.management_review_state where block_id=p_block_id and area='financials' for update;
 if not found or p_expected_revision is null or saved.revision<>p_expected_revision or p_batch_id is null or saved.state #>> '{prepared,input,batchId}' is distinct from p_batch_id then raise exception 'Saved financial batch changed' using errcode='40001';end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Provide 1 to 500 batch rows';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) item where nullif(item->>'request_id','') is null or coalesce(item->>'reference','')<>'' or item->>'entry_type' not in ('Charge','Credit')) then raise exception 'Only idempotent charge or credit rows are accepted';end if;
 select public.import_service_charges(p_block_id,p_rows) into imported;
 return imported;
end $$;
revoke all on function public.post_saved_management_batch(bigint,text,bigint,jsonb) from public,anon;
grant execute on function public.post_saved_management_batch(bigint,text,bigint,jsonb) to authenticated;
