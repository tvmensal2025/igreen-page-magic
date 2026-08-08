-- Grupo A: espera 6 dias (144h) de silêncio antes da 1ª cutucada (A_NUDGE).
-- Escada A_SMS / A_CALL / A_CALL_RETRY e onda B/C inalteradas.
-- Não reescreve lead_cadence_state em voo — só novas agendas usam 144h.

UPDATE public.cadence_stage_config
SET
  delay_hours = 144,
  updated_at = now()
WHERE stage = 'A_NUDGE';
