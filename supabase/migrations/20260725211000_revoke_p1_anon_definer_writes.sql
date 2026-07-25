-- P1 residual: REVOKE EXECUTE de anon/PUBLIC em RPCs DEFINER de escrita
-- sem ownership no corpo. Mantém authenticated + service_role.
-- NÃO revoga: refresh_objection_shortcut, generate_partner_protocol(_v2),
-- has_role, count_captured_leads_by_channel, filter_dispatched_phones.

REVOKE EXECUTE ON FUNCTION public.sync_objection_shortcut_all(text, text, text[]) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_qa_media_slots(uuid, text[]) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lead_research_sweep_bump(uuid, integer, integer, integer, integer, boolean) FROM anon, PUBLIC;

-- P2: gate is_super_admin no corpo; revoke anon = defesa em profundidade
REVOKE EXECUTE ON FUNCTION public.admin_clear_ban(text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_mark_instance_banned(text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.publish_flow_as_public(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_bot_flow_c_from_a(uuid) FROM anon, PUBLIC;
