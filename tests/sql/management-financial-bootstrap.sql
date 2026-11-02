create table public.units(id bigint primary key,block_id bigint references public.blocks(id),unit_number text);
create table public.residents(id bigint primary key,unit_id bigint,block_id bigint,email text);
insert into public.units values(10,1,'Flat 1');
grant select on public.units,public.residents to authenticated;
