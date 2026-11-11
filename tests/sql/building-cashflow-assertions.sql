-- Synthetic disposable PostgreSQL only. No production connection.
insert into public.portal_members values('admin@example.invalid','admin',null),('blank@example.invalid','manager','');
insert into public.blocks values(3,'');
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","email":"manager@example.invalid"}',false);
select public.stage_building_cashflow(1,'[{"fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","transaction_date":"2026-01-01","amount_pence":10000,"bank_reference":"IN","description":"Synthetic receipt","transaction_id":"TX1","source_file":"test.csv"},{"fingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","transaction_date":"2026-01-02","amount_pence":-4000,"bank_reference":"OUT","description":"Synthetic expense","transaction_id":"TX2","source_file":"test.csv"}]');
do $$declare result jsonb;before_count bigint;
begin
 if (select count(*) from public.building_cashflow_rows)<>2 or (select sum(amount_pence) from public.building_cashflow_rows)<>6000 then raise exception 'Signed staging failed';end if;
 if exists(select 1 from public.building_cashflow_rows where status<>'Unreconciled') then raise exception 'Unexpected reconciliation';end if;
 result:=public.stage_building_cashflow(1,'[{"fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","transaction_date":"2026-01-01","amount_pence":10000,"bank_reference":"IN","description":"Synthetic receipt","transaction_id":"TX1","source_file":"renamed.csv"}]');
 if result->>'added'<>'0' or result->>'duplicates'<>'1' then raise exception 'Duplicate retry not idempotent';end if;
 begin perform public.stage_building_cashflow(1,'[{"fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","transaction_date":"2026-01-01","amount_pence":999,"bank_reference":"IN","description":"changed","transaction_id":"TX1","source_file":"test.csv"}]');raise exception 'Conflict accepted';exception when others then if sqlerrm='Conflict accepted' then raise;end if;end;
 begin perform public.stage_building_cashflow(2,'[{"fingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","transaction_date":"2026-01-01","amount_pence":100,"bank_reference":"X","description":"X","transaction_id":"X","source_file":"test.csv"}]');raise exception 'Cross-block accepted';exception when insufficient_privilege then null;end;
 begin insert into public.building_cashflow_rows(block_id,fingerprint,transaction_date,amount_pence,source_file,imported_by)values(2,repeat('c',64),'2026-01-01',100,'test.csv','manager@example.invalid');raise exception 'Direct cross-block insert accepted';exception when insufficient_privilege then null;end;
 begin insert into public.building_cashflow_rows(block_id,fingerprint,transaction_date,amount_pence,source_file,imported_by)values(1,repeat('c',64),'2026-01-01',100,'test.csv','owner@example.invalid');raise exception 'Identity spoof accepted';exception when insufficient_privilege then null;end;
 begin update public.building_cashflow_rows set amount_pence=1;raise exception 'Updates allowed';exception when insufficient_privilege then null;end;
 begin delete from public.building_cashflow_rows;raise exception 'Deletes allowed';exception when insufficient_privilege then null;end;
 begin truncate public.building_cashflow_rows;raise exception 'Truncate allowed';exception when insufficient_privilege then null;end;
 before_count:=(select count(*) from public.building_cashflow_rows);
 begin perform public.stage_building_cashflow(1,'[{"fingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","transaction_date":"2026-01-01","amount_pence":100,"bank_reference":"X","description":"X","transaction_id":"X","source_file":"test.csv"},{"fingerprint":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","transaction_date":"2026-01-01","amount_pence":0,"bank_reference":"Z","description":"zero","transaction_id":"Z","source_file":"test.csv"}]');raise exception 'Zero accepted';exception when check_violation then null;end;
 if (select count(*) from public.building_cashflow_rows)<>before_count then raise exception 'Batch was not atomic';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","email":"other@example.invalid"}',false);
do $$begin
 if exists(select 1 from public.building_cashflow_rows) then raise exception 'Other manager reads London';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003","email":"tenant@example.invalid"}',false);
do $$begin
 if exists(select 1 from public.building_cashflow_rows) then raise exception 'Resident reads manager cashflow';end if;
 begin perform public.stage_building_cashflow(1,'[]');raise exception 'Resident RPC allowed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000004","email":"blank@example.invalid"}',false);
do $$begin
 begin perform public.stage_building_cashflow(3,'[]');raise exception 'Blank manager matches blank building';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000005","email":"admin@example.invalid"}',false);
do $$begin if (select count(*) from public.building_cashflow_rows)<>2 then raise exception 'Admin cannot read';end if;end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000006","email":"owner@example.invalid"}',false);
select public.stage_building_cashflow(2,'[{"fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","transaction_date":"2026-01-01","amount_pence":1,"bank_reference":"X","description":"Other block","transaction_id":"TX1","source_file":"test.csv"}]');
do $$begin if (select count(*) from public.building_cashflow_rows)<>3 then raise exception 'Owner/cross-building fingerprint scope failed';end if;end $$;
reset role;set role anon;
do $$begin
 begin perform * from public.building_cashflow_rows;raise exception 'Anonymous read allowed';exception when insufficient_privilege then null;end;
 begin perform public.stage_building_cashflow(1,'[]');raise exception 'Anonymous RPC allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: cashflow signed amounts, duplicates/conflicts, atomicity, RLS, role and block isolation, mutation grants' as result;
