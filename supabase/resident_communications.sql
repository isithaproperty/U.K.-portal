alter table public.communications add column recipient_snapshot jsonb not null default '[]'::jsonb check(jsonb_typeof(recipient_snapshot)='array');
create table public.resident_messages(
 id bigint generated always as identity primary key,
 communication_id bigint not null references public.communications(id) on delete cascade,
 resident_id bigint not null references public.residents(id) on delete cascade,
 block_id bigint not null references public.blocks(id) on delete cascade,
 recipient_email text not null,
 subject text not null,
 message text not null,
 sent_at timestamptz not null,
 unique(communication_id,resident_id)
);
create index resident_messages_resident_sent_idx on public.resident_messages(resident_id,sent_at desc);
create index resident_messages_block_idx on public.resident_messages(block_id);
alter table public.resident_messages enable row level security;
revoke all on public.resident_messages from anon,authenticated;
grant select on public.resident_messages to authenticated;
create policy "recipients read their communications" on public.resident_messages for select to authenticated
using(auth.uid() is not null and recipient_email=lower((select auth.jwt()->>'email')) and exists(select 1 from public.residents r where r.id=resident_messages.resident_id and r.block_id=resident_messages.block_id and r.email=resident_messages.recipient_email));
create policy "managers preview resident communications" on public.resident_messages for select to authenticated
using(exists(select 1 from public.portal_members m join public.blocks b on b.id=resident_messages.block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))));
create or replace function private.publish_resident_communications() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status='sent' then
  insert into public.resident_messages(communication_id,resident_id,block_id,recipient_email,subject,message,sent_at)
  select new.id,r.id,s.block_id,lower(s.email),new.subject,new.message,new.created_at
  from jsonb_to_recordset(new.recipient_snapshot) as s(resident_id bigint,block_id bigint,email text)
  join public.residents r on r.id=s.resident_id and r.block_id=s.block_id and r.email=lower(s.email)
  where s.block_id=any(new.block_ids)
  on conflict(communication_id,resident_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function private.publish_resident_communications() from public,anon,authenticated;
create trigger publish_resident_communications after insert on public.communications for each row execute function private.publish_resident_communications();
