/**
 * Deduplica templates globais (consultant_id IS NULL) e impede nova duplicata.
 *
 * Postgres UNIQUE (consultant_id, template_key) NÃO bloqueia várias linhas com
 * consultant_id NULL — cada NULL é distinto. Isso fazia o PostgREST maybeSingle()
 * falhar e o cron bot-followup-checker cair no fallback personalizado, que era
 * cacheado e contaminava o próximo lead (Marcos recebeu "Oi João").
 */

-- Mantém a linha mais recente por (template_key) quando consultant_id IS NULL
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY template_key
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
    ) AS rn
  FROM public.consultant_message_templates
  WHERE consultant_id IS NULL
)
DELETE FROM public.consultant_message_templates t
USING ranked r
WHERE t.id = r.id
  AND r.rn > 1;

-- Mesma proteção para overrides por consultor (defesa em profundidade)
WITH ranked_c AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY consultant_id, template_key
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
    ) AS rn
  FROM public.consultant_message_templates
  WHERE consultant_id IS NOT NULL
)
DELETE FROM public.consultant_message_templates t
USING ranked_c r
WHERE t.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS consultant_message_templates_global_key_uidx
  ON public.consultant_message_templates (template_key)
  WHERE consultant_id IS NULL;
