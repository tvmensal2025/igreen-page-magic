-- ============================================================================
-- Pacote iGreen FAQ — 15 atalhos rápidos curados, reutilizáveis em qualquer fluxo
-- ============================================================================
-- Estes 15 atalhos foram curados em produção (textos editados pela equipe).
-- Antes viviam apenas no Fluxo A de um consultor e sumiam ao recriar fluxos.
--
-- Esta migration:
--   1. Cria a RPC `seed_igreen_faq_pack(_flow_id)` — fonte única de verdade dos
--      15 atalhos. Idempotente (reusa `seed_objection_shortcut`, que pula
--      intent_name já existente). Pode ser chamada pela UI (botão) para semear
--      o pacote em QUALQUER fluxo novo.
--   2. Aplica o pacote no Fluxo D atual (320bf22c…) para travar o estado.
--
-- Observação: os textos são preservados EXATAMENTE como estão em produção,
-- inclusive ajustes manuais (ex.: "700 mil clientes", "que vc ja paga").

CREATE OR REPLACE FUNCTION public.seed_igreen_faq_pack(_flow_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _added integer := 0;
  _qa_id uuid;
  _before integer;
BEGIN
  SELECT count(*) INTO _before FROM bot_flow_qa WHERE flow_id = _flow_id;

  -- ── Confiança ──────────────────────────────────────────────────────────
  PERFORM seed_objection_shortcut(_flow_id, 'Confiança · É golpe / furada',
    'Imagina, {{nome}} 😅 entendo seu receio, é normal. A iGreen é regulamentada pela ANEEL, tem CNPJ, escritório físico e mais de 700 mil clientes ativos. ',
    ARRAY['golpe','furada','enganação','fraude','scam','picaretagem']);

  PERFORM seed_objection_shortcut(_flow_id, 'Confiança · Não confio nessa empresa',
    'Faz total sentido desconfiar, {{nome}}. É sua conta de luz, tem que ser sério mesmo. A iGreen existe desde 2017, é parceira de geradoras autorizadas pela ANEEL. Quer ver nosso CNPJ e endereço?',
    ARRAY['não confio','desconfio','suspeito','estranho','duvido']);

  PERFORM seed_objection_shortcut(_flow_id, 'Confiança · Reclame Aqui',
    'Boa pergunta, {{nome}}. Toda empresa grande tem reclamação — o que conta é como resolve. Nosso índice de solução é alto e respondemos publicamente. Posso te enviar o print da nossa página?',
    ARRAY['reclame aqui','reclamação','mal falaram']);

  PERFORM seed_objection_shortcut(_flow_id, 'Confiança · CNPJ / regulamentação',
    '{{nome}}! CNPJ 28.152.342/0001-89, regulada pela ANEEL na modalidade de geração compartilhada (Lei 14.300/2022). 100% legal.',
    ARRAY['cnpj','regulamentado','aneel']);

  -- ── Preço ──────────────────────────────────────────────────────────────
  PERFORM seed_objection_shortcut(_flow_id, 'Preço · Desconto é falso',
    'Entendo a desconfiança, {{nome}}. O desconto vem CONTRATUALIZADO — você assina prevendo o percentual exato. Se não vier, a iGreen é obrigada a devolver. Quer ver o contrato modelo?',
    ARRAY['desconto falso','mentira','propaganda enganosa','não é verdade']);

  PERFORM seed_objection_shortcut(_flow_id, 'Preço · Tem taxa escondida',
    'Zero taxa escondida, {{nome}}. Você paga só a fatura mensal da iGreen (já com desconto). Sem adesão, sem instalação, sem fidelidade. Tudo está no contrato.',
    ARRAY['taxa escondida','custo extra','surpresa','oculta','letra miúda','pegadinha']);

  PERFORM seed_objection_shortcut(_flow_id, 'Preço · Pagar pra entrar',
    'Zero, {{nome}}. Adesão gratuita, sem mensalidade, sem instalação. Você só passa a pagar a fatura mensal  que vc ja paga mas com desconto.',
    ARRAY['pagar pra entrar','adesão','taxa inicial','mensalidade','custo entrada']);

  -- ── Técnico ────────────────────────────────────────────────────────────
  PERFORM seed_objection_shortcut(_flow_id, 'Técnico · Trocar de empresa',
    'Você NÃO troca de empresa, {{nome}}. A concessionária continua entregando a energia em casa. A iGreen só FORNECE a energia limpa que vai pra rede. Nada muda na sua casa.',
    ARRAY['trocar empresa','mudar concessionária','sair da enel','trocar fornecedor']);

  PERFORM seed_objection_shortcut(_flow_id, 'Técnico · E se faltar luz',
    'Faltou luz? Você liga pra concessionária igual antes, {{nome}}. A entrega da energia continua sendo dela. A iGreen só desconta na fatura.',
    ARRAY['faltar luz','apagão','blackout','sem energia']);

  PERFORM seed_objection_shortcut(_flow_id, 'Técnico · E se eu mudar de casa',
    'Sem problema, {{nome}}! Se ficar na mesma área de concessionária, a iGreen acompanha. Se mudar de estado, é só avisar — sem multa.',
    ARRAY['mudar casa','mudança','novo endereço','me mudar']);

  PERFORM seed_objection_shortcut(_flow_id, 'Técnico · Funciona pra apartamento',
    'Funciona sim, {{nome}}! Apartamento, casa, comércio — qualquer imóvel com conta de luz no seu nome serve.',
    ARRAY['apartamento','prédio','condomínio','ap']);

  -- ── Cancelamento ─────────────────────────────────────────────────────────
  PERFORM seed_objection_shortcut(_flow_id, 'Cancelamento · Fidelidade / multa',
    'ZERO fidelidade, {{nome}}! Cancela quando quiser, sem multa, sem burocracia. É só avisar pelo app.',
    ARRAY['fidelidade','multa','contrato preso','amarrado','prazo de contrato']);

  PERFORM seed_objection_shortcut(_flow_id, 'Cancelamento · Como faço pra cancelar',
    'Pelo app da iGreen ou pelo WhatsApp do atendimento. Em até 30 dias o contrato encerra, sem multa.',
    ARRAY['como cancelar','processo cancelar','passo a passo cancelar']);

  -- ── Cadastro ─────────────────────────────────────────────────────────────
  PERFORM seed_objection_shortcut(_flow_id, 'Cadastro · Não vou mandar RG/CNH',
    'Sem pressa, {{nome}}. O documento é exigência da ANEEL pra cadastrar você como titular. É enviado direto pra plataforma segura da iGreen — não fica comigo.',
    ARRAY['documento não','rg não','cnh não','identidade não','não mando doc']);

  PERFORM seed_objection_shortcut(_flow_id, 'Cadastro · E se vazarem meus dados',
    'A iGreen segue a LGPD à risca, {{nome}}. Dados criptografados, servidores seguros, e você pode pedir exclusão a qualquer momento.',
    ARRAY['vazar dados','lgpd']);

  SELECT count(*) - _before INTO _added FROM bot_flow_qa WHERE flow_id = _flow_id;
  RETURN _added;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_igreen_faq_pack(uuid) TO authenticated;

-- Aplica o pacote ao Fluxo D atual (idempotente).
SELECT public.seed_igreen_faq_pack('320bf22c-e383-4f53-a3c0-b88b89b02558');
