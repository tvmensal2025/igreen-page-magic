-- ============================================================================
-- Auto-seed FAQ para novos consultores
-- ============================================================================
-- Quando um bot_flows é criado, automaticamente insere:
--   1. Pacote iGreen (15 atalhos curados) via seed_igreen_faq_pack
--   2. Pacote objeções (40 atalhos) via seed_full_objection_pack
--
-- Também faz backfill de flows ativos existentes que não têm FAQ.
-- ============================================================================

-- ── RPC: seed_full_objection_pack ─────────────────────────────────────────────
-- Insere os 40 atalhos de objeção padrão (extraídos de objectionShortcuts.ts).
-- Idempotente: reutiliza seed_objection_shortcut (pula intent_name existente).
CREATE OR REPLACE FUNCTION public.seed_full_objection_pack(_flow_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _before integer;
  _added integer;
BEGIN
  SELECT count(*) INTO _before FROM bot_flow_qa WHERE flow_id = _flow_id;

  -- ── Confiança ──────────────────────────────────────────────────────────────
  PERFORM seed_objection_shortcut(_flow_id, 'Confiança · Nunca ouvi falar',
    'Tranquilo, {{nome}}! A iGreen atua há 7+ anos, com escritório físico e + de 100k clientes. Te mando o link do nosso site e do Reclame Aqui pra você conferir, pode ser?',
    ARRAY['nunca ouvi','não conheço','primeira vez','quem é']);

  PERFORM seed_objection_shortcut(_flow_id, 'Confiança · Há quanto tempo existe',
    'A iGreen está no mercado desde 2017, {{nome}} — mais de 7 anos operando energia limpa por assinatura no Brasil.',
    ARRAY['quanto tempo','anos','fundada','começou','mercado']);

  PERFORM seed_objection_shortcut(_flow_id, 'Confiança · Onde fica a sede',
    'Sede em Cuiabá-MT, com escritórios regionais em vários estados. Quer o endereço completo?',
    ARRAY['sede','endereço','escritório','onde fica','localização']);

  PERFORM seed_objection_shortcut(_flow_id, 'Confiança · Quem é o dono',
    'A iGreen é fundada e dirigida pelo empresário Beto Bahia. Empresa privada, 100% brasileira.',
    ARRAY['dono','sócio','fundador','proprietário','ceo']);

  -- ── Preço ──────────────────────────────────────────────────────────────────
  PERFORM seed_objection_shortcut(_flow_id, 'Preço · É caro / não tenho dinheiro',
    'Pelo contrário, {{nome}} — você NÃO paga nada a mais. Só passa a pagar uma fatura iGreen MENOR no lugar da fatura da concessionária. Sem custo de adesão, sem instalação, sem mensalidade.',
    ARRAY['caro','sem dinheiro','apertado','sem grana','tô quebrado']);

  PERFORM seed_objection_shortcut(_flow_id, 'Preço · Quanto economizo de verdade',
    'Em média 12% a 20% de desconto no valor da sua conta atual, {{nome}}. Com sua conta em mãos eu te mostro EXATAMENTE quanto vai sobrar no seu bolso por mês 👀',
    ARRAY['quanto economizo','quanto vou economizar','economia real','comprovação']);

  PERFORM seed_objection_shortcut(_flow_id, 'Preço · Vou pagar a mais no fim',
    'Não, {{nome}}. A fatura iGreen SUBSTITUI parte da fatura da concessionária — não soma. No fim do mês você paga MENOS do que pagava antes.',
    ARRAY['pagar mais','dobrar','soma maior','conta cresce','vai sair mais caro']);

  PERFORM seed_objection_shortcut(_flow_id, 'Preço · Tarifa subir',
    'Boa, {{nome}}! Se a tarifa da concessionária subir, sua economia AUMENTA — porque o desconto é percentual sobre o valor cheio. Você se protege do aumento.',
    ARRAY['tarifa sobe','aumento','reajuste','bandeira vermelha','se subir']);

  -- ── Cobrança ───────────────────────────────────────────────────────────────
  PERFORM seed_objection_shortcut(_flow_id, 'Cobrança · Cobrar duas vezes',
    'Não é dobrado, {{nome}}. A conta da concessionária vem com VALOR MENOR (só a parte de impostos/disponibilidade) e a fatura iGreen vem com a energia. Somando as duas, dá MENOS que antes.',
    ARRAY['cobrar duas','duplicado','conta dobrada','em dobro','duas faturas']);

  PERFORM seed_objection_shortcut(_flow_id, 'Cobrança · Conta da concessionária',
    'Continua chegando, {{nome}} — mas com valor muito menor (só a taxa de disponibilidade da rede). A energia em si passa a vir da iGreen, mais barata.',
    ARRAY['conta concessionária','enel','light','cemig','equatorial','coelba','neoenergia']);

  PERFORM seed_objection_shortcut(_flow_id, 'Cobrança · Vencimento do boleto',
    'Você escolhe o melhor dia, {{nome}}! Dia 5, 10, 15, 20 ou 25. Receberá o boleto por WhatsApp e email.',
    ARRAY['vencimento','data','quando vence','prazo']);

  PERFORM seed_objection_shortcut(_flow_id, 'Cobrança · Forma de pagamento',
    'Boleto, Pix ou débito automático, {{nome}}! O que for melhor pra você.',
    ARRAY['débito automático','pix','cartão','como pago','forma de pagamento']);

  PERFORM seed_objection_shortcut(_flow_id, 'Cobrança · E se eu atrasar',
    'Atrasou, é como qualquer boleto: pequena multa de 2% + juros de mora. Mas você recebe lembretes antes do vencimento pra não esquecer 😉',
    ARRAY['atrasar','multa','juros','esquecer']);

  PERFORM seed_objection_shortcut(_flow_id, 'Cobrança · Vão me negativar',
    'Só em caso de inadimplência prolongada (90+ dias), igual qualquer fatura. Pagando normal, ZERO risco.',
    ARRAY['negativar','spc','serasa','nome sujo']);

  -- ── Técnico ────────────────────────────────────────────────────────────────
  PERFORM seed_objection_shortcut(_flow_id, 'Técnico · Mexer na fiação',
    'ZERO obra, {{nome}}! Ninguém vai na sua casa, não mexemos em nada. Tudo é feito na conta — a energia limpa vai pra rede e abate a sua.',
    ARRAY['fiação','instalação','técnico em casa','obra','mexer na minha casa']);

  PERFORM seed_objection_shortcut(_flow_id, 'Técnico · Placa solar / painel',
    'Nada disso, {{nome}}! As usinas solares são da iGreen, longe da sua casa. Você só recebe o desconto. Sem placa, sem inversor, sem nada no seu telhado.',
    ARRAY['placa','painel','telhado','equipamento','instalar']);

  PERFORM seed_objection_shortcut(_flow_id, 'Técnico · Funciona na minha cidade',
    'Me conta sua cidade que eu confirmo na hora, {{nome}}! Atendemos a maioria dos estados do Brasil.',
    ARRAY['minha cidade','região','atende aqui','cobertura','atendem']);

  -- ── Cancelamento ───────────────────────────────────────────────────────────
  PERFORM seed_objection_shortcut(_flow_id, 'Cancelamento · Quanto demora pra começar',
    'Em até 60 dias, {{nome}}, o desconto já aparece na sua próxima fatura. Cadastro leva uns 10 minutos hoje.',
    ARRAY['quanto tempo','demora','começa quando','prazo de início']);

  PERFORM seed_objection_shortcut(_flow_id, 'Cancelamento · Posso cancelar quando quiser',
    'Sempre, {{nome}}! Sem multa, sem fidelidade. Cancelamento em até 30 dias após solicitar.',
    ARRAY['cancelar quando quiser','sair','desistir','encerrar']);

  PERFORM seed_objection_shortcut(_flow_id, 'Cancelamento · Quero desistir (7 dias)',
    'Tranquilo, {{nome}}! Você tem 7 dias de arrependimento por lei (CDC). Só precisa avisar por escrito que cancela sem nenhum custo.',
    ARRAY['arrependimento','sete dias','desistência','desistir do contrato']);

  PERFORM seed_objection_shortcut(_flow_id, 'Cancelamento · Vou pensar / depois',
    'Claro, {{nome}}! Quer que eu te mande os documentos pra estudar com calma? Posso te chamar amanhã pra tirar dúvidas, que horário fica melhor?',
    ARRAY['pensar','depois','amanhã','te aviso','ver com esposa','ver com marido']);

  -- ── Cadastro ───────────────────────────────────────────────────────────────
  PERFORM seed_objection_shortcut(_flow_id, 'Cadastro · Não vou mandar foto da conta',
    'Entendo, {{nome}}. A foto serve só pra eu confirmar o valor do seu desconto e o nome do titular. Posso te explicar exatamente o que olhamos antes, se preferir.',
    ARRAY['foto não','conta não','privacidade conta','não mando foto']);

  PERFORM seed_objection_shortcut(_flow_id, 'Cadastro · Por que precisam do CPF',
    'Pra cadastrar você como titular da conta na iGreen, {{nome}}, igual qualquer contratação. Dados ficam protegidos pela LGPD.',
    ARRAY['cpf','dados pessoais','lgpd','privacidade']);

  PERFORM seed_objection_shortcut(_flow_id, 'Cadastro · Quero falar com humano',
    '',
    ARRAY['humano','pessoa','atendente','falar com alguém','consultor','vendedor']);

  PERFORM seed_objection_shortcut(_flow_id, 'Cadastro · Conhecer presencialmente',
    'Posso te apresentar tudo por vídeo-chamada, {{nome}}! Mais rápido e do conforto da sua casa. Que horário?',
    ARRAY['presencial','pessoalmente','escritório','reunião','ir até']);

  SELECT count(*) - _before INTO _added FROM bot_flow_qa WHERE flow_id = _flow_id;
  RETURN _added;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_full_objection_pack(uuid) TO authenticated;

-- ── Trigger: auto-seed ao criar bot_flows ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_seed_faq_on_flow_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só semeia flows próprios de consultor (consultant_id preenchido) que NÃO
  -- sejam templates públicos. Evita poluir templates compartilhados e flows
  -- de sistema/teste. (Flows novos estão sempre vazios no AFTER INSERT, então
  -- o check de QA existente é apenas defensivo.)
  IF NEW.consultant_id IS NOT NULL
     AND COALESCE(NEW.is_public, false) = false
     AND NOT EXISTS (SELECT 1 FROM bot_flow_qa WHERE flow_id = NEW.id LIMIT 1)
  THEN
    PERFORM seed_igreen_faq_pack(NEW.id);
    PERFORM seed_full_objection_pack(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_seed_faq ON bot_flows;
CREATE TRIGGER trg_auto_seed_faq
  AFTER INSERT ON bot_flows
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_seed_faq_on_flow_create();

-- ── Backfill: flows ativos sem nenhum FAQ ────────────────────────────────────
DO $$
DECLARE
  _r RECORD;
  _total integer := 0;
BEGIN
  FOR _r IN
    SELECT bf.id
    FROM bot_flows bf
    WHERE bf.is_active = true
      AND bf.consultant_id IS NOT NULL
      AND COALESCE(bf.is_public, false) = false
      AND NOT EXISTS (SELECT 1 FROM bot_flow_qa bfq WHERE bfq.flow_id = bf.id)
  LOOP
    PERFORM seed_igreen_faq_pack(_r.id);
    PERFORM seed_full_objection_pack(_r.id);
    _total := _total + 1;
  END LOOP;
  RAISE NOTICE 'Backfill: % flows seeded', _total;
END;
$$;
