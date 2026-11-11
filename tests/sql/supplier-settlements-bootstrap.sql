-- After management-review-bootstrap.sql, before supplier_settlements.sql; disposable DB only.
create table public.work_orders (
 id bigint primary key,block_id bigint references public.blocks(id),contractor_id bigint,
 status text not null,payment_status text not null,actual_cost numeric(12,2),paid_at timestamptz,notes text not null default ''
);
insert into public.work_orders(id,block_id,contractor_id,status,payment_status,actual_cost,paid_at) values(101,1,9,'Complete','Approved',100.00,null),(102,2,10,'Complete','Approved',50.00,null),(103,1,9,'Complete','Approved',200.00,null),(104,1,9,'Complete','Paid',50.00,'2025-01-01');
alter table public.work_orders enable row level security;
grant select,update on public.work_orders to authenticated;
create policy scoped_workorders on public.work_orders for all to authenticated using(exists(select 1 from public.portal_members m join public.blocks b on b.id=block_id where m.email=auth.jwt()->>'email' and (m.role='owner' or (m.role='manager' and m.portfolio_manager=b.manager)))) with check(exists(select 1 from public.portal_members m join public.blocks b on b.id=block_id where m.email=auth.jwt()->>'email' and (m.role='owner' or (m.role='manager' and m.portfolio_manager=b.manager))));
