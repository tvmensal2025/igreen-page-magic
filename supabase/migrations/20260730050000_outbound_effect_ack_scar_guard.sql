-- Cicatriz do retry infinito: efeitos "sent" com attempt_count alto.
-- NÃO muda status (mensagem pode ter ido). Só marca error_code para auditoria
-- e para o cadence-tick (fail-closed no ACK) não reabrir cegamente.

UPDATE public.outbound_effects
   SET error_code = COALESCE(NULLIF(error_code, ''), 'scar_high_attempts_no_reopen'),
       updated_at = now()
 WHERE status = 'sent'
   AND attempt_count >= 5
   AND (error_code IS NULL OR error_code = '');

COMMENT ON TABLE public.outbound_effects IS
  'Efeitos outbound idempotentes. Retomada: failed_retryable<5, released<15. '
  'ACK reopen fail-closed. sent+attempt alto = cicatriz (não reabrir).';
