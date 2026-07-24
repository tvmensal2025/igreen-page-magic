-- Abertura canônica alinhada ao áudio ola_greet: "Olá, {{nome}} Tudo bem?" juntos,
-- depois {{saudacao}} (Muito bom dia/tarde/noite) em linha própria.

UPDATE public.pos_venda_default_media
SET
  message_text = replace(
    message_text,
    E'Olá, {{nome}}.\n\n{{saudacao}}.\n\nTudo bem?\n\n',
    E'Olá, {{nome}} Tudo bem?\n\n{{saudacao}}\n\n'
  ),
  updated_at = now()
WHERE message_text LIKE E'Olá, {{nome}}.\n\n{{saudacao}}.\n\nTudo bem?%';

UPDATE public.pos_venda_default_media
SET
  message_text = replace(
    message_text,
    E'Olá, {{nome}}.\n\n{{saudacao}}.\n\n',
    E'Olá, {{nome}} Tudo bem?\n\n{{saudacao}}\n\n'
  ),
  updated_at = now()
WHERE stage = 'aprovado'
  AND message_text LIKE E'Olá, {{nome}}.\n\n{{saudacao}}.%'
  AND message_text NOT LIKE E'Olá, {{nome}} Tudo bem?%';

UPDATE public.stage_auto_messages sam
SET message_text = replace(
  sam.message_text,
  E'Olá, {{nome}}.\n\n{{saudacao}}.\n\nTudo bem?\n\n',
  E'Olá, {{nome}} Tudo bem?\n\n{{saudacao}}\n\n'
)
FROM public.kanban_stages ks
WHERE sam.stage_id = ks.id
  AND ks.stage_scope = 'pos_venda'
  AND sam.message_text LIKE E'Olá, {{nome}}.\n\n{{saudacao}}.\n\nTudo bem?%';

UPDATE public.stage_auto_messages sam
SET message_text = replace(
  sam.message_text,
  E'Olá, {{nome}}.\n\n{{saudacao}}.\n\n',
  E'Olá, {{nome}} Tudo bem?\n\n{{saudacao}}\n\n'
)
FROM public.kanban_stages ks
WHERE sam.stage_id = ks.id
  AND ks.stage_scope = 'pos_venda'
  AND ks.stage_key = 'pv_aprovado'
  AND sam.message_text LIKE E'Olá, {{nome}}.\n\n{{saudacao}}.%'
  AND sam.message_text NOT LIKE E'Olá, {{nome}} Tudo bem?%';
