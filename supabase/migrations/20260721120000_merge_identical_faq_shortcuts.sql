-- Une atalhos com a MESMA resposta (FAQ_PADRAO) em 1 card + todos os gatilhos.
-- NÃO junta temas diferentes (pirâmide, cidade, etc.).

DO $$
DECLARE
  r RECORD;
  keeper_id uuid;
  orphan_id uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT flow_id FROM bot_flow_qa
    WHERE intent_name = ANY(ARRAY['Confiança · É golpe / furada','Preço · Tem taxa escondida','Técnico · Trocar de empresa','Cancelamento · Fidelidade / multa','Cadastro · Não vou mandar RG/CNH','Confiança · Não confio nessa empresa','Confiança · Nunca ouvi falar','Confiança · CNPJ / regulamentação','Confiança · Há quanto tempo existe','Preço · Pagar pra entrar','Preço · Desconto é falso','Preço · É caro / não tenho dinheiro','Preço · Vou pagar a mais no fim','Técnico · Funciona pra apartamento','Técnico · Mexer na fiação','Técnico · Placa solar / painel','Cancelamento · Como faço pra cancelar','Cancelamento · Posso cancelar quando quiser','Cancelamento · É difícil cancelar','Cadastro · Não vou mandar foto da conta','Cadastro · Por que precisam do CPF','Cadastro · E se vazarem meus dados']::text[])
  LOOP
    PERFORM public.refresh_objection_shortcut(r.flow_id, 'Confiança · É golpe / furada', '{{nome}}, entendo a desconfiança — é sua conta de luz e tem que ser sério. 😊

A *iGreen* é *100% legal*: regulamentada pela *ANEEL* (geração compartilhada, Lei 14.300/2022), *CNPJ* 44.159.238/0001-30, no mercado desde *2017*, com escritório físico e mais de *700 mil clientes*. 🌱

Você assina *energia limpa* por assinatura e recebe *desconto* previsto no contrato — *sem instalar nada* em casa, *sem fidelidade* e *sem multa*. ⚡', ARRAY['é golpe','isso é golpe','parece golpe','parece furada','é furada','é enganação','é fraude','é picaretagem','não confio','nao confio','desconfio de vocês','desconfio de voce','não confio nisso','suspeito de vocês','nunca ouvi falar','não conheço a igreen','nao conheco a igreen','primeira vez que ouço','quem é a igreen','qual o cnpj','cnpj da igreen','é regulamentado','regulamentado pela aneel','autorizado pela aneel','empresa legal','há quanto tempo existe','quantos anos de mercado','quando foi fundada','quando começou','quanto tempo no mercado']::text[]);
    PERFORM public.refresh_objection_shortcut(r.flow_id, 'Preço · Tem taxa escondida', '{{nome}}, sobre custo: *zero adesão*, *zero taxa escondida*, *zero mensalidade extra*. 😊

Você *não paga pra entrar* e *não paga a mais* no fim do mês. A fatura *iGreen* *substitui* parte da conta da concessionária (já com *desconto* contratualizado) — *não soma*. ⚡

O percentual fica *claro no contrato antes de assinar*. Se não vier como combinado, a *iGreen* corrige. Sem pegadinha, sem letra miúda. 🌱', ARRAY['taxa escondida','tem custo extra','tem pegadinha','letra miúda','custo oculto','tem surpresa na conta','pagar pra entrar','tem adesão','custo de adesão','taxa de entrada','tem mensalidade','desconto falso','desconto é mentira','propaganda enganosa','isso não é verdade','mentira esse desconto','tô sem dinheiro','to sem dinheiro','muito caro','estou apertado','sem grana','tô quebrado','vou pagar mais','vai sair mais caro','conta vai dobrar','vai somar mais','conta vai crescer']::text[]);
    PERFORM public.refresh_objection_shortcut(r.flow_id, 'Técnico · Trocar de empresa', '{{nome}}, funciona assim: você *não troca de concessionária* e *não tem obra* em casa. 😊

A energia continua chegando pela mesma empresa da sua cidade. A *iGreen* só injeta *energia limpa* na rede e aplica o *desconto* na fatura — *sem placa* no telhado. ⚡

Serve pra *apartamento*, casa ou comércio, desde que a *conta de luz* esteja no seu nome. 🌱', ARRAY['trocar de empresa','mudar de concessionária','sair da enel','trocar fornecedor','mexer na fiação','técnico em casa','obra na minha casa','instalação em casa','vão instalar algo','placa solar','painel no telhado','instalar placa','painel solar','equipamento no telhado','funciona em apartamento','funciona no apartamento','funciona em condomínio','funciona no prédio']::text[]);
    PERFORM public.refresh_objection_shortcut(r.flow_id, 'Cancelamento · Fidelidade / multa', '{{nome}}, pode ficar tranquilo: *zero fidelidade* e *zero multa*. 😊

Cancela quando quiser pelo *app* da iGreen ou pelo *WhatsApp* do atendimento — o encerramento leva de *30 a 90 dias*, *sem taxa*. 🌱

Não fica amarrado: o contrato deixa isso explícito desde o início. ⚡', ARRAY['tem fidelidade','contrato com multa','fico amarrado','prazo de contrato','contrato preso','pago multa para cancelar','posso cancelar quando quiser','quero cancelar','quero desistir','quero encerrar','como faço pra cancelar','como cancelar o contrato','processo de cancelamento','é difícil cancelar','não conseguem cancelar','difícil de cancelar','demora pra cancelar','atendimento não responde']::text[]);
    PERFORM public.refresh_objection_shortcut(r.flow_id, 'Cadastro · Não vou mandar RG/CNH', '{{nome}}, sem pressa com o documento. 😊

RG/CNH (e os dados do cadastro) são exigência da *ANEEL* pra te cadastrar como *titular*. Vão direto pra plataforma segura da *iGreen* — *não ficam comigo* — e são protegidos pela *LGPD*. 🌱

É o mesmo tipo de segurança de qualquer contratação de energia séria. ⚡', ARRAY['não vou mandar documento','não mando rg','não mando cnh','não envio identidade','não mando doc','não vou mandar foto','não mando foto da conta','privacidade da conta','não envio a conta','por que precisa do cpf','por que pedem cpf','dados pessoais meus','privacidade dos dados','vão vazar meus dados','medo de vazar dados','segurança dos dados','dados protegidos','proteção lgpd']::text[]);

    -- Remove cards órfãos (mesma resposta, agora fundidos no canônico)
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Confiança · Não confio nessa empresa';
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Confiança · Nunca ouvi falar';
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Confiança · CNPJ / regulamentação';
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Confiança · Há quanto tempo existe';
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Preço · Pagar pra entrar';
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Preço · Desconto é falso';
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Preço · É caro / não tenho dinheiro';
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Preço · Vou pagar a mais no fim';
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Técnico · Funciona pra apartamento';
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Técnico · Mexer na fiação';
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Técnico · Placa solar / painel';
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Cancelamento · Como faço pra cancelar';
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Cancelamento · Posso cancelar quando quiser';
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Cancelamento · É difícil cancelar';
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Cadastro · Não vou mandar foto da conta';
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Cadastro · Por que precisam do CPF';
    DELETE FROM bot_flow_qa WHERE flow_id = r.flow_id AND intent_name = 'Cadastro · E se vazarem meus dados';
  END LOOP;
END $$;
