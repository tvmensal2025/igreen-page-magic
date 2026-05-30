
-- Corrigir transitions do flow D (botões) para garantir ordem: conta -> simulação -> documento

-- d_duvidas: "cadastrar" deve ir para conta (não para documento)
UPDATE public.bot_flow_steps
SET transitions = '[
  {"goto_special": null, "goto_step_id": "279d3926-5363-403f-af5d-5201e2014598", "trigger_intent": "palavra_chave", "trigger_phrases": ["Quero simular", "simular"]},
  {"goto_special": null, "goto_step_id": "279d3926-5363-403f-af5d-5201e2014598", "trigger_intent": "palavra_chave", "trigger_phrases": ["Quero cadastrar", "cadastrar"]},
  {"goto_special": "humano", "goto_step_id": null, "trigger_intent": "palavra_chave", "trigger_phrases": ["Falar com Rafael", "humano", "atendente"]}
]'::jsonb
WHERE id = '38c0d101-6492-4b1e-8229-c676c804161a';

-- d_como_funciona: "📝 Cadastrar agora / cadastrar" deve ir para conta
UPDATE public.bot_flow_steps
SET transitions = '[
  {"goto_special": null, "goto_step_id": "279d3926-5363-403f-af5d-5201e2014598", "trigger_intent": "palavra_chave", "trigger_phrases": ["Cadastrar agora"]},
  {"goto_special": null, "goto_step_id": "38c0d101-6492-4b1e-8229-c676c804161a", "trigger_intent": "palavra_chave", "trigger_phrases": ["Ainda tenho duvida", "duvida", "dúvida"]},
  {"goto_special": "humano", "goto_step_id": null, "trigger_intent": "palavra_chave", "trigger_phrases": ["Falar com Rafael", "humano", "atendente"]},
  {"goto_special": null, "goto_step_id": "279d3926-5363-403f-af5d-5201e2014598", "trigger_intent": "palavra_chave", "trigger_phrases": ["📝 Cadastrar agora", "Cadastrar agora", "cadastrar"]},
  {"goto_special": "humano", "goto_step_id": null, "trigger_intent": "palavra_chave", "trigger_phrases": ["Novo botão", "botão", "btn_mpru57ht"]},
  {"goto_special": null, "goto_step_id": "38c0d101-6492-4b1e-8229-c676c804161a", "trigger_intent": "palavra_chave", "trigger_phrases": ["Novo botão", "botão", "btn_mpru5wd3"]}
]'::jsonb
WHERE id = 'c87d76f8-f4d2-48ec-ac08-4ef0b3c92834';

-- d_welcome: adicionar gatilho "cadastrar" apontando para conta
UPDATE public.bot_flow_steps
SET transitions = '[
  {"goto_special": null, "goto_step_id": "279d3926-5363-403f-af5d-5201e2014598", "trigger_intent": "palavra_chave", "trigger_phrases": ["simular", "quero simular", "1"]},
  {"goto_special": null, "goto_step_id": "c87d76f8-f4d2-48ec-ac08-4ef0b3c92834", "trigger_intent": "palavra_chave", "trigger_phrases": ["como", "como funciona", "2"]},
  {"goto_special": "humano", "goto_step_id": null, "trigger_intent": "palavra_chave", "trigger_phrases": ["humano", "falar com", "3"]},
  {"goto_special": null, "goto_step_id": "279d3926-5363-403f-af5d-5201e2014598", "trigger_intent": "palavra_chave", "trigger_phrases": ["cadastrar", "quero cadastrar", "Cadastrar agora"]}
]'::jsonb
WHERE id = 'aee7b26c-7669-448b-9def-77dc8466b039';
