-- ============================================================================
-- "TODOS OS NÚMEROS DA CAMPANHA DE ONTEM FORAM BLOQUEADOS?"
-- ============================================================================
-- Query única, autocontida (não precisa criar função nem nada antes).
-- Cole no SQL Editor do Supabase e rode. Devolve UMA linha.
--
-- Leitura do resultado:
--   total_numeros            = números distintos que entraram na campanha
--   bloqueados_ok            = já estão 100% bloqueados
--   >>> BLOQUEIO COMPLETO quando bloqueados_ok = total_numeros e as
--       colunas de furo abaixo estão todas em ZERO.
--
--   furo_sem_cadastro        = número da campanha sem linha em customers.
--                              Não há o que bloquear: se a pessoa responder,
--                              o webhook cria lead novo e ela entra no funil.
--   furo_falta_dnc           = tem cadastro mas do_not_contact != true
--   furo_falta_pausa         = tem DNC mas bot_paused != true
--                              (do_not_contact sozinho não silencia número
--                               compartilhado — evalNumberPauseRows exige que
--                               TODAS as linhas do telefone sejam DNC)
--   furo_pausa_expiravel     = bot_paused_reason fora de
--                              requested/opt_out/complaint. Só esses três dão
--                              silêncio permanente; qualquer outro expira em
--                              48h e o lead volta a receber.
--   furo_sms_voz_liberado    = número que não está no voice_dnc_list, então
--                              SMS e ligação ainda podem sair.
--
-- A normalização de telefone usa DDD + 8 dígitos finais, para casar o mesmo
-- celular gravado com e sem o 9º dígito e com o sufixo _igreenCode do sync.
-- ============================================================================

WITH alvos AS (
  SELECT DISTINCT
         c.consultant_id,
         CASE
           WHEN length(n.nat) >= 10 THEN left(n.nat, 2) || right(n.nat, 8)
         END AS chave
  FROM public.bulk_campaign_targets t
  JOIN public.bulk_campaigns c ON c.id = t.campaign_id
  CROSS JOIN LATERAL (
    SELECT regexp_replace(split_part(t.phone, '_', 1), '\D', '', 'g') AS d
  ) AS x
  CROSS JOIN LATERAL (
    SELECT CASE WHEN length(x.d) > 11 AND left(x.d, 2) = '55'
                THEN substr(x.d, 3) ELSE x.d END AS nat
  ) AS n
  WHERE c.created_at >= '2026-08-04 00:00:00-03'
    AND c.created_at <  '2026-08-05 00:00:00-03'
    AND length(n.nat) >= 10
),
situacao AS (
  SELECT a.chave,
         bool_or(cu.id IS NOT NULL)                        AS tem_cadastro,
         bool_and(coalesce(cu.do_not_contact, false))      AS todos_dnc,
         bool_and(coalesce(cu.bot_paused, false))          AS todos_pausados,
         bool_and(lower(coalesce(cu.bot_paused_reason, ''))
                  IN ('requested', 'opt_out', 'complaint')) AS pausa_permanente,
         bool_or(d.phone IS NOT NULL)                      AS tem_dnc_voz
  FROM alvos a
  LEFT JOIN public.customers cu
    ON cu.consultant_id = a.consultant_id
   AND CASE
         WHEN length(regexp_replace(split_part(cu.phone_whatsapp, '_', 1), '\D', '', 'g')) > 11
              AND left(regexp_replace(split_part(cu.phone_whatsapp, '_', 1), '\D', '', 'g'), 2) = '55'
         THEN left(substr(regexp_replace(split_part(cu.phone_whatsapp, '_', 1), '\D', '', 'g'), 3), 2)
              || right(substr(regexp_replace(split_part(cu.phone_whatsapp, '_', 1), '\D', '', 'g'), 3), 8)
         ELSE left(regexp_replace(split_part(cu.phone_whatsapp, '_', 1), '\D', '', 'g'), 2)
              || right(regexp_replace(split_part(cu.phone_whatsapp, '_', 1), '\D', '', 'g'), 8)
       END = a.chave
  LEFT JOIN public.voice_dnc_list d
    ON d.consultant_id = a.consultant_id
   AND right(regexp_replace(d.phone, '\D', '', 'g'), 8) = right(a.chave, 8)
  GROUP BY a.chave
)
SELECT
  count(*)                                                          AS total_numeros,
  count(*) FILTER (
    WHERE tem_cadastro AND todos_dnc AND todos_pausados
      AND pausa_permanente AND tem_dnc_voz
  )                                                                 AS bloqueados_ok,
  count(*) FILTER (WHERE NOT tem_cadastro)                          AS furo_sem_cadastro,
  count(*) FILTER (WHERE tem_cadastro AND NOT todos_dnc)            AS furo_falta_dnc,
  count(*) FILTER (WHERE tem_cadastro AND NOT todos_pausados)       AS furo_falta_pausa,
  count(*) FILTER (WHERE tem_cadastro AND todos_pausados
                     AND NOT pausa_permanente)                      AS furo_pausa_expiravel,
  count(*) FILTER (WHERE NOT tem_dnc_voz)                           AS furo_sms_voz_liberado
FROM situacao;


-- ============================================================================
-- SE QUALQUER FURO VIER > 0: esta segunda query lista QUEM ficou de fora.
-- ============================================================================
WITH alvos AS (
  SELECT c.consultant_id,
         CASE WHEN length(n.nat) >= 10 THEN left(n.nat, 2) || right(n.nat, 8) END AS chave,
         min(t.phone)  AS phone_exemplo,
         min(t.status) AS status_no_disparo
  FROM public.bulk_campaign_targets t
  JOIN public.bulk_campaigns c ON c.id = t.campaign_id
  CROSS JOIN LATERAL (
    SELECT regexp_replace(split_part(t.phone, '_', 1), '\D', '', 'g') AS d
  ) AS x
  CROSS JOIN LATERAL (
    SELECT CASE WHEN length(x.d) > 11 AND left(x.d, 2) = '55'
                THEN substr(x.d, 3) ELSE x.d END AS nat
  ) AS n
  WHERE c.created_at >= '2026-08-04 00:00:00-03'
    AND c.created_at <  '2026-08-05 00:00:00-03'
    AND length(n.nat) >= 10
  GROUP BY c.consultant_id,
           CASE WHEN length(n.nat) >= 10 THEN left(n.nat, 2) || right(n.nat, 8) END
)
SELECT a.phone_exemplo,
       a.status_no_disparo,
       cu.id   AS customer_id,
       cu.name,
       cu.do_not_contact,
       cu.bot_paused,
       cu.bot_paused_reason,
       (d.phone IS NOT NULL) AS no_dnc_voz,
       CASE
         WHEN cu.id IS NULL THEN 'sem cadastro em customers'
         WHEN cu.do_not_contact IS NOT TRUE THEN 'falta do_not_contact'
         WHEN cu.bot_paused IS NOT TRUE THEN 'falta bot_paused'
         WHEN lower(coalesce(cu.bot_paused_reason, ''))
              NOT IN ('requested','opt_out','complaint') THEN 'pausa expira em 48h'
         ELSE 'SMS/voz liberado (fora do voice_dnc_list)'
       END AS problema
FROM alvos a
LEFT JOIN public.customers cu
  ON cu.consultant_id = a.consultant_id
 AND CASE
       WHEN length(regexp_replace(split_part(cu.phone_whatsapp, '_', 1), '\D', '', 'g')) > 11
            AND left(regexp_replace(split_part(cu.phone_whatsapp, '_', 1), '\D', '', 'g'), 2) = '55'
       THEN left(substr(regexp_replace(split_part(cu.phone_whatsapp, '_', 1), '\D', '', 'g'), 3), 2)
            || right(substr(regexp_replace(split_part(cu.phone_whatsapp, '_', 1), '\D', '', 'g'), 3), 8)
       ELSE left(regexp_replace(split_part(cu.phone_whatsapp, '_', 1), '\D', '', 'g'), 2)
            || right(regexp_replace(split_part(cu.phone_whatsapp, '_', 1), '\D', '', 'g'), 8)
     END = a.chave
LEFT JOIN public.voice_dnc_list d
  ON d.consultant_id = a.consultant_id
 AND right(regexp_replace(d.phone, '\D', '', 'g'), 8) = right(a.chave, 8)
WHERE cu.id IS NULL
   OR cu.do_not_contact IS NOT TRUE
   OR cu.bot_paused IS NOT TRUE
   OR lower(coalesce(cu.bot_paused_reason, '')) NOT IN ('requested','opt_out','complaint')
   OR d.phone IS NULL
ORDER BY problema, a.phone_exemplo;
