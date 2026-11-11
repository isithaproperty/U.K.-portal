-- LOCAL REVIEW PROPOSAL ONLY. Not deployed and not an automatic migration.
-- Rollout: review existing deployed function definitions and RLS first; dependencies
-- are schema/unit_residents, bank_reconciliation and resident_archive.sql.
-- Obtain approval before creating/applying a migration with the Supabase CLI.
-- Apply this column/constraint and new RPC together, then enable share imports.
-- Existing callers of import_block_residents remain unchanged. Share-bearing calls
-- MUST use import_block_residents_with_shares: an old deployment then fails clearly
-- instead of accepting an upload while silently discarding its percentages.
-- No automatic backfill: existing units remain NULL until explicitly imported.
-- No policy or payment/ledger/standing-order changes are proposed here.
-- After approval, test in an isolated database with authenticated owner, admin,
-- assigned/unassigned manager and resident JWTs before production rollout.

begin;

alter table public.units
  add column service_charge_percentage numeric(15,12);
alter table public.units
  add constraint units_service_charge_percentage_range
  check (service_charge_percentage is null or
    service_charge_percentage between 0 and 100);

comment on column public.units.service_charge_percentage is
  'Lease service-charge apportionment in percentage points (0..100); NULL means unknown. Blank resident imports preserve the saved value.';

create or replace function public.import_block_residents_with_shares(
  p_block_id bigint, p_rows jsonb
) returns integer
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  item jsonb;
  v_number text;
  v_code text;
  v_unit_id bigint;
  v_matches bigint[];
  v_share_text text;
  v_share numeric(15,12);
  v_seen_shares jsonb := '{}'::jsonb;
  v_seen_references jsonb := '{}'::jsonb;
  v_seen_codes jsonb := '{}'::jsonb;
  v_ref text;
  v_count integer := 0;
begin
  if not exists (
    select 1 from public.portal_members
    where email = lower(auth.jwt()->>'email')
      and role in ('owner','admin','manager')
  ) then
    raise exception 'Manager access required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Provide 1 to 500 rows';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'Provide 1 to 500 rows';
  end if;
  -- Defence in depth: deployed table policies can equate blank portfolio labels.
  -- Require a real assignment here without widening or changing those policies.
  -- Exact matching intentionally preserves the existing portfolio identity rule.
  if not exists (
    select 1 from public.blocks b join public.portal_members m
      on m.email = lower(auth.jwt()->>'email')
    where b.id = p_block_id and (
      m.role in ('owner','admin') or (
        m.role = 'manager'
        and m.portfolio_manager ~ '[^[:space:]]'
        and b.manager ~ '[^[:space:]]'
        and m.portfolio_manager = b.manager
      )
    )
  ) then
    raise exception 'Assigned portfolio access required' using errcode = '42501';
  end if;
  -- Serialize this importer per block, including first-time unit creation.
  -- Legacy imports/direct unit edits do not take this lock: see rollout tests.
  perform pg_advisory_xact_lock(hashtextextended('unit-share-import:' || p_block_id::text, 0));

  for item in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(item) is distinct from 'object' then
      raise exception 'Each import row must be an object';
    end if;
    v_number := nullif(trim(coalesce(item->>'unit_number','')), '');
    v_code := nullif(trim(coalesce(item->>'unit_code','')), '');
    if coalesce(length(v_number),0) > 80 or coalesce(length(v_code),0) > 80
       or (v_number is null and v_code is null) then
      raise exception 'Provide a unit number or unit code of at most 80 characters';
    end if;

    -- Source unit_code is only a matching hint, never public.units.id and never
    -- a new persisted identifier. Both tokens must resolve to at most ONE unit
    -- in this block. An exact spelling does not override case ambiguity.
    select array_agg(u.id order by u.id) into v_matches
    from public.units u
    where u.block_id = p_block_id
      and (lower(trim(u.unit_number)) = lower(v_number)
        or lower(trim(u.unit_number)) = lower(v_code));
    if coalesce(cardinality(v_matches),0) > 1 then
      raise exception 'Ambiguous or conflicting unit identifiers: % / %', v_number, v_code;
    end if;
    v_unit_id := v_matches[1];
    if v_unit_id is null and v_number is null then
      raise exception 'Unknown unit code; provide a unit number for a new unit';
    end if;

    v_share_text := nullif(trim(coalesce(item->>'service_charge_percentage','')), '');
    v_share := null;
    if v_share_text is not null then
      -- Input must already be canonical percentage points, not Excel fractions
      -- or text containing a percent sign. Reject overprecision before casting
      -- rather than silently rounding it into a different lease percentage.
      if v_share_text !~ '^[0-9]{1,3}(\.[0-9]{1,12})?$' then
        raise exception 'Invalid service-charge percentage; use 0 to 100 with at most 12 decimal places';
      end if;
      v_share := v_share_text::numeric;
      if v_share < 0 or v_share > 100 then
        raise exception 'Service-charge percentage must be between 0 and 100';
      end if;
    end if;
    v_ref := nullif(upper(regexp_replace(trim(coalesce(item->>'payment_reference','')), '\s', '', 'g')), '');
    if v_ref is not null and (length(v_ref) > 80 or v_ref !~ '^[A-Z0-9][A-Z0-9/._-]*$') then
      raise exception 'Invalid payment reference';
    end if;

    if v_unit_id is null then
      insert into public.units(block_id, unit_number, payment_reference)
      values(p_block_id, v_number, v_ref)
      on conflict(block_id, unit_number) do update
        set payment_reference = coalesce(excluded.payment_reference, units.payment_reference)
      returning id into v_unit_id;
    end if;
    if v_code is not null then
      if v_seen_codes ? lower(v_code)
         and (v_seen_codes->>lower(v_code))::bigint <> v_unit_id then
        raise exception 'Unit code has conflicting names';
      end if;
      v_seen_codes := jsonb_set(v_seen_codes, array[lower(v_code)], to_jsonb(v_unit_id));
    end if;
    if v_ref is not null then
      if v_seen_references ? v_unit_id::text
         and v_seen_references->>v_unit_id::text <> v_ref then
        raise exception 'Conflicting payment references for the same unit';
      end if;
      v_seen_references := jsonb_set(v_seen_references, array[v_unit_id::text], to_jsonb(v_ref));
    end if;
    if v_share is not null then
      if v_seen_shares ? v_unit_id::text
         and (v_seen_shares->>v_unit_id::text)::numeric <> v_share then
        raise exception 'Conflicting service-charge percentages for the same unit';
      end if;
      v_seen_shares := jsonb_set(v_seen_shares, array[v_unit_id::text], to_jsonb(v_share));
    end if;
    update public.units
      set payment_reference = coalesce(v_ref, payment_reference),
          service_charge_percentage = coalesce(v_share, service_charge_percentage)
      where id = v_unit_id and block_id = p_block_id;
    if not found then raise exception 'Unit update unavailable' using errcode = '42501'; end if;

    if nullif(trim(coalesce(item->>'resident_email','')), '') is not null then
      if length(trim(coalesce(item->>'resident_name',''))) = 0 then
        raise exception 'Resident name required';
      end if;
      -- Preserve resident_archive.sql behavior: archived residents stay archived;
      -- the returning occupant gets a new active row. Existing active rows keep
      -- their IDs and related references. Do not delete/archive absent residents.
      insert into public.residents(unit_id, block_id, full_name, email, phone)
      values(v_unit_id, p_block_id, trim(item->>'resident_name'),
        lower(trim(item->>'resident_email')), nullif(trim(coalesce(item->>'phone','')), ''))
      on conflict(unit_id, email) where archived_at is null do update
        set full_name = excluded.full_name, phone = excluded.phone;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.import_block_residents_with_shares(bigint,jsonb) from public, anon;
grant execute on function public.import_block_residents_with_shares(bigint,jsonb) to authenticated;

commit;

-- Local disposable verification: tests/run-pglite-unit-shares.mjs exercises this
-- file against embedded PostgreSQL with synthetic RLS policies (40 checks).
-- Hosted/deployed policy verification remains required before deployment:
-- 1. Existing units receive NULL; zero and 100 are valid; negative/>100 fail.
-- 2. Import two residents in one unit with 12.500 and 12.5: one unit, two active
--    residents, one 12.5 share. Reimport: stable unit and active-resident IDs.
-- 3. Blank/missing share and payment reference preserve existing values; explicit
--    zero replaces a share. Blank resident email still permits a unit-only row.
-- 4. Different nonblank shares for one unit reject the WHOLE transaction,
--    including earlier units/residents/references. Equal shares do not add up.
-- 5. Bad last-row resident/name/reference/percentage also rolls back all writes.
-- 6. Case variants match one existing unit; pre-existing case-ambiguous units,
--    or number/code resolving to different units, reject rather than choosing.
-- 7. A numeric source code must never select a units.id; cross-block matches must
--    never be used. Unknown code-only rows fail without creating phantom units.
-- 8. Archived occupants stay archived; returning occupants get a new active row.
--    Active occupants retain IDs; ledger/bank/standing-order references unchanged.
-- 9. Denied/unassigned callers cannot write via this SECURITY INVOKER function.
--    Verify the deployed admin policies too; this proposal does not expand them.
-- 10. Concurrent imports serialize. Review legacy/direct-write paths for case-only
--     unit creation races before rollout; no global case-insensitive index or
--     automatic duplicate-unit cleanup is introduced by this scoped proposal.
-- 11. Run database advisors and RLS tests; record actual deployed definitions and
--     a rollback plan. Reverting application code can leave the nullable column
--     and unused RPC intact, preserving uploaded data without destructive DDL.

-- Residual deployed-policy risk: authenticated has direct table UPDATE grants.
-- This RPC guard does not prevent direct REST/legacy operations allowed by the
-- existing blank-portfolio RLS policies. Any policy/grant remediation needs its
-- own scoped approval and regression review; this proposal changes neither.
