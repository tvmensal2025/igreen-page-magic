-- Inclui {{saudacao}} (Muito bom dia/tarde/noite) após Olá {{nome}} nos textos
-- que ainda abriam só com "Tudo bem?". Áudio de abertura Olá+nome+tudo bem já existe.

UPDATE public.pos_venda_default_media
SET
  message_text = replace(
    message_text,
    E'Olá, {{nome}}.\n\nTudo bem?',
    E'Olá, {{nome}}.\n\n{{saudacao}}.\n\nTudo bem?'
  ),
  updated_at = now()
WHERE message_text LIKE E'Olá, {{nome}}.\n\nTudo bem%'
  AND message_text NOT LIKE '%{{saudacao}}%';

UPDATE public.stage_auto_messages sam
SET message_text = replace(
  sam.message_text,
  E'Olá, {{nome}}.\n\nTudo bem?',
  E'Olá, {{nome}}.\n\n{{saudacao}}.\n\nTudo bem?'
)
FROM public.kanban_stages ks
WHERE sam.stage_id = ks.id
  AND ks.stage_scope = 'pos_venda'
  AND sam.message_text LIKE E'Olá, {{nome}}.\n\nTudo bem%'
  AND sam.message_text NOT LIKE '%{{saudacao}}%';
