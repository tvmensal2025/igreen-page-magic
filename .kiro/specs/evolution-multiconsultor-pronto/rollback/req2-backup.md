# REQ 2 — Backup ANTES da mudança de seed/default

> Artefato de backup/rollback exigido pela Task 4.1 (e Requisitos 6.1, 6.2, 6.3).
> Captura o estado **anterior** dos objetos de banco que a migração do REQ 2 irá alterar:
> (1) a função `public.seed_default_camila_flow(uuid)` e (2) o `DEFAULT` da coluna
> `public.consultants.active_variants`. Anexar este arquivo ao PR da migração REQ 2.

## Metadados da captura

- **Timestamp (UTC):** 2026-05-31T16:11:44Z
- **Fonte:** banco Supabase de produção do iGreen
- **Project URL:** https://zlzasfhcxcznaprrragl.supabase.co
- **Project ref:** zlzasfhcxcznaprrragl
- **Método:** leitura read-only via MCP Supabase (`execute_sql`); **nenhum** objeto de banco foi modificado
- **Objetos capturados:**
  - `public.seed_default_camila_flow(uuid)` via `pg_get_functiondef('public.seed_default_camila_flow(uuid)'::regprocedure)`
  - `DEFAULT` de `public.consultants.active_variants` via `pg_attrdef` / `pg_get_expr`

---

## 1. `DEFAULT` atual de `public.consultants.active_variants`

Capturado via:

```sql
SELECT
  c.relname AS table_name,
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  pg_get_expr(ad.adbin, ad.adrelid) AS column_default
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE n.nspname = 'public'
  AND c.relname = 'consultants'
  AND a.attname = 'active_variants';
```

Resultado verbatim:

| table_name  | column_name     | data_type | column_default      |
|-------------|-----------------|-----------|---------------------|
| consultants | active_variants | text[]    | `ARRAY['A'::text]`  |

**DEFAULT anterior (para rollback):**

```sql
ALTER TABLE public.consultants ALTER COLUMN active_variants SET DEFAULT ARRAY['A'::text];
```

---

## 2. Definição atual de `public.seed_default_camila_flow(uuid)`

Capturada via:

```sql
SELECT pg_get_functiondef('public.seed_default_camila_flow(uuid)'::regprocedure) AS function_def;
```

Definição verbatim (usar este corpo para restaurar a função no rollback do REQ 2):

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
$function$
```

> Nota: no estado capturado, o `INSERT INTO public.bot_flows` **não** especifica `variant`,
> logo o fluxo nasce com o default da coluna (`'A'`). A migração do REQ 2 (Task 4.2) altera
> esse `INSERT` para incluir `variant => 'D'`. O rollback consiste em restaurar exatamente
> o corpo acima (sem `variant` no `INSERT`).

---

## 3. Procedimento de rollback do REQ 2

Para reverter a migração do REQ 2 ao estado capturado neste arquivo:

1. **Restaurar a função** `public.seed_default_camila_flow(uuid)` executando verbatim o bloco
   `CREATE OR REPLACE FUNCTION ...` da Seção 2 (sem `variant` no `INSERT INTO public.bot_flows`).
2. **Restaurar o default da coluna:**

   ```sql
   ALTER TABLE public.consultants ALTER COLUMN active_variants SET DEFAULT ARRAY['A'::text];
   ```

Ambos os passos afetam apenas o provisionamento de **novos** consultores; nenhuma linha
existente (incluindo as do Rafael, id `0c2711ad-4836-41e6-afba-edd94f698ae3`) é alterada.
