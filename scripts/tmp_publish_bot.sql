-- BLOQUEADO (2026-07-19): este SQL republicava o catálogo CURTO e sobrescreveu o save validado.
-- NÃO EXECUTAR. Use o painel Multicanal (publish da biblioteca ativa d2d5e712) ou um export fresco.
DO $$ BEGIN
  RAISE EXCEPTION 'tmp_publish bloqueado: NÃO republicar catálogo curto (incidente 2026-07-19). Biblioteca ativa deve permanecer o save validado.';
END $$;
-- Corpo original abaixo (inócuo após o RAISE):
BEGIN;
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad1$*Olá!* Para agilizar seu atendimento, informe seu *primeiro nome*.$cad1$ WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a1_ask_name';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad2$Olá, *{{nome}}*!

Conseguimos ativar o seu benefício!

Para eu calcular a economia, me diga *quanto você paga por mês* na conta de energia.

Pode ser só o número — por exemplo: 350 ou 850,00.$cad2$ WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a2_text_ask_bill_value';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad3$Perfeito, *{{nome}}*!

Com base no valor de *R$ {{valor_conta}}*, hoje você consegue economizar de *8% a 20%* todos os meses — cerca de *{{economia_range}}*.

*O que você prefere agora*?$cad3$, captures = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(COALESCE(captures, '[]'::jsonb)) e WHERE e->>'field' IS DISTINCT FROM '_buttons'), '[]'::jsonb) || jsonb_build_array(jsonb_build_object('field','_buttons','enabled',true,'value', $cad4$[{"id": "more_benefits", "title": "Saber mais benefício"}, {"id": "activate", "title": "Quero ativar"}, {"id": "human", "title": "Falar com humano"}]$cad4$::jsonb)) WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a3_explain_with_buttons';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad5$Olá, *{{nome}}*!

📋 Vamos ativar seu benefício?

Toque em *Cadastrar* para continuar 👇$cad5$, captures = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(COALESCE(captures, '[]'::jsonb)) e WHERE e->>'field' IS DISTINCT FROM '_buttons'), '[]'::jsonb) || jsonb_build_array(jsonb_build_object('field','_buttons','enabled',true,'value', $cad6$[{"id": "register", "title": "Cadastrar"}, {"id": "human", "title": "Falar com humano"}]$cad6$::jsonb)) WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a5b_after_club_buttons';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad7$✅ *Perfeito, {{nome}}!*

📸 *Agora me envie a foto da sua conta de luz*

• Página com o *valor* e os *dados da unidade*
• Foto *nítida*, sem reflexos
• Pode ser a fatura mais recente

Assim valido tudo automaticamente e seguimos com a ativação 💚$cad7$ WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a6_ask_bill_photo';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad8$Olá, *{{nome}}*!

📄 *Próximo passo!*

Me envie a foto do seu *documento com foto*:

🪪 *CNH* → só a *frente*

🆔 *RG* → *frente e verso* (obrigatório)

Preciso das fotos *nítidas* para continuar seu cadastro ✅$cad8$ WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a7_ask_document';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad9$Olá, *{{nome}}*!

📧 Qual é o seu *e-mail*?

É por ele que você acessa o app *iGreen Club* 📱

_(cashback, faturas e indicações)_$cad9$ WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a8_ask_email';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad10$Olá, *{{nome}}*!

📱 Só confirmar:

O telefone deste WhatsApp é o melhor para contato?

*Número:* {{telefone}}$cad10$, captures = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(COALESCE(captures, '[]'::jsonb)) e WHERE e->>'field' IS DISTINCT FROM '_buttons'), '[]'::jsonb) || jsonb_build_array(jsonb_build_object('field','_buttons','enabled',true,'value', $cad11$[{"id": "phone_ok", "title": "Sim, este número"}, {"id": "phone_other", "title": "Quero outro"}, {"id": "human", "title": "Falar com humano"}]$cad11$::jsonb)) WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a9_confirm_phone';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad12$Olá, *{{nome}}*!

🎉 *Pronto!*

Já temos todos os dados ✅

Vou enviar seu cadastro ao portal agora.

📲 Em seguida você recebe um *código OTP* — digite aqui no WhatsApp 👇

_(O link da validação facial só vem *depois* do OTP correto.)_$cad12$ WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a10_portal_otp_facial';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad13$Olá, *{{nome}}*!

✅ *OTP confirmado!*

Último passo — abra o *link* 👇

{{link_facial}}

Toque em *Assinar documentos* e faça a *validação facial* para comprovar que é você 🪪$cad13$ WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a11_facial_link';
UPDATE bot_flow_steps SET updated_at = now(), message_text = $cad14$Olá, *{{nome}}*!

Combinado.

Vou transferir você para um atendente da equipe do Rafael. Em instantes alguém assume a conversa por aqui.$cad14$ WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a_human_handoff';
UPDATE bot_flow_steps SET fallback = COALESCE(fallback, '{}'::jsonb) || jsonb_build_object('mode','retry','max_retries',2,'then','humano','retry_text', $cad15$⚠️ Não consegui ler a conta. Por favor, envie uma *foto mais nítida e bem iluminada* (sem reflexos).

Dicas:
• Use boa iluminação
• Evite reflexos
• Foque nos dados principais$cad15$), updated_at = now() WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a6_ask_bill_photo';
UPDATE bot_flow_steps SET fallback = COALESCE(fallback, '{}'::jsonb) || jsonb_build_object('mode','retry','max_retries',2,'then','humano','retry_text', $cad16$⚠️ Não consegui ler o documento. Envie uma foto mais nítida do *VERSO* (ou da frente, se for CNH).

Dicas:
• Boa iluminação, sem reflexo
• Texto legível (nome, CPF, RG)$cad16$), updated_at = now() WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND step_key = 'a7_ask_document';
COMMIT;