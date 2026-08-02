
create or replace function public.admin_transfer_consultant_assets(p_from uuid, p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_n bigint;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Acesso negado: apenas super admin';
  end if;
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'Parâmetros inválidos';
  end if;
  if not exists (select 1 from public.consultants where id = p_to) then
    raise exception 'Consultor de destino não existe';
  end if;

  update public.customers set consultant_id = p_to where consultant_id = p_from;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('customers', v_n);

  update public.customers set assigned_consultant_id = p_to where assigned_consultant_id = p_from;
  update public.customers set customer_referred_by_consultant_id = p_to where customer_referred_by_consultant_id = p_from;

  update public.captured_leads set consultant_id = p_to where consultant_id = p_from;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('captured_leads', v_n);

  update public.sales set consultant_id = p_to where consultant_id = p_from;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('sales', v_n);

  update public.proposals set consultant_id = p_to where consultant_id = p_from;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('proposals', v_n);

  update public.igreen_customer_boletos set consultant_id = p_to where consultant_id = p_from;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('igreen_customer_boletos', v_n);

  update public.igreen_telecom_customers set consultant_id = p_to where consultant_id = p_from;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('igreen_telecom_customers', v_n);

  update public.igreen_seguros_customers set consultant_id = p_to where consultant_id = p_from;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('igreen_seguros_customers', v_n);

  update public.rodizio_assignments set consultant_id = p_to where consultant_id = p_from;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('rodizio_assignments', v_n);

  update public.consultants set referred_by = p_to where referred_by = p_from;
  update public.rollout_config set alert_consultant_id = null where alert_consultant_id = p_from;

  return v_result;
end;
$$;

revoke all on function public.admin_transfer_consultant_assets(uuid, uuid) from public;
grant execute on function public.admin_transfer_consultant_assets(uuid, uuid) to authenticated, service_role;

create or replace function public.admin_reset_consultant_identity(p_consultant uuid, p_require_reapproval boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kept_customers bigint;
  v_kept_leads bigint;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Acesso negado: apenas super admin';
  end if;
  if p_consultant is null then
    raise exception 'Parâmetros inválidos';
  end if;
  if not exists (select 1 from public.consultants where id = p_consultant) then
    raise exception 'Consultor não encontrado';
  end if;

  update public.consultants set
    assistant_name = null,
    gender = null,
    ai_persona = null,
    ai_persona_fluxo_b = null,
    ai_profile = 'balanced',
    cerebro_ativo = 'off',
    photo_url = null,
    display_name = null,
    banner_keywords = '{}'::text[],
    banner_default_phrase = null,
    voice_sms_templates = null,
    identity_media_bootstrapped_at = null,
    identity_media_fingerprint = null,
    flow_step_media_order = '{}'::jsonb,
    approved = case when p_require_reapproval then false else approved end
  where id = p_consultant;

  delete from public.consultant_automation_prefs where consultant_id = p_consultant;
  delete from public.cadence_theme_config where consultant_id = p_consultant;
  delete from public.cadence_stage_config where consultant_id = p_consultant;
  delete from public.ai_knowledge_sections where consultant_id = p_consultant;
  delete from public.whatsapp_instances where consultant_id = p_consultant;

  select count(*) into v_kept_customers from public.customers where consultant_id = p_consultant;
  select count(*) into v_kept_leads from public.captured_leads where consultant_id = p_consultant;

  return jsonb_build_object(
    'consultant_id', p_consultant,
    'kept_customers', v_kept_customers,
    'kept_captured_leads', v_kept_leads,
    'require_reapproval', p_require_reapproval
  );
end;
$$;

revoke all on function public.admin_reset_consultant_identity(uuid, boolean) from public;
grant execute on function public.admin_reset_consultant_identity(uuid, boolean) to authenticated, service_role;
