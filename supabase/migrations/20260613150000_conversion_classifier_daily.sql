-- Conversão: troca o cron de classificação de 15 min por um diário leve.
--
-- Motivo: a temperatura (lead_insights) só é consumida quando o consultor abre
-- a Central de Conversão; nada lê em background (a reativação é manual). Rodar
-- a classificação a cada 15 min em todos os consultores é trabalho ocioso quando
-- ninguém está olhando.
--
-- Nova estratégia (sob demanda):
--   • Abertura da Central → classifica top 25 por prioridade (ConversaoCockpit).
--   • Envio de reaquecimento → classifica o lead na hora, se necessário.
--   • Este cron diário → rede de segurança para não acumular fila grande de
--     needs_reclassify entre aberturas. Caminho de regras custa 0 tokens.
--
-- O scope needs_reclassify_global agora filtra customer_origin != 'igreen_sync'
-- no próprio classifier (inner join), então o cron não repesca carteira.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove o cron antigo de 15 min.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'conversion-classifier-15min') THEN
    PERFORM cron.unschedule('conversion-classifier-15min');
  END IF;
END $$;

-- Remove o diário se já existir (idempotente em re-run).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'conversion-classifier-daily') THEN
    PERFORM cron.unschedule('conversion-classifier-daily');
  END IF;
END $$;

-- Cron diário leve às 06:00 UTC (03:00 BRT) — fora do horário comercial,
-- só esvazia a fila de needs_reclassify acumulada. Lote pequeno (limit 200).
SELECT cron.schedule(
  'conversion-classifier-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/lead-temperature-classifier',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body := '{"scope":"needs_reclassify_global","limit":200}'::jsonb
  ) AS request_id;
  $$
);
