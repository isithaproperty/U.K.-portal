-- Apply after management_review.sql and supplier_settlements.sql.
-- Extends existing manager-scoped, revision-controlled review storage only.
begin;
alter table public.management_review_state drop constraint management_review_state_area_check;
alter table public.management_review_state add constraint management_review_state_area_check check(area in ('financials','leaseholders','debtors','creditors','budget-spend'));
create or replace function public.save_management_review(p_block_id bigint,p_area text,p_state jsonb,p_expected_revision bigint)
 returns table(state jsonb,revision bigint,updated_at timestamptz) language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.portal_members m join public.blocks b on b.id=p_block_id where m.email=lower(auth.jwt()->>'email') and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))) then raise exception 'Manager block access required' using errcode='42501';end if;
 if p_expected_revision is null or p_expected_revision<0 then raise exception 'Loaded revision required';end if;
 if p_area not in ('financials','leaseholders','debtors','creditors','budget-spend') or p_state is null or jsonb_typeof(p_state)<>'object' or octet_length(p_state::text)>1500000 then raise exception 'Invalid review payload';end if;
 if p_expected_revision=0 then
  return query insert into public.management_review_state as target(block_id,area,state,revision,updated_by) values(p_block_id,p_area,p_state,1,lower(auth.jwt()->>'email')) on conflict(block_id,area) do nothing returning target.state,target.revision,target.updated_at;
 else
  return query update public.management_review_state as target set state=p_state,revision=target.revision+1 where target.block_id=p_block_id and target.area=p_area and target.revision=p_expected_revision returning target.state,target.revision,target.updated_at;
 end if;
 if not found then raise exception 'Review revision conflict' using errcode='40001';end if;
end $$;
revoke all on function public.save_management_review(bigint,text,jsonb,bigint) from public,anon;
grant execute on function public.save_management_review(bigint,text,jsonb,bigint) to authenticated;

commit;
