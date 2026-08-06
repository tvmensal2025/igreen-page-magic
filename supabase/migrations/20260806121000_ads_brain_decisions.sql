-- Cérebro de Campanhas — histórico de decisões + idempotência de execução.
--
-- PROPOSTA ADITIVA — NÃO EXECUTADA nesta branch.
--
-- Por que uma tabela nova (e não `ad_recommendations`):
--   `ad_recommendations` é a caixa de entrada da UI (title/message/severity,
--   dismiss/apply). Não tem chave de idempotência, não guarda a amostra que
--   originou a decisão, nem o desfecho posterior. Reaproveitá-la para
--   idempotência de escrita na Meta exigiria mudar o significado das colunas
--   existentes e quebraria as telas que já a consomem.
--
--   As duas convivem: o Cérebro continua escrevendo em `ad_recommendations`
--   para o consultor ver, e registra aqui a trilha auditável.
--
-- O código NÃO depende desta migration: `brain-decision-store.ts` detecta a
-- tabela ausente e segue calculando/recomendando sem histórico.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.ads_brain_decisions;
--   ALTER TABLE public.ad_recommendations DROP COLUMN IF EXISTS dedup_key;

CREATE TABLE IF NOT EXISTS public.ads_brain_decisions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id         uuid NOT NULL,
  campaign_id           uuid NOT NULL,

  -- Amostra que originou a decisão.
  snapshot_version      text NOT NULL,
  snapshot_schema_version integer NOT NULL DEFAULT 1,

  -- O que foi decidido.
  action                text NOT NULL,
  action_kind           text,
  mode                  text NOT NULL DEFAULT 'recommend',
  waste_guard_mode      text,
  confidence            text,
  sample_quality        text,
  data_quality_state    text,

  -- Como cada dimensão pesou (níveis + notas em pt-BR).
  health                jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Métricas congeladas no momento da decisão.
  measured              jsonb NOT NULL DEFAULT '{}'::jsonb,
  blockers              jsonb NOT NULL DEFAULT '[]'::jsonb,

  reason                text NOT NULL,
  next_evaluation       text,

  from_budget_cents     integer,
  to_budget_cents       integer,
  step_pct              integer,

  -- recommended | reserved | executed | failed | skipped
  status                text NOT NULL DEFAULT 'recommended',

  -- Reserva atômica do direito de chamar a Meta.
  idempotency_key       text NOT NULL,

  executed_at           timestamptz,
  meta_response         jsonb,
  meta_error            text,

  -- improved | worsened | neutral | inconclusive | insufficient_data
  outcome               text,
  outcome_evaluated_at  timestamptz,
  outcome_metrics       jsonb,

  decided_at            timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- O coração da idempotência: duas instâncias do cron, um retry de timeout ou
-- um callback repetido colidem aqui em vez de escrever duas vezes na Meta.
CREATE UNIQUE INDEX IF NOT EXISTS ads_brain_decisions_idempotency_key
  ON public.ads_brain_decisions (idempotency_key);

-- A mesma amostra não pode gerar duas decisões de orçamento para a mesma
-- campanha, mesmo que os valores de budget mudem entre as tentativas.
CREATE UNIQUE INDEX IF NOT EXISTS ads_brain_decisions_snapshot_budget_once
  ON public.ads_brain_decisions (campaign_id, snapshot_version, action)
  WHERE action IN ('increase_budget', 'reduce_budget');

CREATE INDEX IF NOT EXISTS ads_brain_decisions_campaign_recent
  ON public.ads_brain_decisions (campaign_id, decided_at DESC);

CREATE INDEX IF NOT EXISTS ads_brain_decisions_consultant_recent
  ON public.ads_brain_decisions (consultant_id, decided_at DESC);

-- Fila de avaliação de resultado (24h / 72h / 7d).
CREATE INDEX IF NOT EXISTS ads_brain_decisions_pending_outcome
  ON public.ads_brain_decisions (executed_at)
  WHERE status = 'executed' AND outcome IS NULL;

ALTER TABLE public.ads_brain_decisions ENABLE ROW LEVEL SECURITY;

-- Leitura pelo dono; escrita só por service_role (edge functions).
DROP POLICY IF EXISTS ads_brain_decisions_select_own ON public.ads_brain_decisions;
CREATE POLICY ads_brain_decisions_select_own
  ON public.ads_brain_decisions
  FOR SELECT
  USING (consultant_id = auth.uid());

COMMENT ON TABLE public.ads_brain_decisions IS
  'Histórico auditável do Cérebro de Campanhas: amostra (snapshot_version), decisão, bloqueios, execução na Meta e resultado posterior. Idempotência por idempotency_key.';

-- Idempotência da caixa de entrada da UI: hoje o Cérebro faz SELECT + INSERT
-- para não duplicar recomendação, o que não protege contra concorrência.
ALTER TABLE public.ad_recommendations
  ADD COLUMN IF NOT EXISTS dedup_key text;

CREATE UNIQUE INDEX IF NOT EXISTS ad_recommendations_dedup_key_open
  ON public.ad_recommendations (dedup_key)
  WHERE dedup_key IS NOT NULL AND dismissed_at IS NULL AND applied_at IS NULL;

COMMENT ON COLUMN public.ad_recommendations.dedup_key IS
  'Chave de deduplicação de recomendações abertas. NULL preserva o comportamento antigo das linhas já existentes.';
