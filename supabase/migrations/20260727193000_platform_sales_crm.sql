-- CRM da venda da plataforma (SuperAdmin) — estágios manuais, isolado do Kanban de leads.

ALTER TABLE public.platform_sales_targets
  ADD COLUMN IF NOT EXISTS crm_stage text NOT NULL DEFAULT 'novo',
  ADD COLUMN IF NOT EXISTS crm_notes text,
  ADD COLUMN IF NOT EXISTS crm_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_sales_targets_crm_stage_check'
  ) THEN
    ALTER TABLE public.platform_sales_targets
      ADD CONSTRAINT platform_sales_targets_crm_stage_check
      CHECK (crm_stage IN ('novo', 'contatado', 'respondeu', 'demo', 'negociacao', 'fechado', 'perdido'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_platform_sales_targets_crm
  ON public.platform_sales_targets(crm_stage, campaign_id);

UPDATE public.platform_sales_script_settings
SET
  corpo_wa_d0 = corpo_call_d0,
  corpo_wa_d1 = $wa1$Sofia de novo.

Ontem te falei da plataforma de vendas iGreen: WhatsApp + SMS + ligação, landings e conversão com dados gráficos, cadastro pelo sistema, banner do parceiro cadastra pra você, e pós-venda (parabéns, app, Club em 30 dias, indicação — cerca de 7 meses).

VAMOS CONSTRUIR UMA BASE FORTE COM ACOMPANHAMENTO REAL COM UM SISTEMA QUE ESTÁ EVOLUINDO TODOS OS DIAS.

Responde: VER | RESUMO | DEPOIS$wa1$,
  corpo_sms_d0 = 'Sofia (Rafael/iGreen). Plataforma Zap+SMS+ligacao, landings com graficos, banner do parceiro cadastra pra voce, pos-venda ate 7 meses. Quer ver? SIM',
  updated_at = now()
WHERE id = 'global';
