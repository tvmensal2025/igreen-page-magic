-- Fecha execução anônima de funções SECURITY DEFINER que escrevem dados.
-- Mantém intactos: authenticated (painel logado) e service_role (crons/edges).

REVOKE EXECUTE ON FUNCTION public.auto_confirm_pending_pos_venda(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.confirm_pending_classification(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pos_venda_mark_prior_stages_skipped(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_partner_protocol(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_partner_protocol_v2(uuid, text) FROM anon;

-- refresh_objection_shortcut estava com EXECUTE para PUBLIC (qualquer um).
REVOKE EXECUTE ON FUNCTION public.refresh_objection_shortcut(uuid, text, text, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_objection_shortcut(uuid, text, text, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.refresh_objection_shortcut(uuid, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_objection_shortcut(uuid, text, text, text[]) TO service_role;