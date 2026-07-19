-- Refresh atalhos Sofia Grupo A (textos formatados + gatilhos revisados)
CREATE OR REPLACE FUNCTION public.refresh_objection_shortcut(
  _flow_id uuid,
  _intent_name text,
  _text_response text,
  _triggers text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _qa_id uuid;
  _phrase text;
BEGIN
  SELECT id INTO _qa_id FROM bot_flow_qa
  WHERE flow_id = _flow_id AND intent_name = _intent_name
  LIMIT 1;

  IF _qa_id IS NULL THEN
    RAISE EXCEPTION 'QA não encontrado: % no flow %', _intent_name, _flow_id;
  END IF;

  UPDATE bot_flow_qa
  SET text_response = NULLIF(_text_response, ''),
      updated_at = now()
  WHERE id = _qa_id;

  DELETE FROM bot_flow_qa_triggers WHERE qa_id = _qa_id;

  FOREACH _phrase IN ARRAY _triggers LOOP
    IF length(trim(_phrase)) > 0 THEN
      INSERT INTO bot_flow_qa_triggers (qa_id, phrase) VALUES (_qa_id, trim(_phrase));
    END IF;
  END LOOP;

  RETURN _qa_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_objection_shortcut(uuid, text, text, text[]) TO authenticated;

SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · É golpe / furada', 'Imagina, {{nome}} 😅

Entendo seu receio — é normal desconfiar. 🌱

A *iGreen* é regulamentada pela *ANEEL*, tem *CNPJ* 28.152.342/0001-89, escritório físico e mais de *700 mil clientes* ativos. ⚡

Funciona assim: você assina *energia limpa* por assinatura e recebe *desconto* na conta — *sem instalar nada* em casa.', ARRAY['é golpe','isso é golpe','parece golpe','golpe','furada','enganação','fraude','picaretagem']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · Não confio nessa empresa', 'Faz total sentido desconfiar, {{nome}} 😊

É sua *conta de luz* — tem que ser sério mesmo. 🌱

A *iGreen* existe desde *2017*, é parceira de geradoras autorizadas pela *ANEEL* e opera com *CNPJ* regular. ⚡

O *desconto* vem no contrato, com percentual definido antes de você assinar.', ARRAY['não confio','nao confio','desconfio de vocês','desconfio de voce','não confio nisso','suspeito de vocês']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · Nunca ouvi falar', 'Tranquilo, {{nome}}! 😊

A *iGreen* atua há *7+ anos* no Brasil, com escritório físico e mais de *100 mil clientes*. 🌱

É *energia limpa* por assinatura: você economiza na conta *sem obra* e *sem equipamento* em casa. ⚡', ARRAY['nunca ouvi falar','não conheço a igreen','nao conheco a igreen','primeira vez que ouço','quem é a igreen']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · Reclame Aqui', 'Boa pergunta, {{nome}} 😊

Toda empresa grande tem reclamação — o que conta é *como resolve*. 🌱

A *iGreen* mantém índice alto de solução e responde publicamente quando precisa. ⚡

Isso não muda o benefício: *desconto real* na sua conta, com regras claras no contrato.', ARRAY['reclame aqui','no reclame aqui','tem reclamação','mal falaram de vocês']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · CNPJ / regulamentação', 'Sim, {{nome}}! 😊

*CNPJ* 28.152.342/0001-89, regulada pela *ANEEL* na modalidade de *geração compartilhada* (Lei 14.300/2022). 🌱

*100% legal* — o *desconto* é previsto no contrato antes da assinatura. ⚡', ARRAY['qual o cnpj','cnpj da igreen','é regulamentado','regulamentado pela aneel','autorizado pela aneel','empresa legal']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · Há quanto tempo existe', 'A *iGreen* está no mercado desde *2017*, {{nome}} 😊

São mais de *7 anos* operando *energia limpa* por assinatura no Brasil. 🌱⚡

Empresa consolidada, com milhares de clientes ativos em todo o país.', ARRAY['há quanto tempo existe','quantos anos de mercado','quando foi fundada','quando começou','quanto tempo no mercado']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · Onde fica a sede', 'A sede administrativa fica em *Cuiabá-MT*, {{nome}} 😊

A *iGreen* tem presença nacional e atendimento digital em todo o Brasil. 🌱

Você resolve tudo por aqui, no *WhatsApp* — *sem precisar ir a lugar nenhum*. ⚡', ARRAY['onde fica a sede','endereço da empresa','qual o endereço','onde fica o escritório','localização da sede']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · Quem é o dono', 'A *iGreen* é fundada e dirigida pelo empresário *Beto Bahia*, {{nome}} 😊

Empresa privada, *100% brasileira*, focada em *energia limpa* acessível. 🌱⚡', ARRAY['quem é o dono','quem é o fundador','quem é o ceo','quem é o proprietário','quem são os sócios']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Preço · É caro / não tenho dinheiro', 'Pelo contrário, {{nome}} 😊

Você *não paga nada a mais*. Só passa a pagar uma fatura *iGreen menor* no lugar da parte de energia da concessionária. ⚡

*Sem custo* de adesão, *sem instalação*, *sem mensalidade*. 🌱', ARRAY['tô sem dinheiro','to sem dinheiro','muito caro','estou apertado','sem grana','tô quebrado']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Preço · Quanto economizo de verdade', 'Em média *12% a 20% de desconto* sobre o valor da sua conta, {{nome}} 😊⚡

O percentual exato depende da sua distribuidora e consumo — no cadastro eu já calculo o valor real pra você. 🌱

Tudo fica *previsto no contrato* antes de assinar.', ARRAY['quanto vou economizar','quanto economizo','qual a economia real','quanto vou poupar','comprovar a economia']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Preço · Desconto é falso', 'Entendo a desconfiança, {{nome}} 😊

O *desconto* vem *contratualizado* — você assina prevendo o percentual exato. 🌱

Se não vier como combinado, a *iGreen* é obrigada a devolver. ⚡

Transparência total, sem letra miúda.', ARRAY['desconto falso','desconto é mentira','propaganda enganosa','isso não é verdade','mentira esse desconto']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Preço · Tem taxa escondida', '*Zero taxa escondida*, {{nome}} 😊

Você paga só a fatura mensal da *iGreen* (já com *desconto*). ⚡

*Sem adesão*, *sem instalação*, *sem fidelidade*. Tudo está no contrato. 🌱', ARRAY['taxa escondida','tem custo extra','tem pegadinha','letra miúda','custo oculto','tem surpresa na conta']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Preço · Vou pagar a mais no fim', 'Não, {{nome}} 😊

A fatura *iGreen* *substitui* parte da fatura da concessionária — *não soma*. ⚡

No fim do mês você paga *menos* do que pagava antes. 🌱', ARRAY['vou pagar mais','vai sair mais caro','conta vai dobrar','vai somar mais','conta vai crescer']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Preço · Tarifa subir', 'Boa, {{nome}}! 😊

Se a tarifa da concessionária subir, sua *economia aumenta* — porque o *desconto* é percentual sobre o valor cheio. ⚡

Você se protege do aumento. 🌱', ARRAY['se a tarifa subir','tarifa vai subir','bandeira vermelha','reajuste da tarifa','se aumentar a conta']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Preço · Pagar pra entrar', '*Zero*, {{nome}} 😊

Adesão *gratuita*, *sem mensalidade*, *sem instalação*. 🌱

Você só passa a pagar a fatura mensal que já paga — só que com *desconto*. ⚡', ARRAY['pagar pra entrar','tem adesão','custo de adesão','taxa de entrada','tem mensalidade']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cobrança · Cobrar duas vezes', 'Não é dobrado, {{nome}} 😊

A conta da concessionária vem com *valor menor* (só impostos/disponibilidade) e a fatura *iGreen* vem com a energia. ⚡

Somando as duas, dá *menos* que antes. 🌱', ARRAY['cobrar duas vezes','vão cobrar duas vezes','conta dobrada','duas faturas','pagar em dobro']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cobrança · Conta da concessionária', 'Continua chegando, {{nome}} 😊

Mas com *valor bem menor* (só a taxa de disponibilidade da rede). ⚡

A energia em si passa a vir da *iGreen*, mais barata. 🌱', ARRAY['conta da concessionária','conta da enel','conta da cemig','conta da light','conta equatorial','conta coelba','conta neoenergia']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cobrança · Vencimento do boleto', 'Você escolhe o melhor dia, {{nome}}! 😊

Dia *5, 10, 15, 20 ou 25*. ⚡

O boleto chega por *WhatsApp* e *e-mail* — simples e organizado. 🌱', ARRAY['quando vence o boleto','data de vencimento','qual o vencimento','dia do vencimento']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cobrança · Forma de pagamento', '*Boleto*, *Pix* ou *débito automático*, {{nome}}! 😊

Você escolhe o que for melhor no cadastro. ⚡🌱', ARRAY['como posso pagar','forma de pagamento','aceita pix','débito automático','paga no cartão']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cobrança · E se eu atrasar', 'Se atrasar, é como qualquer boleto: pequena multa de *2%* + juros de mora, {{nome}} 😊

Você recebe *lembretes* antes do vencimento pra não esquecer. ⚡🌱', ARRAY['e se eu atrasar','se atrasar o pagamento','multa por atraso','juros por atraso']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cobrança · Vão me negativar', 'Só em caso de inadimplência prolongada (*90+ dias*), igual qualquer fatura, {{nome}} 😊

Pagando normal, *zero risco*. ⚡🌱', ARRAY['vão me negativar','vai pro serasa','nome no spc','nome sujo']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Técnico · Trocar de empresa', 'Você *não troca de empresa*, {{nome}} 😊

A concessionária continua entregando a energia em casa. 🌱

A *iGreen* só fornece a *energia limpa* que vai pra rede. *Nada muda* na sua casa. ⚡', ARRAY['trocar de empresa','mudar de concessionária','sair da enel','trocar fornecedor']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Técnico · Mexer na fiação', '*Zero obra*, {{nome}}! 😊

Ninguém vai na sua casa — não mexemos em nada. 🌱

Tudo é feito na conta: a *energia limpa* vai pra rede e abate a sua. ⚡', ARRAY['mexer na fiação','técnico em casa','obra na minha casa','instalação em casa','vão instalar algo']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Técnico · E se faltar luz', 'Faltou luz? Você liga pra *concessionária* igual antes, {{nome}} 😊

A entrega da energia continua sendo dela. ⚡

A *iGreen* só aplica o *desconto* na fatura. 🌱', ARRAY['se faltar luz','e se faltar energia','apagão','ficar sem energia']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Técnico · Placa solar / painel', 'Nada disso, {{nome}}! 😊

As usinas solares são da *iGreen*, longe da sua casa. 🌱

Você só recebe o *desconto* — *sem placa*, sem inversor, sem nada no telhado. ⚡', ARRAY['placa solar','painel no telhado','instalar placa','painel solar','equipamento no telhado']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Técnico · E se eu mudar de casa', 'Sem problema, {{nome}}! 😊

Se ficar na mesma área de concessionária, a *iGreen* acompanha. 🌱

Se mudar de estado, é só avisar — *sem multa*. ⚡', ARRAY['se eu mudar de casa','mudança de endereço','vou me mudar','novo endereço']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Técnico · Funciona pra apartamento', 'Funciona sim, {{nome}}! 😊

Apartamento, casa, comércio — qualquer imóvel com *conta de luz* no seu nome serve. 🌱⚡', ARRAY['funciona em apartamento','funciona no apartamento','funciona em condomínio','funciona no prédio']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Técnico · Funciona na minha cidade', 'A *iGreen* atende a maioria das regiões do Brasil, {{nome}} 😊

No cadastro eu confirmo na hora se sua distribuidora está elegível. 🌱⚡

É rápido — uns *10 minutos* e você já sabe se compensa.', ARRAY['atende na minha cidade','atende minha região','tem cobertura aqui','funciona na minha cidade','atendem na minha cidade']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cancelamento · Quanto demora pra começar', 'Em até *60 dias*, {{nome}}, o *desconto* já aparece na sua próxima fatura. ⚡

O cadastro leva uns *10 minutos* hoje. 😊🌱', ARRAY['quando começa o desconto','quanto demora pra começar','prazo para começar','demora pra ativar']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cancelamento · Fidelidade / multa', '*Zero fidelidade*, {{nome}}! 😊

Cancela quando quiser — *sem multa*, sem burocracia. 🌱

É só avisar pelo app. ⚡', ARRAY['tem fidelidade','contrato com multa','fico amarrado','prazo de contrato','contrato preso']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cancelamento · Posso cancelar quando quiser', 'Sempre, {{nome}}! 😊

*Sem multa*, *sem fidelidade*. 🌱

Cancelamento em até *30 dias* após solicitar. ⚡', ARRAY['posso cancelar quando quiser','quero cancelar','quero desistir','quero encerrar']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cancelamento · Como faço pra cancelar', 'Pelo app da *iGreen* ou pelo *WhatsApp* do atendimento, {{nome}} 😊

Em até *30 dias* o contrato encerra — *sem multa*. 🌱⚡', ARRAY['como faço pra cancelar','como cancelar o contrato','processo de cancelamento']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cancelamento · Quero desistir (7 dias)', 'Tranquilo, {{nome}}! 😊

Você tem *7 dias de arrependimento* por lei (CDC). 🌱

Só precisa avisar por escrito que cancela *sem nenhum custo*. ⚡', ARRAY['direito de arrependimento','arrependimento em 7 dias','desistir em sete dias','cancelar em 7 dias']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cancelamento · Vou pensar / depois', 'Claro, {{nome}}! 😊

Sem pressa — pensa com calma. 🌱

Quando quiser retomar, é só me chamar aqui mesmo. ⚡

Se já estiver decidido, dá pra continuar agora em poucos minutos.', ARRAY['vou pensar','me fala depois','te aviso depois','vou ver com minha esposa','vou ver com meu marido','falo amanhã']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cadastro · Não vou mandar foto da conta', 'Entendo, {{nome}} 😊

Esse passo serve só pra confirmar o *titular* e o *valor* da conta — exigência da *ANEEL* no cadastro. ⚡

Os dados vão direto pra plataforma segura da *iGreen*, protegidos pela *LGPD*. 🌱', ARRAY['não vou mandar foto','não mando foto da conta','privacidade da conta','não envio a conta']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cadastro · Não vou mandar RG/CNH', 'Sem pressa, {{nome}} 😊

O documento é exigência da *ANEEL* pra cadastrar você como titular. 🌱

Vai direto pra plataforma segura da *iGreen* — não fica comigo, e tudo é protegido pela *LGPD*. ⚡', ARRAY['não vou mandar documento','não mando rg','não mando cnh','não envio identidade','não mando doc']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cadastro · Por que precisam do CPF', 'Pra cadastrar você como titular da conta na *iGreen*, {{nome}} — igual qualquer contratação de energia. 😊

Dados ficam protegidos pela *LGPD*, com criptografia e controle de acesso. 🌱⚡', ARRAY['por que precisa do cpf','por que pedem cpf','dados pessoais meus','privacidade dos dados']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cadastro · E se vazarem meus dados', 'A *iGreen* segue a *LGPD* à risca, {{nome}} 😊

Dados criptografados, servidores seguros — e você pode pedir exclusão a qualquer momento. 🌱⚡', ARRAY['vão vazar meus dados','medo de vazar dados','segurança dos dados','dados protegidos','proteção lgpd']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cadastro · Quero falar com humano', 'Claro, {{nome}}! 😊

Vou chamar alguém do *time* pra te atender com calma. 🌱

Em instantes te respondem por aqui 🙌

Se preferir seguir pelo cadastro agora, é só dizer *pode seguir*. ⚡', ARRAY['falar com humano','quero um atendente','falar com alguém','quero uma pessoa','falar com consultor','falar com vendedor']::text[]);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cadastro · Conhecer presencialmente', 'Tudo é *100% digital*, {{nome}}! 😊

Você resolve pelo *WhatsApp* — *sem sair de casa* e *sem ir a escritório*. 🌱

Explico cada passo aqui e você acompanha tudo em tempo real. ⚡', ARRAY['quero conhecer presencialmente','posso ir no escritório','reunião presencial','ir até vocês','atendimento presencial']::text[]);

-- Total: 40 QAs, 196 gatilhos
