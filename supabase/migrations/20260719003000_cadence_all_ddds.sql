-- ============================================================================
-- Expansão do piloto: cadência liberada para TODOS os DDDs válidos do Brasil.
-- Mantém mode='enforced' (em vez de 'off') de propósito: telefone inválido /
-- DDD inexistente continua bloqueado com motivo (invalid_phone), sem descartar
-- o lead — que era a única função restante do filtro.
-- Rollback lógico: voltar cadence_allowed_ddds para '["34"]'.
-- ============================================================================

UPDATE public.app_settings
   SET cadence_audience_mode = 'enforced',
       cadence_allowed_ddds = '[
         "11","12","13","14","15","16","17","18","19",
         "21","22","24","27","28",
         "31","32","33","34","35","37","38",
         "41","42","43","44","45","46","47","48","49",
         "51","53","54","55",
         "61","62","63","64","65","66","67","68","69",
         "71","73","74","75","77","79",
         "81","82","83","84","85","86","87","88","89",
         "91","92","93","94","95","96","97","98","99"
       ]'::jsonb
 WHERE id = 'global';
