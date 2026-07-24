-- Retentativa: texto menciona botão (Whapi) E número 1 (Evolution sem botão).
-- O sendChoice em pos-venda-auto-progress já renderiza botão ou *1.* conforme o canal.

UPDATE public.pos_venda_default_media
SET
  message_text = $txt$Olá, {{nome}} Tudo bem?

{{saudacao}}

Há cerca de 60 dias o seu cadastro na iGreen não pôde ser aprovado.

Como combinamos, estamos de volta para oferecer uma nova chance de análise.

Se você quiser tentar novamente, toque no botão *Quero tentar de novo* ou responda *1*. Nossa equipe te guia no cadastro passo a passo.

Pode contar com a gente.$txt$,
  updated_at = now()
WHERE stage = 'retentativa';

-- Propaga para stage_auto_messages de todos os consultores (retentativa).
UPDATE public.stage_auto_messages sam
SET message_text = def.message_text
FROM public.pos_venda_default_media def
JOIN public.kanban_stages ks
  ON ks.stage_key = 'pv_retentativa'
 AND ks.stage_scope = 'pos_venda'
WHERE def.stage = 'retentativa'
  AND sam.stage_id = ks.id
  AND sam.consultant_id = ks.consultant_id;

UPDATE public.kanban_stages ks
SET auto_message_text = def.message_text
FROM public.pos_venda_default_media def
WHERE def.stage = 'retentativa'
  AND ks.stage_key = 'pv_retentativa'
  AND ks.stage_scope = 'pos_venda';
