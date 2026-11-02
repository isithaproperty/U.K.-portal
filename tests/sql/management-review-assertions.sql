set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","email":"manager@example.invalid"}',false);
select * from public.save_management_review(1,'debtors','{"notes":{}}',0);
do $$begin
 if (select revision from public.management_review_state where block_id=1)<>1 then raise exception 'Initial save failed';end if;
 if (select count(*) from public.management_review_history)<>1 then raise exception 'Audit missing';end if;
 begin perform * from public.save_management_review(1,'debtors','{"changed":true}',0);raise exception 'Stale revision accepted';exception when serialization_failure then null;end;
 begin perform * from public.save_management_review(2,'debtors','{}',0);raise exception 'Cross block accepted';exception when insufficient_privilege then null;end;
end $$;
select * from public.save_management_review(1,'debtors','{"notes":{"1":"kept"}}',1);
do $$begin
 if (select count(*) from public.management_review_history)<>2 then raise exception 'Audit revision lost';end if;
 begin update public.management_review_history set state='{}';raise exception 'History mutable';exception when insufficient_privilege then null;end;
 begin update public.management_review_state set block_id=2,revision=revision+1;raise exception 'Scope reassignment allowed';exception when others then if sqlerrm='Scope reassignment allowed' then raise;end if;end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","email":"other@example.invalid"}',false);
do $$begin
 if exists(select 1 from public.management_review_state) or exists(select 1 from public.management_review_history) then raise exception 'Other manager can read London records';end if;
 begin perform * from public.save_management_review(1,'debtors','{}',2);raise exception 'Other manager can write London';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003","email":"tenant@example.invalid"}',false);
do $$begin
 if exists(select 1 from public.management_review_state) or exists(select 1 from public.management_review_history) then raise exception 'Tenant data leak';end if;
 begin perform * from public.save_management_review(1,'debtors','{}',2);raise exception 'Tenant write allowed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000004","email":"owner@example.invalid"}',false);
do $$begin if (select count(*) from public.management_review_history)<>2 then raise exception 'Owner cannot read history';end if;end $$;
reset role;set role anon;
do $$begin
 begin perform * from public.management_review_state;raise exception 'Anonymous read allowed';exception when insufficient_privilege then null;end;
 begin perform * from public.save_management_review(1,'debtors','{}',0);raise exception 'Anonymous RPC allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: scope, roles, optimistic revisions, immutable audit history' as result;
