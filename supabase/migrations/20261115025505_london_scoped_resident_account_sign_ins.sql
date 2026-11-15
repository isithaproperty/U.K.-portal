-- London only. Read-only capability; review and register before applying.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Auth remains private. Expose only scoped resident IDs and existing account sign-in state.
create function private.read_resident_account_sign_ins(p_block_id bigint)
returns table(resident_id bigint,last_sign_in_at timestamptz,state text)
language plpgsql stable security definer set search_path='' as $$
begin
 if p_block_id is null or p_block_id<1 or auth.uid() is null or not exists(
  select 1 from public.portal_members m join public.blocks b on b.id=p_block_id
  where m.email=lower(auth.jwt()->>'email') and (m.role in ('owner','admin') or (m.role='manager' and length(btrim(m.portfolio_manager))>0 and m.portfolio_manager=b.manager))
 ) then raise exception 'Staff block access required' using errcode='42501';end if;
 return query
 with accounts as (
  select r.id as rid,count(u.id) as matches,max(u.last_sign_in_at) as last_sign_in
  from public.residents r left join auth.users u on lower(u.email)=lower(r.email) and u.deleted_at is null and not coalesce(u.is_anonymous,false)
  where r.block_id=p_block_id group by r.id
 )
 select a.rid,
 case when a.matches=1 and isfinite(a.last_sign_in) and a.last_sign_in<=statement_timestamp() then a.last_sign_in else null end,
 case when a.matches=0 then 'no_account' when a.matches>1 then 'unavailable' when a.last_sign_in is null then 'never_recorded' when not isfinite(a.last_sign_in) or a.last_sign_in>statement_timestamp() then 'unavailable' else 'signed_in' end
 from accounts a;
end $$;
revoke all on function private.read_resident_account_sign_ins(bigint) from public,anon,authenticated,service_role;
grant usage on schema private to authenticated;
grant execute on function private.read_resident_account_sign_ins(bigint) to authenticated;
create function public.read_resident_account_sign_ins(p_block_id bigint)
returns table(resident_id bigint,last_sign_in_at timestamptz,state text)
language sql stable security invoker set search_path='' as $$
 select * from private.read_resident_account_sign_ins(p_block_id);
$$;
revoke all on function public.read_resident_account_sign_ins(bigint) from public,anon,authenticated,service_role;
grant execute on function public.read_resident_account_sign_ins(bigint) to authenticated;
notify pgrst,'reload schema';
commit;
