CREATE OR REPLACE FUNCTION public.management_dispatch_recipient_allowed(p_block bigint, p_unit bigint, p_kind text, p_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.management_review_state s cross join lateral jsonb_array_elements(s.state->'contacts') c cross join lateral jsonb_array_elements_text(c->'emails') email where s.block_id=p_block and s.area='leaseholders' and c->>'blockId'=p_block::text and email=p_email and (p_unit is null or c->>'unitId'=p_unit::text) and ((p_kind='Section20' and c->>'role' in ('Leaseholder','Recognised association')) or (p_kind<>'Section20' and c->>'role'='Leaseholder' and c->>'demands'='true')))
$function$
