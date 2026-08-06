-- ============================================================================
-- FAQ / atalhos: fluxo público A do superadmin = fonte única
-- ============================================================================
-- Grupo A é ~98% dos leads e resolve_flow_id sempre cai no fluxo PÚBLICO da
-- variante A (Sofia — Ativação Multicanal). Logo o FAQ que o lead recebe é o do
-- superadmin. O que faltava:
--
--   1. sync_objection_shortcut_all só fazia UPDATE por intent_name — consultor
--      que nunca teve o card não recebia nada. Daí fluxos com 24, 33, 40 e 0
--      atalhos convivendo (o "Fluxo MG", público, estava com zero).
--   2. auto_seed_faq_on_flow_create semeava o pack de junho/2026 e ignorava
--      fluxos públicos, então fluxo novo nascia desatualizado.
--   3. Nenhum gatilho "como funciona" existia em toda a base — a pergunta mais
--      comum do meio do funil caía sempre no orquestrador de IA.
--
-- Aqui: os cards Geral entram no catálogo e qualquer fluxo passa a copiar o
-- conjunto do master, inclusive fluxo recém-criado.

-- ── 1) Cards "Geral" (espelham src/lib/objectionShortcuts.ts) ────────────────
DO $do$
DECLARE
  _master uuid;
BEGIN
  SELECT id INTO _master FROM bot_flows
  WHERE is_public = true AND is_active = true AND variant = 'A' LIMIT 1;

  IF _master IS NULL THEN
    RAISE NOTICE 'sem fluxo público A — cards Geral não semeados';
    RETURN;
  END IF;

  PERFORM public.refresh_objection_shortcut(
    _master,
    'Geral · Como funciona',
    'Funciona simples, {{nome}} 😊

Você continua recebendo energia pela *mesma* distribuidora da sua cidade. A *iGreen* injeta *energia limpa* na rede e você passa a pagar uma fatura *com desconto* no lugar de parte da conta atual. ⚡

*Sem obra*, *sem placa* no telhado, *sem taxa de adesão* e *sem fidelidade* — só muda quem fatura a energia. 🌱',
    ARRAY['como funciona','como que funciona','como isso funciona','como funciona isso','como funciona essa energia','me explica como funciona','explica como funciona','me explica melhor','me explica direito','não entendi','nao entendi','não entendi nada','como assim','o que é isso','do que se trata']::text[]
  );

  PERFORM public.refresh_objection_shortcut(
    _master,
    'Geral · O que preciso enviar',
    'Bem pouca coisa, {{nome}} 😊

Pra ativar eu preciso da *foto da conta de luz*, um *documento* (RG ou CNH) e seu *e-mail*. ⚡

O cadastro é *100% digital*, feito aqui mesmo pelo WhatsApp, e leva poucos *minutos*. 🌱',
    ARRAY['o que preciso','o que preciso fazer','o que eu preciso enviar','o que tenho que mandar','quais documentos','quais documentos precisa','que documentos preciso','quais dados precisa','o que precisa de mim','o que você precisa']::text[]
  );

  PERFORM public.refresh_objection_shortcut(
    _master,
    'Geral · Vale a pena / compensa',
    'Vale, {{nome}} 😊

Você paga *menos* pela mesma energia, todo mês, *sem investir nada* e *sem obra* em casa. ⚡

E como o *desconto* é percentual, se a tarifa subir sua economia acompanha. Se não gostar, cancela — *sem multa* e *sem fidelidade*. 🌱',
    ARRAY['vale a pena','vale mesmo a pena','compensa mesmo','será que compensa','sera que compensa','qual a vantagem','quais as vantagens','qual o benefício','é bom mesmo']::text[]
  );
END
$do$;

-- ── 2) Espelha o master em um fluxo qualquer ─────────────────────────────────
-- Cria o que falta, padroniza texto/gatilhos do que existe e remove os cards
-- que foram fundidos no canônico. Cards criados pelo consultor (intent fora do
-- master) não são tocados.
CREATE OR REPLACE FUNCTION public.sync_qa_from_master_flow(_flow_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _master uuid;
  _card record;
  _qa_id uuid;
  _n int := 0;
BEGIN
  IF _flow_id IS NULL THEN RETURN 0; END IF;

  SELECT id INTO _master FROM bot_flows
  WHERE is_public = true AND is_active = true AND variant = 'A' LIMIT 1;
  IF _master IS NULL OR _master = _flow_id THEN RETURN 0; END IF;

  -- Cards antigos cuja resposta foi fundida em um card canônico.
  DELETE FROM bot_flow_qa
  WHERE flow_id = _flow_id
    AND intent_name = ANY(ARRAY[
      'Confiança · Não confio nessa empresa',
      'Confiança · Nunca ouvi falar',
      'Confiança · CNPJ / regulamentação',
      'Confiança · Há quanto tempo existe',
      'Preço · Pagar pra entrar',
      'Preço · Desconto é falso',
      'Preço · É caro / não tenho dinheiro',
      'Preço · Vou pagar a mais no fim',
      'Técnico · Funciona pra apartamento',
      'Técnico · Mexer na fiação',
      'Técnico · Placa solar / painel',
      'Cancelamento · Como faço pra cancelar',
      'Cancelamento · Posso cancelar quando quiser',
      'Cancelamento · É difícil cancelar',
      'Cadastro · Não vou mandar foto da conta',
      'Cadastro · Por que precisam do CPF',
      'Cadastro · E se vazarem meus dados'
    ]::text[]);

  FOR _card IN
    SELECT q.intent_name,
           q.text_response,
           COALESCE(
             ARRAY(SELECT trim(t.phrase) FROM bot_flow_qa_triggers t
                   WHERE t.qa_id = q.id ORDER BY t.created_at),
             ARRAY[]::text[]
           ) AS triggers
    FROM bot_flow_qa q
    WHERE q.flow_id = _master
      AND COALESCE(q.is_opening, false) = false
      AND COALESCE(q.is_closing, false) = false
    ORDER BY q.position
  LOOP
    _qa_id := public.refresh_objection_shortcut(
      _flow_id, _card.intent_name, COALESCE(_card.text_response, ''), _card.triggers
    );
    _n := _n + 1;
  END LOOP;

  RETURN _n;
END
$fn$;

CREATE OR REPLACE FUNCTION public.sync_qa_all_flows_from_master()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _r record;
  _n int := 0;
BEGIN
  FOR _r IN SELECT id FROM bot_flows LOOP
    IF public.sync_qa_from_master_flow(_r.id) > 0 THEN
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.sync_qa_from_master_flow(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_qa_all_flows_from_master() TO authenticated;

-- ── 3) Fluxo novo nasce igual ao master ─────────────────────────────────────
-- Antes exigia consultant_id IS NOT NULL AND is_public = false — motivo do
-- "Fluxo MG" (público) nunca ter recebido atalho. Sem master, mantém o pack
-- antigo como rede de segurança.
CREATE OR REPLACE FUNCTION public.auto_seed_faq_on_flow_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM bot_flow_qa WHERE flow_id = NEW.id LIMIT 1) THEN
    RETURN NEW;
  END IF;

  IF public.sync_qa_from_master_flow(NEW.id) = 0 THEN
    PERFORM seed_igreen_faq_pack(NEW.id);
    PERFORM seed_full_objection_pack(NEW.id);
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_auto_seed_faq ON bot_flows;
CREATE TRIGGER trg_auto_seed_faq
  AFTER INSERT ON bot_flows
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_seed_faq_on_flow_create();

-- ── 4) Backfill ─────────────────────────────────────────────────────────────
SELECT public.sync_qa_all_flows_from_master();

-- Gatilhos de palavra única que casam contexto errado (legado).
DELETE FROM bot_flow_qa_triggers
WHERE lower(trim(phrase)) IN (
  'fidelidade','multa','golpe','furada','depois','sair','data','ap','cobertura','obra',
  'ativar','link','conta','taxa','solar','pagar','seguro','prazo','cancelar','pix','ceo',
  'dono','aqui','moro','cidade','ligar','explica','humano','mentira','scam','aneel','cnpj',
  'lgpd','anos','placa','juros','caro','sede','sócio','socio','enel','cemig','light','spc',
  'cosip','apagão','apagao','piramide','pirâmide','amarrado','desconfio','duvido','estranho',
  'suspeito','oculta','surpresa','pegadinha','adesão','adesao','mensalidade'
);
