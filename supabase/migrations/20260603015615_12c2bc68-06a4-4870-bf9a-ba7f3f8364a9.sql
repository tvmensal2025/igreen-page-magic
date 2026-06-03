-- Fluxo A: correções de slot, texto e numeração

-- 1) Passo 1: trocar slot p/ 'welcome' (aproveita áudio preset do consultor)
UPDATE bot_flow_steps
SET slot_key = 'welcome',
    title = '1. Boas-vindas'
WHERE id = '6226f6f3-e655-4cc9-af20-d8c28c998160';

-- 2) Passo 2: renumerar
UPDATE bot_flow_steps SET title = '2. Pergunta valor da conta'
WHERE id = '3e7fb4cd-33a7-4854-aec7-4570b04456e9';

-- 3) Passo 3: renumerar
UPDATE bot_flow_steps SET title = '3. Explica o desconto'
WHERE id = '80188e5f-0c6d-4883-b058-0708efddc056';

-- 4) Passo 4: remover promessa de mídia + renumerar
UPDATE bot_flow_steps
SET title = '4. Prova social',
    message_text = 'Mais de *100 mil clientes* já economizam com a iGreen — desde casas até comércios e empresas. 🌱

Tudo 100% legalizado pela ANEEL, sem fidelidade e sem mudar nada na sua instalação.'
WHERE id = 'a71ba814-e6c2-48aa-bc16-0094e812bc15';

-- 5) Passo 5: renumerar
UPDATE bot_flow_steps SET title = '5. Convite para o cadastro'
WHERE id = '559b8f1b-0630-45b5-aeae-b96cb4d20e9a';

-- 6-10) Renumerar
UPDATE bot_flow_steps SET title = '6. Conta de luz' WHERE id = (SELECT id FROM bot_flow_steps WHERE flow_id='66a19db4-b061-4f3f-921f-c13e9fb6f730' AND position=6);
UPDATE bot_flow_steps SET title = '7. Documento com foto' WHERE id = (SELECT id FROM bot_flow_steps WHERE flow_id='66a19db4-b061-4f3f-921f-c13e9fb6f730' AND position=7);
UPDATE bot_flow_steps SET title = '8. E-mail' WHERE id = (SELECT id FROM bot_flow_steps WHERE flow_id='66a19db4-b061-4f3f-921f-c13e9fb6f730' AND position=8);
UPDATE bot_flow_steps SET title = '9. Confirmar telefone' WHERE id = (SELECT id FROM bot_flow_steps WHERE flow_id='66a19db4-b061-4f3f-921f-c13e9fb6f730' AND position=9);
UPDATE bot_flow_steps SET title = '10. Finalizar cadastro' WHERE id = (SELECT id FROM bot_flow_steps WHERE flow_id='66a19db4-b061-4f3f-921f-c13e9fb6f730' AND position=10);