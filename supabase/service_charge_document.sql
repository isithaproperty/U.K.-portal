create table public.service_charge_document_settings (
 block_id bigint primary key references public.blocks(id) on delete cascade,
 settings jsonb not null default '{}'::jsonb check(jsonb_typeof(settings)='object' and octet_length(settings::text)<=10000)
);
alter table public.service_charge_document_settings enable row level security;
grant select,insert,update on public.service_charge_document_settings to authenticated;
create policy "residents read own development document settings" on public.service_charge_document_settings for select to authenticated
using(private.is_tenant_of_block(block_id));
create policy "managers maintain development document settings" on public.service_charge_document_settings for all to authenticated
using(exists(select 1 from public.portal_members m join public.blocks b on b.id=block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))))
with check(exists(select 1 from public.portal_members m join public.blocks b on b.id=block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))));
