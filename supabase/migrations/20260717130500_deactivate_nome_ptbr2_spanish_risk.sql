-- intro:nome:ptbr2 = TTS bare-name (eleven_v3) — alguns nomes saíam em espanhol.
-- Motor agora usa intro:nome:ptbr3 (v2 + contexto PT). Desativa ptbr2 para forçar regen.
-- Stitches n4 com nome ptbr2 também ficam obsoletos (motor usa n5).

UPDATE ai_media_library
SET active = false,
    updated_at = now()
WHERE slot_key ~ '^intro:nome:ptbr2:.+$'
  AND active = true;

UPDATE ai_media_library
SET active = false,
    updated_at = now()
WHERE slot_key ~ '^stitch:(a3_explain_with_buttons|a5_audio_club_benefits):n4:.+$'
  AND active = true;
