-- Pós-venda: áudio estático (legacy_*.ogg / aprovado_*.ogg) NÃO tem
-- {{nome}} nem {{saudacao}} (Muito bom dia/tarde/noite).
-- Zera media_url para o sender gerar TTS ElevenLabs do roteiro personalizado.
-- Imagem permanece; texto (roteiro) permanece.

UPDATE public.pos_venda_default_media
SET media_url = NULL,
    updated_at = now()
WHERE message_text ~* '\{\{\s*(nome|saudacao)\s*\}\}'
  AND media_url IS NOT NULL;

UPDATE public.stage_auto_messages sam
SET media_url = NULL
FROM public.kanban_stages ks
WHERE sam.stage_id = ks.id
  AND ks.stage_scope = 'pos_venda'
  AND sam.message_text ~* '\{\{\s*(nome|saudacao)\s*\}\}'
  AND sam.media_url IS NOT NULL;

UPDATE public.kanban_stages
SET auto_message_media_url = NULL
WHERE stage_scope = 'pos_venda'
  AND auto_message_text ~* '\{\{\s*(nome|saudacao)\s*\}\}'
  AND auto_message_media_url IS NOT NULL;
