# REQ 2 — Rollback da migração (seed variante D + default `active_variants`)

> Artefato de rollback exigido pela Task 4.4 (Requisitos **2.4** e **6.2**).
> Documenta como reverter, ao estado anterior, a migração **forward** do REQ 2:
>
> **`supabase/migrations/20260601030000_req2_seed_default_camila_flow_variant_d.sql`**
>
> O estado anterior (verbatim) foi capturado em
> [`req2-backup.md`](./req2-backup.md) pela Task 4.1. Anexar este arquivo ao PR
> da migração REQ 2.

## O que a migração forward alterou

A migração `20260601030000_req2_seed_default_camila_flow_variant_d.sql` fez **duas**
alterações focadas:

1. **Função** `public.seed_default_camila_flow(uuid)` — o `INSERT INTO public.bot_flows`
   passou a gravar `variant => 'D'` (`VALUES (_consultant_id, 'Fluxo da Camila', 'D', true, false)`).
2. **DEFAULT** da coluna `public.consultants.active_variants` — passou de
   `ARRAY['A'::text]` para `ARRAY['D'::text]`.

O rollback desfaz exatamente esses dois pontos.

## Características do rollback

- **Afeta apenas novos inserts:** tanto a restauração da função (que só roda no
  provisionamento de um consultor recém-criado, via trigger `trg_seed_camila_flow`)
  quanto o `ALTER COLUMN ... SET DEFAULT` afetam **somente novas inserções**.
  **Nenhuma linha existente é modificada** — incluindo as linhas do consultor atual
  (Rafael, id `0c2711ad-4836-41e6-afba-edd94f698ae3`), que permanecem byte-idênticas.
- **NÃO auto-aplicável:** este rollback **exige aprovação humana explícita** e deve ser
  aplicado primeiro em banco isolado/branch. Não usar `apply_migration` automaticamente
  (Requisitos 6.2, 6.3).
- **Foco mínimo:** restaura apenas os dois objetos alterados; nenhuma outra política,
  função, coluna ou dado é tocado.

---

## SQL de rollback (executar verbatim, após aprovação humana)

### Passo 1 — Restaurar a função `public.seed_default_camila_flow(uuid)` (corpo ANTERIOR, `INSERT` sem `variant`)

O bloco abaixo é o corpo **anterior** da função, copiado verbatim da Seção 2 de
[`req2-backup.md`](./req2-backup.md). A única diferença em relação à versão forward é o
`INSERT INTO public.bot_flows` **sem** a coluna `variant` (o fluxo volta a nascer com o
default da coluna). O `SELECT` de reuso (idempotência) e os 6 `bot_flow_steps`
permanecem inalterados.

```sql
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
    INSERT INTO public.bot_flows (consultant_id, name, is_active, strict_mode)
    VALUES (_consultant_id, 'Fluxo da Camila', true, false)
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
```

### Passo 2 — Restaurar o DEFAULT da coluna `public.consultants.active_variants`

```sql
ALTER TABLE public.consultants ALTER COLUMN active_variants SET DEFAULT ARRAY['A'::text];
```

---

## Verificação pós-rollback

Após aplicar os dois passos em banco isolado/branch, confirmar (read-only):

```sql
-- (a) A função NÃO grava mais variant no INSERT INTO public.bot_flows
SELECT pg_get_functiondef('public.seed_default_camila_flow(uuid)'::regprocedure) AS function_def;
-- Esperado: o INSERT INTO public.bot_flows lista (consultant_id, name, is_active, strict_mode), SEM variant.

-- (b) O DEFAULT da coluna voltou para ARRAY['A'::text]
SELECT pg_get_expr(ad.adbin, ad.adrelid) AS column_default
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relname = 'consultants' AND a.attname = 'active_variants';
-- Esperado: ARRAY['A'::text]
```

Confirmar também que as linhas do Rafael (id `0c2711ad-4836-41e6-afba-edd94f698ae3`)
permanecem inalteradas — o rollback não executa nenhum backfill nem `UPDATE` em linhas
existentes.

---

## Referências

- Migração forward revertida: `supabase/migrations/20260601030000_req2_seed_default_camila_flow_variant_d.sql`
- Backup do estado anterior (fonte verbatim deste rollback): [`req2-backup.md`](./req2-backup.md)
- Requisitos: **2.4** (mudança reversível com rollback documentado), **6.2** (backup + plano de rollback antes de aplicar)
