-- Limpeza da Central de Agendamentos: remove crons duplicados e órfãos.
--
-- Decisões aprovadas pelo usuário:
--   1) ai-followup-cron-15min: endpoint não existe mais no repo → 404 a cada 15min. Remover.
--   2) instance-health-cron (sem sufixo): duplicata do instance-health-cron-10min (mesmo endpoint, mesma cadência). Remover o sem sufixo.
--   3) cleanup-webhook-dedupe: aponta para tabela inexistente (a real é webhook_message_dedup, sem 'e' final). Remover.
--   4) facebook-creative-rotator-12h: usuário escolheu manter apenas o rotator diário (-daily às 08h). Remover o de 12h.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-followup-cron-15min') THEN
    PERFORM cron.unschedule('ai-followup-cron-15min');
    RAISE NOTICE 'Removido cron órfão: ai-followup-cron-15min';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'instance-health-cron') THEN
    PERFORM cron.unschedule('instance-health-cron');
    RAISE NOTICE 'Removido cron duplicado: instance-health-cron (mantém instance-health-cron-10min)';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-webhook-dedupe') THEN
    PERFORM cron.unschedule('cleanup-webhook-dedupe');
    RAISE NOTICE 'Removido cron de tabela inexistente: cleanup-webhook-dedupe';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'facebook-creative-rotator-12h') THEN
    PERFORM cron.unschedule('facebook-creative-rotator-12h');
    RAISE NOTICE 'Removido rotator duplicado: facebook-creative-rotator-12h (mantém -daily)';
  END IF;
END
$$;