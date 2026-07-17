-- intro:nome:ptbr (v1 legado) — mesmo risco de sotaque errado; motor usa só ptbr3.
UPDATE ai_media_library
SET active = false,
    updated_at = now()
WHERE slot_key ~ '^intro:nome:ptbr:[^3]'
  AND active = true;
