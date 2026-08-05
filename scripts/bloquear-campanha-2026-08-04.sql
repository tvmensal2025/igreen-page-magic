-- ============================================================================
-- BLOQUEIO TOTAL DOS CONTATOS DO DISPARO EM MASSA DE 04/08/2026
-- ============================================================================
-- Objetivo: nenhum número que entrou na campanha de ontem pode receber
-- mensagem ou acompanhamento — nem bot, nem cadência A/B/C, nem pós-venda,
-- nem reheat, nem SMS, nem ligação, nem chat manual da plataforma.
--
-- Rode ETAPA POR ETAPA no SQL Editor do Supabase. Não rode o arquivo inteiro
-- de uma vez: a ETAPA 0 existe para você conferir o alcance antes de aplicar.
--
-- Como o bloqueio funciona (evidência no código):
--   customers.do_not_contact = true
--     -> assertCanContact (_shared/contact-suppression.ts) é fail-closed e é
--        consultado por cadence-tick, daily-reheat, pós-venda, voice-dialer,
--        voice-sms-send, manual-step-send, whapi-proxy e bulk-scheduler.
--   customers.bot_paused = true + bot_paused_reason = 'requested'
--     -> isCustomerPausedByHuman (_shared/bot/paused.ts) devolve true de forma
--        PERMANENTE. Só 'requested' | 'opt_out' | 'complaint' têm esse efeito;
--        um motivo livre cairia na regra de expiração de 48h.
--   voice_dnc_list
--     -> bloqueia SMS e ligação (Velip) no consultor.
--   bot_force_enabled = false
--     -> impede que um religamento forçado reabra a automação.
--
-- Reversão: ETAPA 3, no fim do arquivo. O rastro fica em
-- contact_suppression_log.reason = 'bulk_2026_08_04_block'.
--
-- ----------------------------------------------------------------------------
-- DOIS CUIDADOS QUE ESTE SCRIPT RESOLVE (não remova sem entender):
--
-- 1) 9º DÍGITO. O mesmo celular pode estar gravado como 5534991234567 (13) e
--    553491234567 (12). Comparar "últimos 11 dígitos" NÃO casa esses dois.
--    Usamos a chave canônica DDD + últimos 8 dígitos (fn_chave abaixo), que é
--    imune ao 9 extra. Mesma ideia do phoneAlt em voice-dialer-webhook.
--
-- 2) NÚMERO SEM CADASTRO. O ContactImporter aceita CSV/colar/grupo e gera ids
--    sintéticos ('import-<fone>', 'paste-<fone>', 'contact-<fone>'), que NÃO
--    são customers.id. Esses números podem não ter linha em customers, e
--    assertCanContact com channel='whatsapp' NÃO consulta voice_dnc_list
--    (_shared/contact-suppression.ts) — então voice_dnc sozinho não barra o
--    WhatsApp. Sem cadastro, a pessoa que responder cria um lead novo e entra
--    no funil. O passo 1.2 cria a linha já bloqueada para fechar esse furo.
-- ----------------------------------------------------------------------------
-- ============================================================================


-- ============================================================================
-- CHAVE CANÔNICA DE TELEFONE (imune a DDI e ao 9º dígito)
-- ============================================================================
-- Rode uma vez. É IMMUTABLE e só faz manipulação de texto — nenhum efeito
-- colateral. Pode apagar depois com:
--   DROP FUNCTION IF EXISTS public.fn_chave_fone_bulk(text);
CREATE OR REPLACE FUNCTION public.fn_chave_fone_bulk(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH d AS (
    -- tira sufixo de colisão do sync ('55...._igreenCode') e tudo que não é dígito
    SELECT regexp_replace(split_part(coalesce(p_phone, ''), '_', 1), '\D', '', 'g') AS x
  ), nat AS (
    -- remove o DDI 55 quando houver, sobrando o número nacional
    SELECT CASE WHEN length(x) > 11 AND left(x, 2) = '55' THEN substr(x, 3) ELSE x END AS n
    FROM d
  )
  -- DDD (2) + os 8 dígitos finais: iguala com e sem o 9º dígito
  SELECT CASE WHEN length(n) >= 10 THEN left(n, 2) || right(n, 8) ELSE NULL END
  FROM nat;
$$;

-- Sanidade da chave: as duas primeiras linhas devem ter chaves IGUAIS,
-- e as duas últimas também.
SELECT '5534991234567' AS entrada, public.fn_chave_fone_bulk('5534991234567') AS chave
UNION ALL SELECT '553491234567',        public.fn_chave_fone_bulk('553491234567')
UNION ALL SELECT '5511987654321_ABC12', public.fn_chave_fone_bulk('5511987654321_ABC12')
UNION ALL SELECT '(11) 98765-4321',     public.fn_chave_fone_bulk('(11) 98765-4321');
-- ============================================================================


-- ============================================================================
-- ETAPA 0 — CONFERÊNCIA (só leitura, não altera nada)
-- ============================================================================

-- 0.1 Quais campanhas de ontem serão consideradas?
SELECT id, name, consultant_id, status, total, sent, failed,
       created_at, started_at, finished_at
FROM public.bulk_campaigns
WHERE created_at >= '2026-08-04 00:00:00-03'
  AND created_at <  '2026-08-05 00:00:00-03'
ORDER BY created_at;

-- 0.2 Quantos números, e em que situação ficaram?
--     Bloqueamos TODOS, inclusive queued e failed — quem não recebeu ontem
--     poderia receber hoje quando o motor voltar.
SELECT t.status, count(*) AS numeros
FROM public.bulk_campaign_targets t
JOIN public.bulk_campaigns c ON c.id = t.campaign_id
WHERE c.created_at >= '2026-08-04 00:00:00-03'
  AND c.created_at <  '2026-08-05 00:00:00-03'
GROUP BY t.status
ORDER BY numeros DESC;

-- 0.3 ATENÇÃO — algum desses números é CLIENTE da carteira?
--     Bloquear um cliente ativo corta o pós-venda dele (D30..D210) e o
--     acompanhamento de quem já paga. Confira esta lista antes de aplicar.
--     Critérios espelham _shared/cliente-cadence-guard.ts.
WITH alvos AS (
  SELECT DISTINCT c.consultant_id, public.fn_chave_fone_bulk(t.phone) AS chave
  FROM public.bulk_campaign_targets t
  JOIN public.bulk_campaigns c ON c.id = t.campaign_id
  WHERE c.created_at >= '2026-08-04 00:00:00-03'
    AND c.created_at <  '2026-08-05 00:00:00-03'
    AND public.fn_chave_fone_bulk(t.phone) IS NOT NULL
)
SELECT cu.id, cu.name, cu.phone_whatsapp, cu.customer_origin, cu.status,
       cu.is_converted, cu.pos_venda_stage, cu.andamento_igreen
FROM public.customers cu
JOIN alvos a
  ON cu.consultant_id = a.consultant_id
 AND public.fn_chave_fone_bulk(cu.phone_whatsapp) = a.chave
WHERE cu.customer_origin IN ('igreen_sync', 'igreen_extension')
   OR cu.is_converted IS TRUE
   OR lower(coalesce(cu.status, '')) IN ('approved','active','registered_igreen','cadastro_concluido','complete')
   OR coalesce(cu.pos_venda_stage, '') <> ''
   OR lower(coalesce(cu.andamento_igreen, '')) IN ('ativo','aprovado','validado','licenciada','licenciado')
ORDER BY cu.name;

-- 0.4 O NÚMERO QUE IMPORTA: quantos números da campanha têm cadastro e
--     quantos NÃO têm. Os sem cadastro são o furo do item 2 do cabeçalho —
--     o passo 1.2 cria a linha bloqueada para eles.
WITH alvos AS (
  SELECT DISTINCT c.consultant_id, public.fn_chave_fone_bulk(t.phone) AS chave,
         min(t.phone) AS phone_exemplo
  FROM public.bulk_campaign_targets t
  JOIN public.bulk_campaigns c ON c.id = t.campaign_id
  WHERE c.created_at >= '2026-08-04 00:00:00-03'
    AND c.created_at <  '2026-08-05 00:00:00-03'
    AND public.fn_chave_fone_bulk(t.phone) IS NOT NULL
  GROUP BY c.consultant_id, public.fn_chave_fone_bulk(t.phone)
)
SELECT count(*)                                        AS numeros_na_campanha,
       count(*) FILTER (WHERE cu.id IS NOT NULL)       AS com_cadastro,
       count(*) FILTER (WHERE cu.id IS NULL)           AS sem_cadastro_vao_ser_criados
FROM alvos a
LEFT JOIN public.customers cu
  ON cu.consultant_id = a.consultant_id
 AND public.fn_chave_fone_bulk(cu.phone_whatsapp) = a.chave;


-- ============================================================================
-- ETAPA 1 — APLICAR O BLOQUEIO
-- ============================================================================
-- Rode só depois de conferir a ETAPA 0, em especial a 0.3 (clientes).
-- Rode os passos 1.1 a 1.5 NA ORDEM. O passo 1.1 define o conjunto e os
-- seguintes se apoiam nele, então cada comando é independente e pode rodar
-- isolado no SQL Editor (não depende de sessão nem de tabela temporária).
--
-- Se quiser PRESERVAR os clientes da carteira, descomente o filtro marcado
-- com "PROTEÇÃO OPCIONAL" no passo 1.1.

-- ---------------------------------------------------------------------------
-- 1.1 Define o conjunto e grava a trilha de auditoria.
--     Este passo é a fonte da verdade dos passos seguintes.
--     Idempotente: rodar de novo não duplica.
-- ---------------------------------------------------------------------------
INSERT INTO public.contact_suppression_log
       (customer_id, consultant_id, phone, reason, channel, notes)
WITH alvos AS (
  SELECT DISTINCT c.consultant_id, public.fn_chave_fone_bulk(t.phone) AS chave
  FROM public.bulk_campaign_targets t
  JOIN public.bulk_campaigns c ON c.id = t.campaign_id
  WHERE c.created_at >= '2026-08-04 00:00:00-03'
    AND c.created_at <  '2026-08-05 00:00:00-03'
    AND public.fn_chave_fone_bulk(t.phone) IS NOT NULL
)
SELECT DISTINCT
       cu.id,
       cu.consultant_id,
       regexp_replace(split_part(cu.phone_whatsapp, '_', 1), '\D', '', 'g'),
       'bulk_2026_08_04_block',
       'admin_sql',
       'Bloqueio solicitado pelo consultor apos a falha do disparo em massa de 04/08/2026.'
FROM public.customers cu
JOIN alvos a
  ON cu.consultant_id = a.consultant_id
 AND public.fn_chave_fone_bulk(cu.phone_whatsapp) = a.chave
WHERE NOT EXISTS (
  SELECT 1 FROM public.contact_suppression_log l
  WHERE l.customer_id = cu.id
    AND l.reason = 'bulk_2026_08_04_block'
)
-- ---------------------------------------------------------------------------
-- PROTEÇÃO OPCIONAL: descomente as 7 linhas para NÃO bloquear cliente ativo.
--   AND NOT (
--         cu.customer_origin IN ('igreen_sync', 'igreen_extension')
--      OR cu.is_converted IS TRUE
--      OR lower(coalesce(cu.status, '')) IN ('approved','active','registered_igreen','cadastro_concluido','complete')
--      OR coalesce(cu.pos_venda_stage, '') <> ''
--      OR lower(coalesce(cu.andamento_igreen, '')) IN ('ativo','aprovado','validado','licenciada','licenciado')
--   )
-- ---------------------------------------------------------------------------
;

-- Confira o tamanho antes de seguir. Se vier 0, revise as datas da ETAPA 0.1.
SELECT count(*) AS no_conjunto
FROM public.contact_suppression_log
WHERE reason = 'bulk_2026_08_04_block';

-- ---------------------------------------------------------------------------
-- 1.2 FECHA O FURO: números da campanha SEM cadastro em customers.
--     Sem linha em customers, o gate de WhatsApp não tem o que bloquear e a
--     pessoa que responder viraria lead novo no Grupo A. Criamos a linha já
--     bloqueada. Idempotente: só insere quem ainda não existe.
--     Se a ETAPA 0.4 disse sem_cadastro = 0, este passo não faz nada.
-- ---------------------------------------------------------------------------
WITH alvos AS (
  SELECT c.consultant_id,
         public.fn_chave_fone_bulk(t.phone) AS chave,
         min(regexp_replace(split_part(t.phone, '_', 1), '\D', '', 'g')) AS phone_digits,
         min(coalesce(nullif(btrim(t.name), ''), '')) AS nome
  FROM public.bulk_campaign_targets t
  JOIN public.bulk_campaigns c ON c.id = t.campaign_id
  WHERE c.created_at >= '2026-08-04 00:00:00-03'
    AND c.created_at <  '2026-08-05 00:00:00-03'
    AND public.fn_chave_fone_bulk(t.phone) IS NOT NULL
  GROUP BY c.consultant_id, public.fn_chave_fone_bulk(t.phone)
), faltantes AS (
  SELECT a.*
  FROM alvos a
  WHERE NOT EXISTS (
    SELECT 1 FROM public.customers cu
    WHERE cu.consultant_id = a.consultant_id
      AND public.fn_chave_fone_bulk(cu.phone_whatsapp) = a.chave
  )
), novos AS (
  INSERT INTO public.customers
         (consultant_id, phone_whatsapp, name, do_not_contact,
          bot_paused, bot_paused_reason, bot_paused_at, bot_force_enabled)
  SELECT f.consultant_id, f.phone_digits, nullif(f.nome, ''), true,
         true, 'requested', now(), false
  FROM faltantes f
  RETURNING id, consultant_id, phone_whatsapp
)
INSERT INTO public.contact_suppression_log
       (customer_id, consultant_id, phone, reason, channel, notes)
SELECT n.id, n.consultant_id, n.phone_whatsapp,
       'bulk_2026_08_04_block', 'admin_sql',
       'Numero da campanha 04/08/2026 sem cadastro: linha criada ja bloqueada.'
FROM novos n;

-- ---------------------------------------------------------------------------
-- 1.3 Bloqueio no cadastro: corta bot, cadência, pós-venda, reheat e chat manual.
-- ---------------------------------------------------------------------------
UPDATE public.customers cu
SET do_not_contact    = true,
    bot_paused        = true,
    bot_paused_reason = 'requested',   -- valor reconhecido = silêncio permanente
    bot_paused_at     = now(),
    bot_force_enabled = false,
    updated_at        = now()
FROM public.contact_suppression_log l
WHERE l.customer_id = cu.id
  AND l.reason = 'bulk_2026_08_04_block';

-- ---------------------------------------------------------------------------
-- 1.4 Bloqueio de SMS e ligação (Velip). Grava as duas formas do número
--     (com e sem o 9º dígito) porque o gate de voz compara texto por sufixo.
-- ---------------------------------------------------------------------------
INSERT INTO public.voice_dnc_list (consultant_id, phone, reason, source)
SELECT DISTINCT l.consultant_id, v.fone, 'bulk_2026_08_04_block', 'admin_sql'
FROM public.contact_suppression_log l
CROSS JOIN LATERAL (
  VALUES
    (l.phone),
    -- variante sem o 9º dígito: 55 DD 9 XXXXXXXX -> 55 DD XXXXXXXX
    (CASE WHEN length(l.phone) = 13 AND left(l.phone, 2) = '55' AND substr(l.phone, 5, 1) = '9'
          THEN '55' || substr(l.phone, 3, 2) || substr(l.phone, 6)
     END),
    -- variante COM o 9º dígito: 55 DD XXXXXXXX -> 55 DD 9 XXXXXXXX
    (CASE WHEN length(l.phone) = 12 AND left(l.phone, 2) = '55'
          THEN '55' || substr(l.phone, 3, 2) || '9' || substr(l.phone, 5)
     END)
) AS v(fone)
WHERE l.reason = 'bulk_2026_08_04_block'
  AND coalesce(v.fone, '') <> ''
ON CONFLICT (consultant_id, phone) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1.5 Zera a fila da campanha, para o bulk-scheduler não retomar esses alvos
--     quando a função voltar ao ar.
-- ---------------------------------------------------------------------------
UPDATE public.bulk_campaign_targets t
SET status = 'failed',
    error  = 'bloqueado_manualmente_2026_08_04'
FROM public.bulk_campaigns c
WHERE c.id = t.campaign_id
  AND c.created_at >= '2026-08-04 00:00:00-03'
  AND c.created_at <  '2026-08-05 00:00:00-03'
  AND t.status IN ('queued', 'sending');

-- ---------------------------------------------------------------------------
-- 1.6 Encerra as campanhas de ontem para não voltarem a rodar.
-- ---------------------------------------------------------------------------
UPDATE public.bulk_campaigns
SET status      = 'canceled',
    finished_at = coalesce(finished_at, now())
WHERE created_at >= '2026-08-04 00:00:00-03'
  AND created_at <  '2026-08-05 00:00:00-03'
  AND status IN ('scheduled', 'running', 'paused');


-- ============================================================================
-- ETAPA 2 — VERIFICAÇÃO PÓS-BLOQUEIO
-- ============================================================================

-- 2.0 ***A RESPOSTA PARA "TODOS FORAM BLOQUEADOS?"***
--     Percorre a campanha número por número e confere o bloqueio de cada um.
--     Objetivo: total = bloqueados_ok, e as outras 3 colunas em ZERO.
WITH alvos AS (
  SELECT DISTINCT c.consultant_id, public.fn_chave_fone_bulk(t.phone) AS chave
  FROM public.bulk_campaign_targets t
  JOIN public.bulk_campaigns c ON c.id = t.campaign_id
  WHERE c.created_at >= '2026-08-04 00:00:00-03'
    AND c.created_at <  '2026-08-05 00:00:00-03'
    AND public.fn_chave_fone_bulk(t.phone) IS NOT NULL
), situacao AS (
  SELECT a.chave,
         bool_or(cu.id IS NOT NULL)                                   AS tem_cadastro,
         bool_and(coalesce(cu.do_not_contact, false))                 AS todos_dnc,
         bool_and(coalesce(cu.bot_paused, false))                     AS todos_pausados
  FROM alvos a
  LEFT JOIN public.customers cu
    ON cu.consultant_id = a.consultant_id
   AND public.fn_chave_fone_bulk(cu.phone_whatsapp) = a.chave
  GROUP BY a.chave
)
SELECT count(*)                                                              AS total_numeros_campanha,
       count(*) FILTER (WHERE tem_cadastro AND todos_dnc AND todos_pausados) AS bloqueados_ok,
       count(*) FILTER (WHERE NOT tem_cadastro)                              AS sem_cadastro_furo,
       count(*) FILTER (WHERE tem_cadastro AND NOT todos_dnc)                AS falta_do_not_contact,
       count(*) FILTER (WHERE tem_cadastro AND todos_dnc AND NOT todos_pausados) AS falta_bot_paused
FROM situacao;

-- 2.0b Se a 2.0 apontou qualquer furo, esta lista mostra QUEM ficou de fora.
WITH alvos AS (
  SELECT DISTINCT c.consultant_id, public.fn_chave_fone_bulk(t.phone) AS chave,
         min(t.phone) AS phone_exemplo
  FROM public.bulk_campaign_targets t
  JOIN public.bulk_campaigns c ON c.id = t.campaign_id
  WHERE c.created_at >= '2026-08-04 00:00:00-03'
    AND c.created_at <  '2026-08-05 00:00:00-03'
    AND public.fn_chave_fone_bulk(t.phone) IS NOT NULL
  GROUP BY c.consultant_id, public.fn_chave_fone_bulk(t.phone)
)
SELECT a.phone_exemplo, a.chave, cu.id AS customer_id, cu.name,
       cu.do_not_contact, cu.bot_paused, cu.bot_paused_reason,
       CASE WHEN cu.id IS NULL THEN 'sem cadastro em customers'
            WHEN cu.do_not_contact IS NOT TRUE THEN 'falta do_not_contact'
            ELSE 'falta bot_paused' END AS problema
FROM alvos a
LEFT JOIN public.customers cu
  ON cu.consultant_id = a.consultant_id
 AND public.fn_chave_fone_bulk(cu.phone_whatsapp) = a.chave
WHERE cu.id IS NULL
   OR cu.do_not_contact IS NOT TRUE
   OR cu.bot_paused IS NOT TRUE
ORDER BY problema, a.phone_exemplo;

-- 2.1 Quantos ficaram bloqueados de fato
SELECT count(*) AS bloqueados
FROM public.contact_suppression_log
WHERE reason = 'bulk_2026_08_04_block';

-- 2.2 Sobrou alguém sem as duas flags? Esperado: 0 linhas.
SELECT cu.id, cu.name, cu.phone_whatsapp, cu.do_not_contact,
       cu.bot_paused, cu.bot_paused_reason
FROM public.customers cu
JOIN public.contact_suppression_log l ON l.customer_id = cu.id
WHERE l.reason = 'bulk_2026_08_04_block'
  AND (cu.do_not_contact IS NOT TRUE OR cu.bot_paused IS NOT TRUE);

-- 2.2b SMS/voz: todo número bloqueado está no voice_dnc_list? Esperado: 0 linhas.
SELECT l.phone, l.customer_id
FROM public.contact_suppression_log l
WHERE l.reason = 'bulk_2026_08_04_block'
  AND coalesce(l.phone, '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.voice_dnc_list d
    WHERE d.consultant_id = l.consultant_id
      AND public.fn_chave_fone_bulk(d.phone) = public.fn_chave_fone_bulk(l.phone)
  );

-- 2.3 Nada mais na fila da campanha? Esperado: 0 linhas.
SELECT t.status, count(*)
FROM public.bulk_campaign_targets t
JOIN public.bulk_campaigns c ON c.id = t.campaign_id
WHERE c.created_at >= '2026-08-04 00:00:00-03'
  AND c.created_at <  '2026-08-05 00:00:00-03'
  AND t.status IN ('queued', 'sending')
GROUP BY t.status;

-- 2.4 Confirme nas próximas horas que nada saiu para eles.
SELECT cal.customer_id, cal.stage, cal.status, cal.created_at
FROM public.cadence_action_log cal
JOIN public.contact_suppression_log l ON l.customer_id = cal.customer_id
WHERE l.reason = 'bulk_2026_08_04_block'
  AND cal.created_at >= '2026-08-05 00:00:00-03'
ORDER BY cal.created_at DESC
LIMIT 50;


-- ============================================================================
-- ETAPA 3 — REVERSÃO (guarde este bloco; não rode agora)
-- ============================================================================
-- Desbloqueia exatamente quem foi bloqueado por este script, sem tocar em
-- ninguém que já era DNC antes por reclamação ou opt-out real.
-- Rode na ordem: 3.1 -> 3.2 -> 3.3 -> 3.4.
--
-- 3.1 Desbloqueia os cadastros que JÁ existiam antes do script.
-- UPDATE public.customers cu
-- SET do_not_contact    = false,
--     bot_paused        = false,
--     bot_paused_reason = NULL,
--     bot_paused_at     = NULL,
--     updated_at        = now()
-- FROM public.contact_suppression_log l
-- WHERE l.customer_id = cu.id
--   AND l.reason = 'bulk_2026_08_04_block'
--   AND l.notes NOT LIKE 'Numero da campanha%sem cadastro%'
--   -- não religa quem tem bloqueio legítimo registrado em outro momento
--   AND NOT EXISTS (
--     SELECT 1 FROM public.contact_suppression_log l2
--     WHERE l2.customer_id = cu.id
--       AND l2.reason <> 'bulk_2026_08_04_block'
--   );
--
-- 3.2 Remove os cadastros que ESTE script criou no passo 1.2 (não existiam
--     antes, então desbloquear não faz sentido: some com eles). Só apaga se
--     continuarem sem conversa e sem histórico.
-- DELETE FROM public.customers cu
-- USING public.contact_suppression_log l
-- WHERE l.customer_id = cu.id
--   AND l.reason = 'bulk_2026_08_04_block'
--   AND l.notes LIKE 'Numero da campanha%sem cadastro%'
--   AND NOT EXISTS (SELECT 1 FROM public.conversations cv WHERE cv.customer_id = cu.id);
--
-- 3.3 Limpa DNC de voz/SMS e a trilha.
-- DELETE FROM public.voice_dnc_list
-- WHERE reason = 'bulk_2026_08_04_block';
--
-- DELETE FROM public.contact_suppression_log
-- WHERE reason = 'bulk_2026_08_04_block';
--
-- 3.4 Remove a função auxiliar.
-- DROP FUNCTION IF EXISTS public.fn_chave_fone_bulk(text);
