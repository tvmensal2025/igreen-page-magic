-- ============================================================================
-- Recriação do Fluxo A (Rafael) — funil de alta conversão, áudio/texto
-- ============================================================================
-- flow_id = 66a19db4-b061-4f3f-921f-c13e9fb6f730 (superadmin 0c2711ad…)
--
-- Objetivos:
--   1. Persona Rafael (alinha com o áudio de boas-vindas "me chamo Rafael").
--   2. Boas-vindas capta NOME (áudio pergunta o nome).
--   3. "Como funciona" (áudio 2min) encadeado com fazenda_solar (continuação).
--   4. Passo de SIMULAÇÃO personalizada em texto usando {{economia_anual}}.
--   5. CTA forte de cadastro.
--   6. Paridade de captura com o Fluxo D: conta → documento → EMAIL → TELEFONE → finalizar.
--
-- IDs existentes (preservados):
--   welcome           = 6226f6f3-e655-4cc9-af20-d8c28c998160  (slot boas_vindas)
--   ask_valor         = 3e7fb4cd-33a7-4854-aec7-4570b04456e9
--   como_funciona     = 80188e5f-0c6d-4883-b058-0708efddc056  (slot como_funciona)
--   fazenda_solar     = a71ba814-e6c2-48aa-bc16-0094e812bc15  (slot fazenda_solar)
--   simulacao/cta     = 559b8f1b-0630-45b5-aeae-b96cb4d20e9a
--   conta             = 5b318e95-863b-43b8-96b2-d4f55bb9619c  (capture_conta)
--   documento         = bd0fd2f0-a1f1-4b02-bf35-f129d323f4b1  (capture_documento)
--   finalizar         = 4735aef1-72f0-4a27-8862-61fb9647dae2  (finalizar_cadastro)
--
-- Passos novos (UUID fixos p/ idempotência):
--   email             = a1f0e001-aaaa-4a01-9a01-f100d00a0001  (capture_email)
--   telefone          = a1f0e002-aaaa-4a02-9a02-f100d00a0002  (confirm_phone)
--
-- Também desativa o passo órfão passo_mp8yc0bp (pos 2) e o trailing passo_mpomcess.
-- Idempotente: UPDATEs por id + INSERT … ON CONFLICT (id) DO UPDATE.

DO $$
DECLARE
  v_flow   uuid := '66a19db4-b061-4f3f-921f-c13e9fb6f730';
  v_welcome uuid := '6226f6f3-e655-4cc9-af20-d8c28c998160';
  v_valor   uuid := '3e7fb4cd-33a7-4854-aec7-4570b04456e9';
  v_como    uuid := '80188e5f-0c6d-4883-b058-0708efddc056';
  v_fazenda uuid := 'a71ba814-e6c2-48aa-bc16-0094e812bc15';
  v_sim     uuid := '559b8f1b-0630-45b5-aeae-b96cb4d20e9a';
  v_conta   uuid := '5b318e95-863b-43b8-96b2-d4f55bb9619c';
  v_doc     uuid := 'bd0fd2f0-a1f1-4b02-bf35-f129d323f4b1';
  v_email   uuid := 'a1f0e001-aaaa-4a01-9a01-f100d00a0001';
  v_tel     uuid := 'a1f0e002-aaaa-4a02-9a02-f100d00a0002';
  v_final   uuid := '4735aef1-72f0-4a27-8862-61fb9647dae2';
BEGIN

-- ── Evita colisão com unique(flow_id, position): joga todas as posições do
--    fluxo para um range temporário alto antes de reatribuir. ──────────────
UPDATE bot_flow_steps SET position = position + 1000
 WHERE flow_id = v_flow;

-- ── Passo 1 (pos 2 órfão): desativa ─────────────────────────────────────────
UPDATE bot_flow_steps SET is_active = false
 WHERE flow_id = v_flow AND id = '33be68c1-44b6-4de1-8a1c-aa3758c4cdfa';

-- ── Passo trailing vazio: desativa ──────────────────────────────────────────
UPDATE bot_flow_steps SET is_active = false
 WHERE flow_id = v_flow AND id = '8a091be7-abc5-479a-b489-8bfaf1668a49';

-- ── Passo legado "deu pra entender?" (slot passo_mpagqq3g): desativa ─────────
UPDATE bot_flow_steps SET is_active = false
 WHERE flow_id = v_flow AND id = 'bdc7ebb3-db54-446d-89d0-157db0dfe925';

-- ── 1) WELCOME — áudio do Rafael + capta nome ───────────────────────────────
UPDATE bot_flow_steps SET
  position = 1,
  step_type = 'message',
  wait_for = 'reply',
  message_text = E'Opa! Aqui é o *Rafael*, da iGreen Energy ⚡\n\nVou te ajudar a *reduzir sua conta de luz em até 20%* — sem obra, sem instalação e sem trocar de distribuidora.\n\nComo posso te chamar? 😊',
  captures = '[{"field":"name","enabled":true}]'::jsonb,
  transitions = ('[{"goto_special": null, "goto_step_id": "' || v_valor || '", "trigger_intent": "default", "trigger_phrases": []}]')::jsonb,
  fallback = ('{"mode":"goto","goto_step_id":"' || v_valor || '"}')::jsonb,
  media_order = '["text","audio","video","image"]'::jsonb
 WHERE flow_id = v_flow AND id = v_welcome;

-- ── 2) ASK VALOR — pergunta valor da conta ──────────────────────────────────
UPDATE bot_flow_steps SET
  position = 2,
  step_type = 'message',
  wait_for = 'reply',
  slot_key = NULL,
  message_text = E'Prazer, *{{nome}}*! 🙌\n\nMe conta uma coisa: qual o *valor médio* da sua conta de luz hoje?\n\n(pode mandar só o número, ex.: *350*)',
  captures = '[{"field":"electricity_bill_value","enabled":true}]'::jsonb,
  transitions = ('[{"goto_special": null, "goto_step_id": "' || v_como || '", "trigger_intent": "default", "trigger_phrases": []}]')::jsonb,
  fallback = ('{"mode":"goto","goto_step_id":"' || v_como || '"}')::jsonb,
  media_order = '["text","audio","video","image"]'::jsonb
 WHERE flow_id = v_flow AND id = v_valor;

-- ── 3) COMO FUNCIONA — texto curto + áudio 2min (slot como_funciona) ────────
UPDATE bot_flow_steps SET
  position = 3,
  step_type = 'message',
  wait_for = 'none',
  slot_key = 'como_funciona',
  message_text = E'Show, {{nome}}! Te explico rapidinho como a gente consegue esse desconto 👇\n\n🎧 Manda esse áudio aqui de baixo (é curtinho).',
  transitions = ('[{"goto_special": null, "goto_step_id": "' || v_fazenda || '", "trigger_intent": "default", "trigger_phrases": []}]')::jsonb,
  fallback = ('{"mode":"goto","goto_step_id":"' || v_fazenda || '"}')::jsonb,
  media_order = '["text","audio","video","image"]'::jsonb
 WHERE flow_id = v_flow AND id = v_como;

-- ── 4) FAZENDA SOLAR — continuação do como funciona (slot fazenda_solar) ────
UPDATE bot_flow_steps SET
  position = 4,
  step_type = 'message',
  wait_for = 'none',
  slot_key = 'fazenda_solar',
  message_text = E'E pra você ver que é coisa séria 👇',
  transitions = ('[{"goto_special": null, "goto_step_id": "' || v_sim || '", "trigger_intent": "default", "trigger_phrases": []}]')::jsonb,
  fallback = ('{"mode":"goto","goto_step_id":"' || v_sim || '"}')::jsonb,
  media_order = '["text","audio","video","image"]'::jsonb
 WHERE flow_id = v_flow AND id = v_fazenda;

-- ── 5) SIMULAÇÃO + CTA — economia personalizada e fechamento ────────────────
UPDATE bot_flow_steps SET
  position = 5,
  step_type = 'message',
  wait_for = 'reply',
  slot_key = NULL,
  text_delay_ms = 2500,
  message_text = E'Olha só, {{nome}} 👀\n\nNa sua conta de *{{valor_conta}}*, você economiza cerca de *{{economia_mensal}} por mês* — isso dá quase *{{economia_anual}} por ano* no seu bolso! 💸\n\nO cadastro é *gratuito*, 100% online e leva uns 2 minutinhos. Bora garantir seu desconto?',
  captures = '[{"kind":"text","name":"resposta_cta","enabled":true,"required":false}]'::jsonb,
  transitions = ('[
    {"goto_special": null, "goto_step_id": "' || v_conta || '", "trigger_intent": "afirmacao", "trigger_phrases": ["sim","quero","bora","vamos","pode","claro","ok","beleza","cadastrar","quero cadastrar"]},
    {"goto_special": null, "goto_step_id": "' || v_conta || '", "trigger_intent": "default", "trigger_phrases": []}
  ]')::jsonb,
  fallback = ('{"mode":"goto","goto_step_id":"' || v_conta || '"}')::jsonb,
  media_order = '["text","audio","video","image"]'::jsonb
 WHERE flow_id = v_flow AND id = v_sim;

-- ── 6) CONTA DE LUZ (capture_conta) ─────────────────────────────────────────
UPDATE bot_flow_steps SET
  position = 6,
  step_type = 'capture_conta',
  wait_for = 'none',
  message_text = E'Perfeito, {{nome}}! 📸\n\nMe manda uma *foto* (ou PDF) da sua *conta de luz* aqui pelo WhatsApp. É com ela que eu confirmo seu desconto.',
  captures = '[{"kind":"media","name":"imagem_conta","accepts":["image","document"],"required":true,"retry_text":"Me manda a foto ou PDF da sua conta de luz mesmo, por aqui pelo WhatsApp 📄😊"}]'::jsonb,
  transitions = ('[{"goto_special": null, "goto_step_id": "' || v_doc || '", "trigger_intent": "default", "trigger_phrases": []}]')::jsonb,
  fallback = ('{"mode":"retry","on_fail":"handoff","max_retries":2,"handoff_reason":"no_media_received","success_goto_step_id":"' || v_doc || '"}')::jsonb,
  media_order = '["text","audio","video","image"]'::jsonb
 WHERE flow_id = v_flow AND id = v_conta;

-- ── 7) DOCUMENTO (capture_documento) → vai para EMAIL ───────────────────────
UPDATE bot_flow_steps SET
  position = 7,
  step_type = 'capture_documento',
  wait_for = 'none',
  message_text = E'Maravilha! 🪪\n\nAgora me envia uma foto do seu *documento* (RG ou CNH). É exigência da ANEEL pra cadastrar você como titular — vai direto pra plataforma segura da iGreen.',
  captures = '[{"kind":"media","name":"documento_cliente","accepts":["image","document"],"required":true,"auto_detect_doc_type":true,"retry_text":"Pode me reenviar a foto do seu documento (RG ou CNH)? 📷"}]'::jsonb,
  transitions = ('[{"goto_special": null, "goto_step_id": "' || v_email || '", "trigger_intent": "default", "trigger_phrases": []}]')::jsonb,
  fallback = ('{"mode":"retry","on_fail":"handoff","max_retries":2,"handoff_reason":"no_media_received","success_goto_step_id":"' || v_email || '"}')::jsonb,
  media_order = '["text","audio","video","image"]'::jsonb
 WHERE flow_id = v_flow AND id = v_doc;

-- ── 8) EMAIL (capture_email) — NOVO ─────────────────────────────────────────
INSERT INTO bot_flow_steps (id, flow_id, position, step_key, slot_key, step_type, wait_for, text_delay_ms, is_active, message_text, captures, transitions, fallback, media_order)
VALUES (
  v_email, v_flow, 8, 'a_pedir_email', NULL, 'capture_email', 'reply', 1500, true,
  E'Falta pouco, *{{nome}}*! 📧\n\nMe passa seu *e-mail* pra finalizar o cadastro no portal da iGreen.',
  '[{"kind":"text","name":"email","required":true,"retry_text":"Esse e-mail parece inválido. Pode reenviar? 🙂"}]'::jsonb,
  '[]'::jsonb,
  ('{"mode":"retry","then":"humano","max_retries":2,"retry_text":"Esse e-mail parece inválido. Pode reenviar?","success_goto_step_id":"' || v_tel || '"}')::jsonb,
  '["text","audio","video","image"]'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  flow_id = EXCLUDED.flow_id, position = EXCLUDED.position, step_key = EXCLUDED.step_key,
  step_type = EXCLUDED.step_type, wait_for = EXCLUDED.wait_for, is_active = true,
  message_text = EXCLUDED.message_text, captures = EXCLUDED.captures,
  transitions = EXCLUDED.transitions, fallback = EXCLUDED.fallback, media_order = EXCLUDED.media_order;

-- ── 9) TELEFONE (confirm_phone) — NOVO ──────────────────────────────────────
INSERT INTO bot_flow_steps (id, flow_id, position, step_key, slot_key, step_type, wait_for, text_delay_ms, is_active, message_text, captures, transitions, fallback, media_order)
VALUES (
  v_tel, v_flow, 9, 'a_confirmar_telefone', NULL, 'confirm_phone', 'reply', 1500, true,
  E'Confirma seu *telefone de contato*? 📱\n\nSe for o mesmo deste WhatsApp, responde *Sim*. Se não, manda o novo número com DDD.',
  '[{"kind":"text","name":"telefone","required":true}]'::jsonb,
  '[]'::jsonb,
  ('{"mode":"retry","then":"humano","max_retries":2,"retry_text":"Pode confirmar o telefone novamente? 🙂","success_goto_step_id":"' || v_final || '"}')::jsonb,
  '["text","audio","video","image"]'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  flow_id = EXCLUDED.flow_id, position = EXCLUDED.position, step_key = EXCLUDED.step_key,
  step_type = EXCLUDED.step_type, wait_for = EXCLUDED.wait_for, is_active = true,
  message_text = EXCLUDED.message_text, captures = EXCLUDED.captures,
  transitions = EXCLUDED.transitions, fallback = EXCLUDED.fallback, media_order = EXCLUDED.media_order;

-- ── 10) FINALIZAR (finalizar_cadastro) ──────────────────────────────────────
UPDATE bot_flow_steps SET
  position = 10,
  step_type = 'finalizar_cadastro',
  wait_for = 'none',
  message_text = E'Prontinho, *{{nome}}*! 🎉\n\nTô finalizando seu cadastro no portal da iGreen agorinha. Em instantes você recebe a confirmação por aqui. 🚀',
  transitions = '[]'::jsonb,
  fallback = '{"mode":"handoff","handoff_reason":"cadastro_falhou"}'::jsonb,
  media_order = '["text","audio","video","image"]'::jsonb
 WHERE flow_id = v_flow AND id = v_final;

END $$;
