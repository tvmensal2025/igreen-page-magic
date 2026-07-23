
-- PAUSA DE EMERGÊNCIA — consultor Rafael Ferreira Dias
-- Bug reportado: mensagens saindo assinadas como "Abel" / "Janete".
-- Bloqueia todo envio automático até auditoria concluir.
UPDATE public.customers
SET bot_paused = true,
    bot_paused_reason = 'consultor_hold_wrong_name_2026_07_23',
    bot_paused_at = now()
WHERE consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
  AND (bot_paused IS NOT TRUE);
