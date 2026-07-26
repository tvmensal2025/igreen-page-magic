-- Canal de novidades p/ cliente carteira (igreen_sync/extension).
-- Quando o cliente responde no Zap: mensagem fixa de recados/novidades.
-- NÃO entra no Grupo A nem em fluxo de cadastro.
-- cliente_canal_flow_id = reserva p/ fluxo futuro (não dispara A/B/C).

ALTER TABLE public.consultant_automation_prefs
  ADD COLUMN IF NOT EXISTS cliente_canal_reply_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cliente_canal_reply_text text,
  ADD COLUMN IF NOT EXISTS cliente_canal_flow_id uuid REFERENCES public.bot_flows(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.consultant_automation_prefs.cliente_canal_reply_enabled IS
  'Cliente carteira responde no Zap → manda msg de canal de novidades (sem Grupo A).';
COMMENT ON COLUMN public.consultant_automation_prefs.cliente_canal_reply_text IS
  'Texto custom; NULL = template padrão com emojis.';
COMMENT ON COLUMN public.consultant_automation_prefs.cliente_canal_flow_id IS
  'Fluxo opcional futuro p/ clientes (ainda não executa Grupo A).';

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS cliente_canal_last_reply_at timestamptz;

COMMENT ON COLUMN public.customers.cliente_canal_last_reply_at IS
  'Última msg automática do canal de novidades (cooldown anti-spam).';
