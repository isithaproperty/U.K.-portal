-- PROPOSAL ONLY. Not applied. Requires explicit approval of this permission change.
-- CLI is unavailable here; convert to a CLI-created migration before approved rollout.
-- Existing SELECT policies remain unchanged. No service-role bypass or data rewrite.
begin;
grant update (name, management_company, type, address, manager, financial_year_end, units)
 on public.blocks to authenticated;
create policy "portfolio scoped block update"
 on public.blocks for update to authenticated
 using (exists (
  select 1 from public.portal_members m
  where m.email = lower((select auth.jwt()->>'email'))
   and (m.role in ('owner','admin') or
    (m.role = 'manager' and btrim(coalesce(m.portfolio_manager,'')) <> ''
     and btrim(coalesce(blocks.manager,'')) <> ''
     and m.portfolio_manager = blocks.manager))
 ))
 with check (exists (
  select 1 from public.portal_members m
  where m.email = lower((select auth.jwt()->>'email'))
   and (m.role in ('owner','admin') or
    (m.role = 'manager' and btrim(coalesce(m.portfolio_manager,'')) <> ''
     and btrim(coalesce(blocks.manager,'')) <> ''
     and m.portfolio_manager = blocks.manager))
 ));
commit;
-- This preserves manager scope across both old and new rows; only owner/admin
-- may move a block between managers. No grant on identifiers or other settings.
