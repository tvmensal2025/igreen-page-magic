-- Corrige a2_text_ask_bill_value: message_text vazio fazia o WhatsApp
-- enviar só o áudio e NÃO o texto pedindo o valor da conta.
-- Caso real: lead 5511971254913 (Felipe/Lucas) — áudio A2 ok, texto ausente.

UPDATE bot_flow_steps
SET message_text = E'{{nome}}, conseguimos ativar o seu benefício!\n\nPara eu calcular a economia, me diga *quanto você paga por mês* na conta de energia.\n\nPode ser só o número — por exemplo: 350 ou 850,00.',
    updated_at = now()
WHERE step_key = 'a2_text_ask_bill_value'
  AND is_active = true
  AND (message_text IS NULL OR btrim(message_text) = '');

-- Garante media_order áudio → texto (pedido de valor depois do áudio).
UPDATE bot_flow_steps
SET media_order = '["audio","text"]'::jsonb,
    updated_at = now()
WHERE step_key = 'a2_text_ask_bill_value'
  AND is_active = true
  AND (
    media_order IS NULL
    OR media_order::text = '[]'
    OR NOT (media_order @> '["audio"]'::jsonb AND media_order @> '["text"]'::jsonb)
  );
