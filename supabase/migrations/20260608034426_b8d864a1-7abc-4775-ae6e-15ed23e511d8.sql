
-- 1. Adicionar escopo aos kanban_stages (lead | pos_venda)
ALTER TABLE public.kanban_stages
  ADD COLUMN IF NOT EXISTS stage_scope text NOT NULL DEFAULT 'lead';

CREATE INDEX IF NOT EXISTS kanban_stages_scope_idx ON public.kanban_stages(stage_scope);

-- 2. Seed das colunas pós-venda para cada consultor existente
INSERT INTO public.kanban_stages (consultant_id, stage_key, label, color, position, stage_scope, auto_message_enabled, auto_message_type)
SELECT c.id::text, s.stage_key, s.label, s.color, s.position, 'pos_venda', false, 'text'
FROM public.consultants c
CROSS JOIN (VALUES
  ('pv_espera',    'Aguardando Classificação', '#f59e0b',  0),
  ('pv_aprovado',  'Aprovado',                 '#10b981', 10),
  ('pv_reprovado', 'Reprovado',                '#f43f5e', 20),
  ('pv_d30',       '30 dias',                  '#84cc16', 30),
  ('pv_d60',       '60 dias',                  '#14b8a6', 40),
  ('pv_d90',       '90 dias',                  '#06b6d4', 50),
  ('pv_d120',      '120 dias',                 '#6366f1', 60)
) AS s(stage_key, label, color, position)
ON CONFLICT (consultant_id, stage_key) DO NOTHING;

-- 3. Log de mensagens automáticas pós-venda (espelha crm_auto_message_log)
CREATE TABLE IF NOT EXISTS public.customer_auto_message_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  consultant_id uuid NOT NULL,
  stage_key text NOT NULL,
  remote_jid text,
  customer_name text,
  message_preview text,
  status text NOT NULL DEFAULT 'sent',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, stage_key)
);

GRANT SELECT ON public.customer_auto_message_log TO authenticated;
GRANT ALL ON public.customer_auto_message_log TO service_role;

ALTER TABLE public.customer_auto_message_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultants read own auto-message log"
ON public.customer_auto_message_log
FOR SELECT
TO authenticated
USING (consultant_id = auth.uid());

CREATE INDEX IF NOT EXISTS customer_auto_msg_log_consultant_idx
  ON public.customer_auto_message_log(consultant_id, created_at DESC);
