-- Venda da plataforma (SuperAdmin) — isolado de cadência A/B/C, Cérebro e pós-venda.
-- dry_run default true; não liga envio em massa sozinho.

CREATE TABLE IF NOT EXISTS public.platform_sales_script_settings (
  id text PRIMARY KEY DEFAULT 'global',
  bloco_nome_com text NOT NULL DEFAULT '{{nome}}, tudo bem?',
  bloco_nome_sem text NOT NULL DEFAULT 'Tudo bem?',
  saudacao_manha text NOT NULL DEFAULT 'Muito bom dia!',
  saudacao_tarde text NOT NULL DEFAULT 'Muito boa tarde!',
  saudacao_noite text NOT NULL DEFAULT 'Muito boa noite!',
  corpo_wa_d0 text NOT NULL DEFAULT '',
  corpo_wa_d1 text NOT NULL DEFAULT '',
  corpo_sms_d0 text NOT NULL DEFAULT '',
  corpo_sms_d1 text NOT NULL DEFAULT '',
  corpo_call_d0 text NOT NULL DEFAULT '',
  corpo_call_d1 text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_sales_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Venda da plataforma',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'queued', 'running', 'paused', 'done', 'cancelled')),
  dry_run boolean NOT NULL DEFAULT true,
  channels jsonb NOT NULL DEFAULT '["whatsapp","sms","call"]'::jsonb,
  schedule_d0_at timestamptz,
  schedule_d1_at timestamptz,
  total int NOT NULL DEFAULT 0,
  sent int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_sales_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.platform_sales_campaigns(id) ON DELETE CASCADE,
  phone text NOT NULL,
  name text,
  name_source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped', 'd1_queued', 'done')),
  d0_sent_at timestamptz,
  d1_sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_sales_dispatch_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.platform_sales_campaigns(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES public.platform_sales_targets(id) ON DELETE CASCADE,
  day_key text NOT NULL CHECK (day_key IN ('d0', 'd1')),
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'call')),
  dry_run boolean NOT NULL DEFAULT true,
  rendered_text text,
  status text NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'failed', 'skipped', 'dry_run')),
  error text,
  provider_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_sales_campaigns_status
  ON public.platform_sales_campaigns(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_sales_targets_campaign
  ON public.platform_sales_targets(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_platform_sales_log_campaign
  ON public.platform_sales_dispatch_log(campaign_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_platform_sales_campaigns_updated ON public.platform_sales_campaigns;
CREATE TRIGGER trg_platform_sales_campaigns_updated
  BEFORE UPDATE ON public.platform_sales_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_platform_sales_targets_updated ON public.platform_sales_targets;
CREATE TRIGGER trg_platform_sales_targets_updated
  BEFORE UPDATE ON public.platform_sales_targets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_platform_sales_scripts_updated ON public.platform_sales_script_settings;
CREATE TRIGGER trg_platform_sales_scripts_updated
  BEFORE UPDATE ON public.platform_sales_script_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.platform_sales_script_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_sales_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_sales_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_sales_dispatch_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "superadmin_platform_sales_scripts" ON public.platform_sales_script_settings;
CREATE POLICY "superadmin_platform_sales_scripts"
  ON public.platform_sales_script_settings FOR ALL
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "superadmin_platform_sales_campaigns" ON public.platform_sales_campaigns;
CREATE POLICY "superadmin_platform_sales_campaigns"
  ON public.platform_sales_campaigns FOR ALL
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "superadmin_platform_sales_targets" ON public.platform_sales_targets;
CREATE POLICY "superadmin_platform_sales_targets"
  ON public.platform_sales_targets FOR ALL
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "superadmin_platform_sales_log" ON public.platform_sales_dispatch_log;
CREATE POLICY "superadmin_platform_sales_log"
  ON public.platform_sales_dispatch_log FOR ALL
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_sales_script_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_sales_campaigns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_sales_targets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_sales_dispatch_log TO authenticated;
GRANT ALL ON public.platform_sales_script_settings TO service_role;
GRANT ALL ON public.platform_sales_campaigns TO service_role;
GRANT ALL ON public.platform_sales_targets TO service_role;
GRANT ALL ON public.platform_sales_dispatch_log TO service_role;

-- Seed scripts canônicos (upsert)
INSERT INTO public.platform_sales_script_settings (
  id,
  bloco_nome_com,
  bloco_nome_sem,
  saudacao_manha,
  saudacao_tarde,
  saudacao_noite,
  corpo_wa_d0,
  corpo_wa_d1,
  corpo_sms_d0,
  corpo_sms_d1,
  corpo_call_d0,
  corpo_call_d1
) VALUES (
  'global',
  '{{nome}}, tudo bem?',
  'Tudo bem?',
  'Muito bom dia!',
  'Muito boa tarde!',
  'Muito boa noite!',
  $wa0$Sou a Sofia, assistente virtual do Rafael, gestor da iGreen.

Te chamo porque montamos uma plataforma de vendas para consultor iGreen — do primeiro contato do lead até o pós-venda.

O que ela faz na prática:
• Atende no WhatsApp, manda SMS e também liga
• Landing pages e conversão de todos os produtos, prontas para usar, com dados gráficos
• Ajuda a criar campanha e organizar o lead
• Conduz o cadastro pelo sistema (menos retrabalho pra você)
• Seu parceiro pode só mandar o dado — o sistema cuida do restante
• Cliente aprovado → mensagem de parabéns + como usar o app
• Em 30 dias → reforço do iGreen Club + pedido de indicação
• Acompanhamento por cerca de 7 meses, até o cliente estar pagando certinho

Resumo: uma IA especializada em iGreen, não um robô genérico.

Prefere que eu te mostre em 2 minutos ou te mando um resumo agora?$wa0$,
  $wa1$Sofia de novo.

Ontem te falei da plataforma de vendas iGreen: WhatsApp + SMS + ligação, landings e conversão com dados gráficos, cadastro pelo sistema, parceiro só manda o dado, e pós-venda (parabéns, app, Club em 30 dias, indicação — cerca de 7 meses).

Hoje consigo te mostrar em 2 minutos, ou te mando um exemplo de como o lead é atendido?

Responde: VER | RESUMO | DEPOIS$wa1$,
  'Sofia (Rafael/iGreen). Plataforma Zap+SMS+ligacao, landings/conversao com graficos, cadastra lead, pos-venda ate 7 meses. Quer ver? SIM',
  'Sofia (iGreen). Ainda quer ver a plataforma Zap+SMS+ligacao, landings com graficos e pos-venda? VER ou DEPOIS',
  $call0$Aqui é a Sofia, assistente virtual do Rafael, gestor da iGreen.
Te ligo rápido porque montamos uma plataforma de vendas só para consultor iGreen — a ideia é nenhum lead some no meio do caminho.
O sistema atende no WhatsApp, manda SMS, liga, tem landing pages e conversão de todos os produtos prontas, com dados gráficos, ajuda a cadastrar o lead, e se você tem parceiro, ele só manda o dado — o restante o sistema conduz.
Quando o cliente é aprovado, já sai mensagem de parabéns e o passo a passo de como usar o aplicativo. Em 30 dias falamos de novo do iGreen Club, pedimos indicação, e esse acompanhamento segue por cerca de 7 meses — até ele estar pagando certinho.
Não é chatbot genérico: é IA especializada no fluxo iGreen.
Consigo te mostrar em dois minutos agora, ou te mando um resumo no WhatsApp?$call0$,
  $call1$Sofia de novo, do Rafael da iGreen.
Só confirmando se ainda faz sentido te mostrar a plataforma que atende lead, tem landings e conversão com dados gráficos, cadastra e faz pós-venda por cerca de 7 meses.
Prefere agora ou o resumo no WhatsApp?$call1$
)
ON CONFLICT (id) DO UPDATE SET
  bloco_nome_com = EXCLUDED.bloco_nome_com,
  bloco_nome_sem = EXCLUDED.bloco_nome_sem,
  saudacao_manha = EXCLUDED.saudacao_manha,
  saudacao_tarde = EXCLUDED.saudacao_tarde,
  saudacao_noite = EXCLUDED.saudacao_noite,
  corpo_wa_d0 = EXCLUDED.corpo_wa_d0,
  corpo_wa_d1 = EXCLUDED.corpo_wa_d1,
  corpo_sms_d0 = EXCLUDED.corpo_sms_d0,
  corpo_sms_d1 = EXCLUDED.corpo_sms_d1,
  corpo_call_d0 = EXCLUDED.corpo_call_d0,
  corpo_call_d1 = EXCLUDED.corpo_call_d1,
  updated_at = now();
