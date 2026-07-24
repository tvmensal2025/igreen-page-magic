-- security_invoker nas views onde DEFINER vazava RLS do owner (lint 0010).
-- NÃO alterar consultants_public nem platform_facebook_audience_status:
--   - consultants_public: LP anon; invoker=off intencional (20260604).
--   - platform_facebook_audience_status: criada com invoker=false para
--     consultores lerem status sem access_token (tabela base só admin).

ALTER VIEW public.v_boletos_carteira SET (security_invoker = true);
ALTER VIEW public.cadence_metrics_daily SET (security_invoker = true);
ALTER VIEW public.igreen_recon_queue_progress SET (security_invoker = true);

COMMENT ON VIEW public.v_boletos_carteira IS
  'Boletos+customer. security_invoker=true (RLS owner/admin). 2026-07-24 lint 0010.';
COMMENT ON VIEW public.cadence_metrics_daily IS
  'Métricas cadência 90d. security_invoker=true. 2026-07-24 lint 0010.';
COMMENT ON VIEW public.igreen_recon_queue_progress IS
  'Progresso fila recon. security_invoker=true (admin). 2026-07-24 lint 0010.';

COMMENT ON VIEW public.consultants_public IS
  'LP pública. SECURITY DEFINER intencional (invoker=off desde 20260604). Colunas seguras only. Lint 0010 = exceção documentada.';
COMMENT ON VIEW public.platform_facebook_audience_status IS
  'Status audience sem token. SECURITY DEFINER intencional (consultor autenticado lê sem ser admin da tabela). Lint 0010 = exceção documentada.';
