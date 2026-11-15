-- London only. Review before applying. No live resident edits or backfill of contact emails.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table public.residents add column contact_email text,add column contact_version bigint not null default 1;
alter table public.residents add constraint resident_contact_version_positive check(contact_version>0);
alter table public.residents add constraint resident_contact_email_valid check(contact_email is null or (
 length(contact_email) between 3 and 254 and contact_email=lower(contact_email)
 and contact_email !~ '[[:cntrl:]]'
 and contact_email !~ U&'[\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]'
 and contact_email ~ '^[^@]+@[^@]+\.[^@]+$'
));
create table public.resident_contact_history(
 id uuid primary key default gen_random_uuid(),resident_id bigint not null references public.residents(id),block_id bigint not null references public.blocks(id),
 version bigint not null,actor_id uuid,actor_email text,actor_role text not null,occurred_at timestamptz not null default clock_timestamp(),
 before_snapshot jsonb not null,after_snapshot jsonb not null,unique(resident_id,version)
);
alter table public.resident_contact_history enable row level security;
revoke all on public.resident_contact_history from public,anon,authenticated,service_role;
grant select on public.resident_contact_history to authenticated;
create function private.can_manage_resident_contact(p_block_id bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.portal_members m join public.blocks b on b.id=p_block_id where m.email=lower(auth.jwt()->>'email') and (m.role in ('owner','admin') or (m.role='manager' and length(btrim(m.portfolio_manager))>0 and m.portfolio_manager=b.manager)));
$$;
revoke all on function private.can_manage_resident_contact(bigint) from public,anon,authenticated,service_role;
grant usage on schema private to authenticated;
grant execute on function private.can_manage_resident_contact(bigint) to authenticated;
create policy "scoped staff read resident contact history" on public.resident_contact_history for select to authenticated using(private.can_manage_resident_contact(block_id));
create function private.stamp_resident_contact_version() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.contact_version:=old.contact_version;
 if to_jsonb(new)-'contact_version' is distinct from to_jsonb(old)-'contact_version' then new.contact_version:=old.contact_version+1;end if;
 return new;
end $$;
create function private.audit_resident_contact_update() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.contact_version<>old.contact_version then
  insert into public.resident_contact_history(resident_id,block_id,version,actor_id,actor_email,actor_role,before_snapshot,after_snapshot)
  values(new.id,new.block_id,new.contact_version,auth.uid(),nullif(lower(auth.jwt()->>'email'),''),coalesce(nullif(current_setting('role',true),'none'),session_user),to_jsonb(old),to_jsonb(new));
 end if;
 return new;
end $$;
revoke all on function private.stamp_resident_contact_version(),private.audit_resident_contact_update() from public,anon,authenticated,service_role;
create trigger stamp_resident_contact_version before update on public.residents for each row execute function private.stamp_resident_contact_version();
create trigger audit_resident_contact_update after update on public.residents for each row execute function private.audit_resident_contact_update();
create function public.update_resident_contact(p_block_id bigint,p_resident_id bigint,p_expected_version bigint,p_full_name text,p_contact_email text,p_phone text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare saved public.residents%rowtype;updated public.residents%rowtype;whitespace text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';changed boolean;
begin
 if p_block_id is null or p_block_id<1 or p_resident_id is null or p_resident_id<1 or p_expected_version is null or p_expected_version<1 then raise exception 'Choose a saved resident and version';end if;
 if not private.can_manage_resident_contact(p_block_id) then raise exception 'Manager block access required' using errcode='42501';end if;
 if length(p_full_name)>200 or length(p_contact_email)>254 or length(p_phone)>80 or p_full_name~'[[:cntrl:]]' or p_contact_email~'[[:cntrl:]]' or p_phone~'[[:cntrl:]]' then raise exception 'Contact fields exceed limits or contain control characters';end if;
 p_full_name:=btrim(p_full_name,whitespace);p_contact_email:=lower(btrim(p_contact_email,whitespace));p_phone:=nullif(btrim(p_phone,whitespace),'');
 if p_full_name is null or length(p_full_name) not between 1 and 200 or p_full_name~'[[:cntrl:]]' or p_contact_email is null or p_phone~'[[:cntrl:]]' or length(p_phone)>80 then raise exception 'Enter valid resident name, contact email and phone';end if;
 select * into saved from public.residents where id=p_resident_id and block_id=p_block_id for update;
 if not found then raise exception 'Resident unavailable' using errcode='P0002';end if;
 if saved.archived_at is not null then raise exception 'Restore this resident assignment before editing contact details';end if;
 if saved.contact_version<>p_expected_version then raise exception 'Resident changed; reload before saving' using errcode='40001';end if;
 changed:=saved.full_name is distinct from p_full_name or saved.contact_email is distinct from p_contact_email or saved.phone is distinct from p_phone;
 if not changed then return jsonb_build_object('resident',to_jsonb(saved),'changed',false);end if;
 update public.residents set full_name=p_full_name,contact_email=p_contact_email,phone=p_phone where id=p_resident_id and block_id=p_block_id and contact_version=p_expected_version returning * into updated;
 if not found then raise exception 'Resident changed; reload before saving' using errcode='40001';end if;
 -- ID, unit/block ownership, sign-in email, archive state and financial records are never updated here.
 return jsonb_build_object('resident',to_jsonb(updated),'changed',true);
end $$;
revoke all on function public.update_resident_contact(bigint,bigint,bigint,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.update_resident_contact(bigint,bigint,bigint,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
