-- Reativa biblioteca Sofia legada (intros + stitches) sem regenerar TTS.
-- Rafael: 560+ nomes ptbr2, 199 olás, 203 stitches A2 estavam inativos.

UPDATE ai_media_library AS ola
SET active = true, updated_at = NOW()
WHERE consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
  AND slot_key ~ '^intro:ola:(?!ptbr2:).+$'
  AND active = false
  AND NOT EXISTS (
    SELECT 1 FROM ai_media_library x
    WHERE x.consultant_id = ola.consultant_id
      AND x.slot_key = 'intro:ola:ptbr2:' || regexp_replace(ola.slot_key, '^intro:ola:', '')
      AND x.active = true
  );

UPDATE ai_media_library AS nome
SET active = true, updated_at = NOW()
WHERE consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
  AND slot_key ~ '^intro:nome:(?!ptbr2:).+$'
  AND active = false
  AND NOT EXISTS (
    SELECT 1 FROM ai_media_library x
    WHERE x.consultant_id = nome.consultant_id
      AND x.slot_key = 'intro:nome:ptbr2:' || regexp_replace(nome.slot_key, '^intro:nome:', '')
      AND x.active = true
  );

UPDATE ai_media_library
SET active = true, updated_at = NOW()
WHERE consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
  AND slot_key LIKE 'stitch:a2_audio_activate_name:%'
  AND active = false
  AND slot_key !~ ':ola3:';
