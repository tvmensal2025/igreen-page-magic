-- =============================================================================
-- DIAGNÓSTICO (SOMENTE LEITURA) — leads que deveriam ser de um parceiro
-- e ficaram sem `referral_partner_id`.
--
-- Contexto: até 2026-08-05 a frase padrão do QR do parceiro continha
-- "quero saber mais", que é âncora de Click-to-WhatsApp do Meta. Os webhooks
-- classificavam o lead como lead Meta (`blockKeywordForMetaLead`) e pulavam o
-- bloco de atribuição de parceiro INTEIRO. Ver armadilha #53.
--
-- NÃO ESCREVE NADA. Só SELECT. Rode no SQL Editor do Supabase.
-- Serve para decidir se vale um backfill e para conferir caso a caso.
-- =============================================================================

-- ─── 1) Quantos leads casam keyword de parceiro e estão SEM parceiro ─────────
-- Usa a 1ª mensagem inbound (ou `customers.initial_message`) e exige a keyword
-- com fronteira de palavra (\m ... \M), mesma régua conservadora do
-- `keyword-matcher.ts` (sem fuzzy).
WITH kw AS (
  SELECT
    rp.id            AS partner_id,
    rp.nome          AS partner_nome,
    rp.consultant_id,
    btrim(k.v)       AS keyword,
    -- escapa metacaracteres para a keyword não virar regex
    regexp_replace(btrim(k.v), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') AS kw_rx
  FROM public.referral_partners rp
  CROSS JOIN LATERAL unnest(coalesce(rp.keywords, ARRAY[]::text[])) AS k(v)
  WHERE rp.is_active = true
    AND btrim(coalesce(k.v, '')) <> ''
),
primeira_msg AS (
  SELECT DISTINCT ON (c.id)
    c.id            AS customer_id,
    c.consultant_id,
    c.name,
    c.phone_whatsapp,
    c.created_at,
    c.status,
    c.pos_venda_stage,
    c.andamento_igreen,
    c.customer_origin,
    c.is_converted,
    c.portal_submitted_at,
    c.source_ad_id,
    c.source_campaign_id,
    coalesce(nullif(btrim(conv.message_text), ''), c.initial_message) AS texto
  FROM public.customers c
  LEFT JOIN public.conversations conv
    ON conv.customer_id = c.id
   AND conv.message_direction = 'inbound'
   AND nullif(btrim(conv.message_text), '') IS NOT NULL
  WHERE c.referral_partner_id IS NULL
  ORDER BY c.id, conv.created_at ASC NULLS LAST
)
SELECT
  kw.partner_nome,
  kw.keyword,
  count(*)                                                        AS leads_sem_parceiro,
  count(*) FILTER (WHERE public.customer_is_closed_deal(
    m.is_converted, m.status, m.pos_venda_stage, m.andamento_igreen, m.customer_origin
  ))                                                              AS ja_fecharam,
  count(*) FILTER (WHERE m.portal_submitted_at IS NOT NULL)        AS enviaram_cadastro,
  count(*) FILTER (WHERE m.source_ad_id IS NOT NULL
                      OR m.source_campaign_id IS NOT NULL)         AS com_sinal_meta,
  min(m.created_at)                                               AS primeiro,
  max(m.created_at)                                               AS ultimo
FROM primeira_msg m
JOIN kw
  ON kw.consultant_id = m.consultant_id
 AND m.texto IS NOT NULL
 AND lower(m.texto) ~ ('\m' || lower(kw.kw_rx) || '\M')
GROUP BY kw.partner_nome, kw.keyword
ORDER BY leads_sem_parceiro DESC;


-- ─── 2) Detalhe por lead (para conferir antes de qualquer backfill) ──────────
-- Descomente e ajuste o nome do parceiro.
--
-- WITH kw AS (
--   SELECT rp.id AS partner_id, rp.nome, rp.consultant_id,
--          regexp_replace(btrim(k.v), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') AS kw_rx,
--          btrim(k.v) AS keyword
--   FROM public.referral_partners rp
--   CROSS JOIN LATERAL unnest(coalesce(rp.keywords, ARRAY[]::text[])) AS k(v)
--   WHERE rp.is_active = true AND rp.nome ILIKE '%jose%'
-- )
-- SELECT c.id, c.name, c.phone_whatsapp, c.created_at, c.status,
--        c.pos_venda_stage, c.andamento_igreen, c.customer_origin,
--        c.portal_submitted_at, c.source_ad_id, c.needs_manual_review,
--        kw.nome AS parceiro_provavel, kw.keyword,
--        left(coalesce((SELECT conv.message_text FROM public.conversations conv
--                        WHERE conv.customer_id = c.id
--                          AND conv.message_direction = 'inbound'
--                          AND nullif(btrim(conv.message_text), '') IS NOT NULL
--                        ORDER BY conv.created_at ASC LIMIT 1),
--                      c.initial_message), 160) AS primeira_msg
-- FROM public.customers c
-- JOIN kw ON kw.consultant_id = c.consultant_id
-- WHERE c.referral_partner_id IS NULL
--   AND lower(coalesce((SELECT conv.message_text FROM public.conversations conv
--                        WHERE conv.customer_id = c.id
--                          AND conv.message_direction = 'inbound'
--                          AND nullif(btrim(conv.message_text), '') IS NOT NULL
--                        ORDER BY conv.created_at ASC LIMIT 1),
--                      c.initial_message, '')) ~ ('\m' || lower(kw.kw_rx) || '\M')
-- ORDER BY c.created_at DESC
-- LIMIT 200;


-- ─── 3) Leads que o webhook NÃO conseguiu gravar (pendência nova) ────────────
SELECT c.id, c.name, c.phone_whatsapp, c.manual_review_reason, c.manual_review_at
FROM public.customers c
WHERE c.needs_manual_review = true
  AND c.manual_review_reason = 'partner_attribution_write_failed'
ORDER BY c.manual_review_at DESC NULLS LAST
LIMIT 200;


-- ─── 4) Sombras de carteira que ainda guardam o parceiro (pré-correção) ──────
-- Depois do fix, `carryPartnerAttributionToWalletRow` migra isso na absorção.
-- Aqui só mostra os casos antigos que ficaram presos na linha DNC.
SELECT
  sombra.id            AS sombra_id,
  sombra.phone_whatsapp,
  sombra.referral_partner_id,
  sombra.referral_keyword_matched,
  carteira.id          AS carteira_id,
  carteira.referral_partner_id AS carteira_parceiro
FROM public.customers sombra
JOIN public.customers carteira
  ON carteira.consultant_id = sombra.consultant_id
 AND carteira.customer_origin IN ('igreen_sync', 'igreen_extension')
 AND (
      carteira.whatsapp_chat_id = sombra.phone_whatsapp
   OR carteira.phone_whatsapp LIKE sombra.phone_whatsapp || '\_%'
 )
WHERE sombra.bot_paused_reason = 'absorbed_wallet_duplicate'
  AND sombra.referral_partner_id IS NOT NULL
  AND carteira.referral_partner_id IS NULL
ORDER BY sombra.updated_at DESC NULLS LAST
LIMIT 200;
