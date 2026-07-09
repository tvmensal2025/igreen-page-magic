CREATE OR REPLACE FUNCTION public.rodizio_next(p_campaign_id uuid)
RETURNS TABLE(partner_id uuid, "position" integer, pool_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_pool_id uuid;
  v_counter bigint;
  v_len int;
  v_idx int;
  v_partner_id uuid;
begin
  update public.rodizio_pools rp
     set counter = rp.counter + 1,
         updated_at = now()
   where rp.campaign_id = p_campaign_id
     and rp.is_active = true
     and exists (
       select 1
       from public.facebook_campaigns fc
       where fc.id = rp.campaign_id
         and fc.status in ('active', 'pending_review')
     )
     and exists (
       select 1 from public.rodizio_pool_members m where m.pool_id = rp.id
     )
  returning rp.id, rp.counter into v_pool_id, v_counter;

  if v_pool_id is null then
    return;
  end if;

  select count(*) into v_len
    from public.rodizio_pool_members m
   where m.pool_id = v_pool_id;
  if v_len = 0 then
    return;
  end if;

  v_idx := (v_counter - 1) % v_len;

  update public.rodizio_pool_members m
     set lead_count = m.lead_count + 1
   where m.pool_id = v_pool_id
     and m.position = v_idx
  returning m.partner_id into v_partner_id;

  if v_partner_id is null then
    return;
  end if;

  partner_id := v_partner_id;
  "position" := v_idx;
  pool_id := v_pool_id;
  return next;
end;
$function$;

REVOKE ALL ON FUNCTION public.generate_campaign_tracking_protocol(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_next(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_campaign_tracking_protocol(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rodizio_next(uuid) TO service_role;