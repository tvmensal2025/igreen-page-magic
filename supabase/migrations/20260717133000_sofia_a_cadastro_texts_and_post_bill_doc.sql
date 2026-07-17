-- Sofia Grupo A: textos cadastro (emoji + negrito + espaço) e roteamento pós-conta → doc.
-- Consultor Rafael · fluxo variant A.

UPDATE bot_flow_steps bfs
SET message_text = v.body,
    updated_at = now()
FROM bot_flows bf,
(VALUES
  ('a5b_after_club_buttons', E'📋 *{{nome}}*, vamos ativar seu benefício?\n\nToque em *Cadastrar* para continuar 👇'),
  ('a6_ask_bill_photo', E'✅ *Perfeito, {{nome}}!*\n\n📸 *Agora me envie a foto da sua conta de luz*\n\n• Página com o *valor* e os *dados da unidade*\n• Foto *nítida*, sem reflexos\n• Pode ser a fatura mais recente\n\nAssim valido tudo automaticamente e seguimos com a ativação 💚'),
  ('a7_ask_document', E'📄 *Próximo passo, {{nome}}!*\n\nMe envie a foto do seu *documento com foto*:\n\n🪪 *CNH* → só a *frente*\n\n🆔 *RG* → *frente e verso* (obrigatório)\n\nPreciso das fotos *nítidas* para continuar seu cadastro ✅'),
  ('a8_ask_email', E'📧 *{{nome}}*, qual é o seu *e-mail*?\n\nÉ por ele que você acessa o app *iGreen Club* 📱\n\n_(cashback, faturas e indicações)_'),
  ('a9_confirm_phone', E'📱 *{{nome}}*, só confirmar:\n\nO telefone deste WhatsApp é o melhor para contato?\n\n*Número:* {{telefone}}'),
  ('a10_portal_otp_facial', E'🎉 *Pronto, {{nome}}!*\n\nJá temos todos os dados ✅\n\nVou enviar seu cadastro ao portal agora.\n\n📲 Em seguida você recebe um *código OTP* — digite aqui no WhatsApp 👇\n\n_(O link da validação facial só vem *depois* do OTP correto.)_'),
  ('a11_facial_link', E'✅ *OTP confirmado, {{nome}}!*\n\nÚltimo passo — abra o *link* 👇\n\n{{link_facial}}\n\nToque em *Assinar documentos* e faça a *validação facial* para comprovar que é você 🪪')
) AS v(step_key, body)
WHERE bf.id = bfs.flow_id
  AND bf.consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
  AND bf.variant = 'A'
  AND bfs.step_key = v.step_key
  AND bfs.is_active = true;

-- Pós-conta: success_goto explícito → documento (nunca a3 economia).
UPDATE bot_flow_steps bfs
SET fallback = COALESCE(bfs.fallback, '{}'::jsonb) || jsonb_build_object(
      'success_goto_step_id', doc.id::text,
      'mode', 'goto',
      'goto_step_id', doc.id::text
    ),
    updated_at = now()
FROM bot_flows bf,
     bot_flow_steps doc
WHERE bf.id = bfs.flow_id
  AND bf.consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
  AND bf.variant = 'A'
  AND bfs.step_key = 'a6_ask_bill_photo'
  AND bfs.is_active = true
  AND doc.flow_id = bf.id
  AND doc.step_key = 'a7_ask_document'
  AND doc.is_active = true;
