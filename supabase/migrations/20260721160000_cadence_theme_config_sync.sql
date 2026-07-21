-- Temas do Multicanal (Grupo B Dia 2/7) editáveis e lidos pelo cadence-tick.
-- Sem cruise (ainda sem destino de campanha).
-- consultant_id NULL = global (fallback); override por consultor no publish.

CREATE TABLE IF NOT EXISTS public.cadence_theme_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid REFERENCES public.consultants(id) ON DELETE CASCADE,
  theme_id text NOT NULL,
  wa_text text NOT NULL DEFAULT '',
  sms_text text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (consultant_id, theme_id)
);

CREATE INDEX IF NOT EXISTS cadence_theme_config_consultant_idx
  ON public.cadence_theme_config (consultant_id);

COMMENT ON TABLE public.cadence_theme_config IS
  'Temas rotativos COLD_2 / SMS_TEMA_* — fonte: Multicanal (theme_*). Motor lê daqui; fallback hardcoded em cadence-themes.ts.';

ALTER TABLE public.cadence_theme_config ENABLE ROW LEVEL SECURITY;

-- Service role / edge usam service key; policies mínimas para authenticated read do próprio.
DROP POLICY IF EXISTS cadence_theme_config_select_own ON public.cadence_theme_config;
CREATE POLICY cadence_theme_config_select_own ON public.cadence_theme_config
  FOR SELECT TO authenticated
  USING (consultant_id IS NULL OR consultant_id = auth.uid());

DROP POLICY IF EXISTS cadence_theme_config_write_own ON public.cadence_theme_config;
CREATE POLICY cadence_theme_config_write_own ON public.cadence_theme_config
  FOR ALL TO authenticated
  USING (consultant_id = auth.uid())
  WITH CHECK (consultant_id = auth.uid());

-- Seed global (7 temas rotativos — alinhados ao Multicanal; sem cruise)
INSERT INTO public.cadence_theme_config (consultant_id, theme_id, wa_text, sms_text, enabled)
VALUES
(
  NULL,
  'simplified_analysis',
  $wa$Olá, {{nome}}.

Boa notícia: agora dá para começar sua análise só com o valor médio da conta — sem foto e sem burocracia.

{{frase_disponibilidade}}

Qual faixa está sua conta hoje?$wa$,
  $sms${{consultor}} | iGreen: Oi {{nome}}! Agora da pra analisar so com o valor da conta. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.$sms$,
  true
),
(
  NULL,
  'tariff_flags',
  $wa$Olá, {{nome}}.

As bandeiras amarela e vermelha podem aumentar o valor final da conta.

O benefício de economia pode ajudar a reduzir o impacto desses aumentos, conforme o consumo e as condições aplicáveis.

Quer análise inicial pelo valor médio? Qual faixa?$wa$,
  $sms${{consultor}} | Energia: bandeiras podem subir a conta. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.$sms$,
  true
),
(
  NULL,
  'no_home_panels',
  $wa$Olá, {{nome}}.

Para conhecer essa possibilidade de economia, não é necessário instalar placas solares na sua casa, fazer obra ou alterar sua instalação.

A análise pode começar pelo valor médio. Como prefere?$wa$,
  $sms${{consultor}} | Energia: sem placas nem obra. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.$sms$,
  true
),
(
  NULL,
  'security',
  $wa$Olá, {{nome}}. Aqui é {{consultor}}.

Reforço: não pedimos Pix, depósito ou pagamento ao consultor para iniciar a análise.

{{frase_disponibilidade}}

Como prefere seguir?$wa$,
  $sms${{consultor}} | iGreen: analise sem custo antecipado. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.$sms$,
  true
),
(
  NULL,
  'benefits_club',
  $wa$Olá, {{nome}}.

O benefício não termina na economia da conta: clientes elegíveis podem ter vantagens em estabelecimentos parceiros, conforme condições vigentes.

O que você quer conhecer?$wa$,
  $sms${{consultor}} | iGreen: economia + clube de parceiros. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.$sms$,
  true
),
(
  NULL,
  'referral_cashback',
  $wa$Olá, {{nome}}.

Além da própria economia, também podem existir benefícios por indicação, conforme as regras vigentes.

O que você quer conhecer?$wa$,
  $sms${{consultor}} | iGreen: economia + indicacao (regras). Abra: https://wa.me/{{consultor_phone}} SAIR encerra.$sms$,
  true
),
(
  NULL,
  'digital_app',
  $wa$Olá, {{nome}}.

Além da economia na conta, clientes elegíveis podem acompanhar o benefício pelo aplicativo, conforme as condições vigentes.

{{frase_disponibilidade}}

Como prefere seguir?$wa$,
  $sms${{consultor}} | iGreen: economia no app. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.$sms$,
  true
)
ON CONFLICT (consultant_id, theme_id) DO UPDATE SET
  wa_text = EXCLUDED.wa_text,
  sms_text = EXCLUDED.sms_text,
  enabled = true,
  updated_at = now();

-- Cópia inicial para o consultor principal (até o próximo Publish Multicanal)
INSERT INTO public.cadence_theme_config (consultant_id, theme_id, wa_text, sms_text, enabled)
SELECT '0c2711ad-4836-41e6-afba-edd94f698ae3'::uuid, theme_id, wa_text, sms_text, enabled
FROM public.cadence_theme_config
WHERE consultant_id IS NULL
ON CONFLICT (consultant_id, theme_id) DO UPDATE SET
  wa_text = EXCLUDED.wa_text,
  sms_text = EXCLUDED.sms_text,
  enabled = true,
  updated_at = now();
