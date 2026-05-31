-- ============================================================================
-- REQ 2 — Consultor novo nasce na variante padrão D (seed + default)
-- Spec: .kiro/specs/evolution-multiconsultor-pronto (Task 4.2)
-- ============================================================================
-- Objetivo: novos consultores passam a nascer provisionados na variante de
-- fluxo padrão de negócio ('D'), em vez de 'A'. A fonte única de verdade do
-- provisionamento é a função seed_default_camila_flow (chamada pelo trigger
-- trg_seed_camila_flow no INSERT de consultants).
--
-- Esta migração é FOCADA e REVERSÍVEL. Ela altera APENAS:
--   (1) o corpo de public.seed_default_camila_flow(uuid) — exatamente um ponto:
--       o INSERT INTO public.bot_flows passa a gravar variant = 'D'.
--       O SELECT de reuso (idempotência) e os 6 bot_flow_steps permanecem
--       byte-idênticos ao backup capturado em rollback/req2-backup.md.
--   (2) o DEFAULT da coluna public.consultants.active_variants para ARRAY['D'].
--
-- Escopo "novos apenas":
--   - O ALTER COLUMN ... SET DEFAULT afeta SOMENTE novas inserções; NÃO reescreve
--     linhas existentes.
--   - NÃO há bloco DO $$ ... seed_default_camila_flow(r.id) ... $$ de backfill de
--     todos os consultores. O consultor existente (Rafael,
--     id 0c2711ad-4836-41e6-afba-edd94f698ae3) não é alterado: o SELECT inicial
--     da função encontra fluxo ativo e retorna sem inserir (idempotência).
--
-- Decisão de design: NÃO alteramos o DEFAULT de public.bot_flows.variant (segue
-- 'A'). A fonte de verdade do provisionamento é o seed; mudar o default da
-- coluna criaria drift com inserts manuais/UI.
--
-- NÃO AUTO-APLICÁVEL: aplicar somente após aprovação humana explícita, primeiro
-- em banco isolado/branch. Backup/rollback documentados em
-- .kiro/specs/evolution-multiconsultor-pronto/rollback/req2-backup.md
-- Rollback: restaurar o corpo anterior da função (INSERT sem variant) e
--           ALTER TABLE public.consultants ALTER COLUMN active_variants
--           SET DEFAULT ARRAY['A'::text];
-- ============================================================================

-- (1) Seed: grava variant = 'D' no bot_flow semeado (única alteração no corpo).
CREATE OR REPLACE FUNCTION public.seed_default_camila_flow(_consultant_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_flow_id uuid;
  v_step_count int;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; s6 uuid;
BEGIN
  -- Reutiliza fluxo ativo existente (constraint uniq_bot_flows_active_per_consultant)
  SELECT id INTO v_flow_id
    FROM public.bot_flows
   WHERE consultant_id = _consultant_id AND is_active = true
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_flow_id IS NULL THEN
    INSERT INTO public.bot_flows (consultant_id, name, variant, is_active, strict_mode)
    VALUES (_consultant_id, 'Fluxo da Camila', 'D', true, false)
    RETURNING id INTO v_flow_id;
  END IF;

  -- Se já tem passos, não mexe
  SELECT count(*) INTO v_step_count FROM public.bot_flow_steps WHERE flow_id = v_flow_id;
  IF v_step_count > 0 THEN RETURN v_flow_id; END IF;

  s1 := gen_random_uuid(); s2 := gen_random_uuid(); s3 := gen_random_uuid();
  s4 := gen_random_uuid(); s5 := gen_random_uuid(); s6 := gen_random_uuid();

  INSERT INTO public.bot_flow_steps
    (id, flow_id, position, step_type, step_key, title, summary, icon,
     message_text, slot_key, transitions, is_active)
  VALUES
    (s1, v_flow_id, 1, 'message', 'welcome',
     'Boas-vindas',
     'Primeira mensagem que a Camila envia quando o lead chama no WhatsApp.',
     'sparkle',
     'Oi {{nome}}! 👋 Aqui é a Camila do time da {{representante}}. Posso te explicar rapidinho como economizar na conta de luz?',
     'boas_vindas',
     jsonb_build_array(
       jsonb_build_object('trigger_intent','afirmacao','trigger_phrases',jsonb_build_array('sim','oi','olá','quero','vamos','bora'),'goto_step_id', s2,'goto_special',null),
       jsonb_build_object('trigger_intent','default','trigger_phrases',jsonb_build_array(),'goto_step_id', s1,'goto_special','repeat')
     ), true),

    (s2, v_flow_id, 2, 'message', 'qualificacao',
     'Vídeo explicativo + pergunta da conta',
     'Manda o vídeo principal e pergunta o valor da conta de luz.',
     'video',
     'Qual o valor médio da sua conta de luz, {{nome}}? Assim já te mostro quanto dá pra economizar. ⚡',
     'explainer',
     jsonb_build_array(
       jsonb_build_object('trigger_intent','ja_assistiu_video','trigger_phrases',jsonb_build_array('já assisti','assisti','vi o vídeo'),'goto_step_id', s3,'goto_special',null),
       jsonb_build_object('trigger_intent','default','trigger_phrases',jsonb_build_array(),'goto_step_id', s2,'goto_special','repeat')
     ), true),

    (s3, v_flow_id, 3, 'message', 'checkin_pos_video',
     'Check-in pós-vídeo',
     'Confere se o lead viu o vídeo e o que ele achou.',
     'msg',
     'Que ótimo {{nome}}! 🙌 Com uma conta de {{valor_conta}}, dá pra eu te ajudar a economizar de 8% a 20% todo mês — sem obra, sem instalação e sem mudar nada na sua casa. ⚡ Posso te explicar rapidinho como funciona?',
     'checkin',
     jsonb_build_array(
       jsonb_build_object('trigger_intent','afirmacao','trigger_phrases',jsonb_build_array('sim','gostei','quero ver','manda'),'goto_step_id', s4,'goto_special',null),
       jsonb_build_object('trigger_intent','tem_duvida','trigger_phrases',jsonb_build_array('dúvida','pergunta','como'),'goto_step_id', s5,'goto_special',null),
       jsonb_build_object('trigger_intent','quer_cadastrar','trigger_phrases',jsonb_build_array('cadastrar','quero ja','já quero'),'goto_step_id', null,'goto_special','cadastro'),
       jsonb_build_object('trigger_intent','default','trigger_phrases',jsonb_build_array(),'goto_step_id', s3,'goto_special','repeat')
     ), true),

    (s4, v_flow_id, 4, 'message', 'pitch_conexao_club',
     'Pitch do Conexão Club',
     'Apresenta o cashback e o programa Conexão Club.',
     'video',
     'Olha só esse benefício extra do Conexão Club, {{nome}} — cashback toda vez que você compra nas lojas parceiras. 🛍️',
     'club',
     jsonb_build_array(
       jsonb_build_object('trigger_intent','default','trigger_phrases',jsonb_build_array(),'goto_step_id', s5,'goto_special',null)
     ), true),

    (s5, v_flow_id, 5, 'message', 'duvidas_pos_club',
     'Tirar dúvidas',
     'Última etapa antes do cadastro: responde dúvidas finais.',
     'msg',
     'Pode perguntar o que quiser, {{nome}} — tô aqui pra te ajudar. 😊',
     'duvidas',
     jsonb_build_array(
       jsonb_build_object('trigger_intent','afirmacao','trigger_phrases',jsonb_build_array('quero seguir','vamos','bora','pode mandar'),'goto_step_id', null,'goto_special','cadastro'),
       jsonb_build_object('trigger_intent','negacao','trigger_phrases',jsonb_build_array('não','depois','agora não'),'goto_step_id', s5,'goto_special','repeat'),
       jsonb_build_object('trigger_intent','default','trigger_phrases',jsonb_build_array(),'goto_step_id', s5,'goto_special','repeat')
     ), true),

    (s6, v_flow_id, 6, 'message', 'cadastro',
     'Cadastro (fluxo antigo, intacto)',
     'A Camila pede a foto da conta de luz e segue o cadastro normal (OCR + portal iGreen).',
     'file',
     'Perfeito! Pra eu já garantir seu desconto, me manda uma foto ou PDF da sua última conta de luz. 📄',
     'cadastro_pedir_conta',
     '[]'::jsonb, true);

  RETURN v_flow_id;
END;
$function$;

-- (2) Default da coluna: novos consultores nascem com active_variants incluindo 'D'.
--     Afeta APENAS novas inserções; não reescreve linhas existentes.
ALTER TABLE public.consultants ALTER COLUMN active_variants SET DEFAULT ARRAY['D'::text];
