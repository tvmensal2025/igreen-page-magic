-- ============================================================================
-- Atalhos Sofia A v3 — textos profissionais + lacunas áudio/vídeo por QA
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_qa_media_slots(
  _qa_id uuid,
  _kinds text[] DEFAULT ARRAY['audio','video']::text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _kind text;
  _pos int;
BEGIN
  IF _qa_id IS NULL THEN RETURN; END IF;

  FOREACH _kind IN ARRAY _kinds LOOP
    IF _kind NOT IN ('audio', 'video', 'image') THEN CONTINUE; END IF;

    IF EXISTS (
      SELECT 1 FROM bot_flow_qa_media
      WHERE qa_id = _qa_id AND media_kind = _kind
    ) THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(MAX(position), -1) + 1 INTO _pos
    FROM bot_flow_qa_media WHERE qa_id = _qa_id;

    INSERT INTO bot_flow_qa_media (qa_id, position, media_kind, media_id, slot_key)
    VALUES (_qa_id, _pos, _kind, NULL, NULL);
  END LOOP;
END;
$$;

-- seed: cria QA + triggers + lacunas (se ainda não existir)
CREATE OR REPLACE FUNCTION public.seed_objection_shortcut(
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
  _next_pos int;
  _phrase text;
BEGIN
  SELECT id INTO _qa_id FROM bot_flow_qa
  WHERE flow_id = _flow_id AND intent_name = _intent_name
  LIMIT 1;

  IF _qa_id IS NOT NULL THEN
    PERFORM public.ensure_qa_media_slots(_qa_id);
    RETURN _qa_id;
  END IF;

  SELECT COALESCE(MAX(position), -1) + 1 INTO _next_pos
  FROM bot_flow_qa WHERE flow_id = _flow_id;

  INSERT INTO bot_flow_qa (flow_id, position, intent_name, is_opening, is_closing, text_response)
  VALUES (_flow_id, _next_pos, _intent_name, false, false, NULLIF(_text_response, ''))
  RETURNING id INTO _qa_id;

  FOREACH _phrase IN ARRAY _triggers LOOP
    IF length(trim(_phrase)) > 0 THEN
      INSERT INTO bot_flow_qa_triggers (qa_id, phrase) VALUES (_qa_id, trim(_phrase));
    END IF;
  END LOOP;

  PERFORM public.ensure_qa_media_slots(_qa_id);
  RETURN _qa_id;
END;
$$;

-- refresh: atualiza texto + triggers e garante lacunas (não apaga mídia já preenchida)
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
    -- cria se ainda não existir (novos atalhos)
    _qa_id := public.seed_objection_shortcut(_flow_id, _intent_name, _text_response, _triggers);
    RETURN _qa_id;
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

  PERFORM public.ensure_qa_media_slots(_qa_id);
  RETURN _qa_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_qa_media_slots(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_objection_shortcut(uuid, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_objection_shortcut(uuid, text, text, text[]) TO authenticated;

SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · É golpe / furada', 'Imagina, {{nome}} 😅

Entendo seu receio — é normal desconfiar. 🌱

A *iGreen* é regulamentada pela *ANEEL*, tem *CNPJ* 44.159.238/0001-30, escritório físico e mais de *700 mil clientes* ativos. ⚡

Você assina *energia limpa* por assinatura e recebe *desconto* na conta — *sem instalar nada* em casa.', ARRAY['é golpe','isso é golpe','parece golpe','golpe','furada','enganação','fraude','picaretagem']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Confiança · É golpe / furada' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · Não confio nessa empresa', 'Faz total sentido desconfiar, {{nome}} 😊

É sua *conta de luz* — tem que ser sério mesmo. 🌱

A *iGreen* existe desde *2017*, é parceira de geradoras autorizadas pela *ANEEL* e opera com *CNPJ* regular (44.159.238/0001-30). ⚡

O *desconto* vem no contrato, com percentual definido *antes* de você assinar.', ARRAY['não confio','nao confio','desconfio de vocês','desconfio de voce','não confio nisso','suspeito de vocês']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Confiança · Não confio nessa empresa' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · Nunca ouvi falar', 'Tranquilo, {{nome}}! 😊

A *iGreen* atua desde *2017* no Brasil, com escritório físico e mais de *700 mil clientes*. 🌱

É *energia limpa* por assinatura: você economiza na conta *sem obra* e *sem equipamento* em casa. ⚡', ARRAY['nunca ouvi falar','não conheço a igreen','nao conheco a igreen','primeira vez que ouço','quem é a igreen']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Confiança · Nunca ouvi falar' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · Reclame Aqui', 'Boa pergunta, {{nome}} 😊

No *Reclame Aqui* a *iGreen* aparece como empresa *verificada*, com reputação *Boa* e alto índice de *solução* das reclamações. 🌱

Toda empresa grande recebe reclamação — o que importa é *responder* e *resolver*. ⚡

Antes de assinar, o contrato deixa claro: *sem fidelidade*, *sem multa* e cancelamento pelo app ou WhatsApp.', ARRAY['reclame aqui','no reclame aqui','tem reclamação','mal falaram de vocês','vi reclamação','vi no reclame aqui','reputação no reclame']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Confiança · Reclame Aqui' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · CNPJ / regulamentação', 'Sim, {{nome}}! 😊

*CNPJ* 44.159.238/0001-30, regulada pela *ANEEL* na modalidade de *geração compartilhada* (Lei 14.300/2022). 🌱

*100% legal* — o *desconto* fica previsto no contrato antes da assinatura. ⚡', ARRAY['qual o cnpj','cnpj da igreen','é regulamentado','regulamentado pela aneel','autorizado pela aneel','empresa legal']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Confiança · CNPJ / regulamentação' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · Há quanto tempo existe', 'A *iGreen* está no mercado desde *2017*, {{nome}} 😊

São mais de *7 anos* operando *energia limpa* por assinatura no Brasil. 🌱⚡

Empresa consolidada, com centenas de milhares de clientes ativos.', ARRAY['há quanto tempo existe','quantos anos de mercado','quando foi fundada','quando começou','quanto tempo no mercado']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Confiança · Há quanto tempo existe' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · Onde fica a sede', 'A sede administrativa fica em *Cuiabá-MT*, {{nome}} 😊

A *iGreen* tem presença nacional e atendimento digital em todo o Brasil. 🌱

Você resolve tudo por aqui, no *WhatsApp* — *sem precisar ir a lugar nenhum*. ⚡', ARRAY['onde fica a sede','endereço da empresa','qual o endereço','onde fica o escritório','localização da sede']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Confiança · Onde fica a sede' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · Quem é o dono', 'A *iGreen* é fundada e dirigida pelo empresário *Beto Bahia*, {{nome}} 😊

Empresa privada, *100% brasileira*, focada em *energia limpa* acessível. 🌱⚡', ARRAY['quem é o dono','quem é o fundador','quem é o ceo','quem é o proprietário','quem são os sócios']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Confiança · Quem é o dono' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Confiança · É pirâmide / multinível', 'Não, {{nome}} 😊

Pirâmide *não entrega produto real*. Aqui o produto é *energia limpa* na sua conta, com contrato e *CNPJ* (44.159.238/0001-30). 🌱

Há consultores parceiros, mas *você* só contrata o *desconto* na luz — sem obrigação de indicar ninguém. ⚡', ARRAY['é pirâmide','piramide','é multinível','marketing multinível','esquema de pirâmide','parece pirâmide']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Confiança · É pirâmide / multinível' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Preço · É caro / não tenho dinheiro', 'Pelo contrário, {{nome}} 😊

Você *não paga nada a mais*. Só passa a pagar uma fatura *iGreen menor* no lugar da parte de energia da concessionária. ⚡

*Sem custo* de adesão, *sem instalação*, *sem mensalidade extra*. 🌱', ARRAY['tô sem dinheiro','to sem dinheiro','muito caro','estou apertado','sem grana','tô quebrado']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Preço · É caro / não tenho dinheiro' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Preço · Quanto economizo de verdade', 'Em média *12% a 20% de desconto* sobre a parte de *energia* da sua conta, {{nome}} 😊⚡

O percentual exato depende da distribuidora e do consumo — no cadastro eu já calculo o valor real pra você. 🌱

Tudo fica *previsto no contrato* antes de assinar.', ARRAY['quanto vou economizar','quanto economizo','qual a economia real','quanto vou poupar','comprovar a economia']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Preço · Quanto economizo de verdade' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Preço · Desconto é falso', 'Entendo a desconfiança, {{nome}} 😊

O *desconto* vem *contratualizado* — você assina prevendo o percentual exato. 🌱

Se não vier como combinado, a *iGreen* é obrigada a corrigir conforme o contrato. ⚡

Transparência total, sem letra miúda.', ARRAY['desconto falso','desconto é mentira','propaganda enganosa','isso não é verdade','mentira esse desconto']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Preço · Desconto é falso' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Preço · Tem taxa escondida', '*Zero taxa escondida*, {{nome}} 😊

Você paga só a fatura mensal da *iGreen* (já com *desconto*). ⚡

*Sem adesão*, *sem instalação*, *sem fidelidade*. Tudo está no contrato. 🌱', ARRAY['taxa escondida','tem custo extra','tem pegadinha','letra miúda','custo oculto','tem surpresa na conta']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Preço · Tem taxa escondida' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Preço · Vou pagar a mais no fim', 'Não, {{nome}} 😊

A fatura *iGreen* *substitui* parte da fatura da concessionária — *não soma*. ⚡

No fim do mês você paga *menos* do que pagava antes. 🌱', ARRAY['vou pagar mais','vai sair mais caro','conta vai dobrar','vai somar mais','conta vai crescer']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Preço · Vou pagar a mais no fim' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Preço · Tarifa subir', 'Boa, {{nome}}! 😊

Se a tarifa da concessionária subir, sua *economia em reais aumenta* — porque o *desconto* é percentual sobre o valor da energia. ⚡

Você se protege do aumento. 🌱', ARRAY['se a tarifa subir','tarifa vai subir','bandeira vermelha','reajuste da tarifa','se aumentar a conta']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Preço · Tarifa subir' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Preço · Pagar pra entrar', '*Zero*, {{nome}} 😊

Adesão *gratuita*, *sem mensalidade*, *sem instalação*. 🌱

Você só passa a pagar a fatura mensal que já paga — só que com *desconto*. ⚡', ARRAY['pagar pra entrar','tem adesão','custo de adesão','taxa de entrada','tem mensalidade']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Preço · Pagar pra entrar' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cobrança · Cobrar duas vezes', 'Não é dobrado, {{nome}} 😊

A conta da concessionária vem com *valor menor* (taxa de disponibilidade / impostos) e a fatura *iGreen* vem com a energia. ⚡

Somando as duas, dá *menos* que antes. 🌱', ARRAY['cobrar duas vezes','vão cobrar duas vezes','conta dobrada','duas faturas','pagar em dobro']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cobrança · Cobrar duas vezes' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cobrança · Conta da concessionária', 'Continua chegando, {{nome}} 😊

Mas com *valor bem menor* (taxa de disponibilidade da rede e itens que não abatem). ⚡

A energia em si passa a vir da *iGreen*, mais barata. 🌱', ARRAY['conta da concessionária','conta da enel','conta da cemig','conta da light','conta equatorial','conta coelba','conta neoenergia']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cobrança · Conta da concessionária' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cobrança · O que não abate na conta', 'Boa observação, {{nome}} 😊

O *desconto* vale sobre a *energia consumida*. Itens como *taxa de disponibilidade* e *iluminação pública (COSIP)* continuam na fatura da concessionária. ⚡

Mesmo assim, no total do mês você paga *menos* — e o percentual fica claro no contrato. 🌱', ARRAY['o que não abate','taxa de disponibilidade','iluminação pública','cosip','desconto na conta toda','abate na conta toda']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cobrança · O que não abate na conta' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cobrança · Vencimento do boleto', 'Você escolhe o melhor dia, {{nome}}! 😊

Dia *5, 10, 15, 20 ou 25*. ⚡

O boleto chega por *WhatsApp* e *e-mail* — simples e organizado. 🌱', ARRAY['quando vence o boleto','data de vencimento','qual o vencimento','dia do vencimento']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cobrança · Vencimento do boleto' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cobrança · Forma de pagamento', '*Boleto*, *Pix* ou *débito automático*, {{nome}}! 😊

Você escolhe o que for melhor no cadastro. ⚡🌱', ARRAY['como posso pagar','forma de pagamento','aceita pix','débito automático','paga no cartão']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cobrança · Forma de pagamento' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cobrança · E se eu atrasar', 'Se atrasar, é como qualquer boleto: pequena multa de *2%* + juros de mora, {{nome}} 😊

Você recebe *lembretes* antes do vencimento pra não esquecer. ⚡🌱', ARRAY['e se eu atrasar','se atrasar o pagamento','multa por atraso','juros por atraso']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cobrança · E se eu atrasar' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cobrança · Vão me negativar', 'Só em caso de inadimplência prolongada (*90+ dias*), igual qualquer fatura, {{nome}} 😊

Pagando normal, *zero risco*. ⚡🌱', ARRAY['vão me negativar','vai pro serasa','nome no spc','nome sujo']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cobrança · Vão me negativar' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cobrança · Cobrança após cancelar', 'Entendo a preocupação, {{nome}} 😊

Após o cancelamento, o ciclo da fatura em andamento pode ainda gerar *um boleto do período* — depois encerra. ⚡

Se aparecer cobrança indevida, o atendimento ajusta. Por isso o contrato deixa o cancelamento *sem multa* e *sem fidelidade*. 🌱', ARRAY['cobrança após cancelar','continuam cobrando','cobraram depois de cancelar','boleto depois do cancelamento','fatura após cancelamento']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cobrança · Cobrança após cancelar' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Técnico · Trocar de empresa', 'Você *não troca de empresa*, {{nome}} 😊

A concessionária continua entregando a energia em casa. 🌱

A *iGreen* só fornece a *energia limpa* que vai pra rede. *Nada muda* na sua casa. ⚡', ARRAY['trocar de empresa','mudar de concessionária','sair da enel','trocar fornecedor']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Técnico · Trocar de empresa' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Técnico · Mexer na fiação', '*Zero obra*, {{nome}}! 😊

Ninguém vai na sua casa — não mexemos em nada. 🌱

Tudo é feito na conta: a *energia limpa* vai pra rede e abate a sua. ⚡', ARRAY['mexer na fiação','técnico em casa','obra na minha casa','instalação em casa','vão instalar algo']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Técnico · Mexer na fiação' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Técnico · E se faltar luz', 'Faltou luz? Você liga pra *concessionária* igual antes, {{nome}} 😊

A entrega da energia continua sendo dela. ⚡

A *iGreen* só aplica o *desconto* na fatura. 🌱', ARRAY['se faltar luz','e se faltar energia','apagão','ficar sem energia']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Técnico · E se faltar luz' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Técnico · Placa solar / painel', 'Nada disso, {{nome}}! 😊

As usinas solares são da *iGreen*, longe da sua casa. 🌱

Você só recebe o *desconto* — *sem placa*, sem inversor, sem nada no telhado. ⚡', ARRAY['placa solar','painel no telhado','instalar placa','painel solar','equipamento no telhado']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Técnico · Placa solar / painel' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Técnico · Já tenho placa solar', 'Boa, {{nome}}! 😊

Se você *já gera* com placa própria, o modelo de assinatura *pode não compensar* — depende do seu consumo e créditos. 🌱

No cadastro eu confiro se ainda faz sentido ou se é melhor manter só o seu sistema. ⚡', ARRAY['já tenho placa','já tenho painel','já tenho solar','já tenho energia solar','tenho placa no telhado']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Técnico · Já tenho placa solar' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Técnico · E se eu mudar de casa', 'Sem problema, {{nome}}! 😊

Se ficar na mesma área de concessionária, a *iGreen* acompanha. 🌱

Se mudar de estado, é só avisar — *sem multa*. ⚡', ARRAY['se eu mudar de casa','mudança de endereço','vou me mudar','novo endereço']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Técnico · E se eu mudar de casa' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Técnico · Funciona pra apartamento', 'Funciona sim, {{nome}}! 😊

Apartamento, casa, comércio — qualquer imóvel com *conta de luz* no seu nome serve. 🌱⚡', ARRAY['funciona em apartamento','funciona no apartamento','funciona em condomínio','funciona no prédio']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Técnico · Funciona pra apartamento' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Técnico · Funciona na minha cidade', 'A *iGreen* atende a maioria das regiões do Brasil, {{nome}} 😊

No cadastro eu confirmo na hora se sua distribuidora está elegível. 🌱⚡

É rápido — uns *10 minutos* e você já sabe se compensa.', ARRAY['atende na minha cidade','atende minha região','tem cobertura aqui','funciona na minha cidade','atendem na minha cidade']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Técnico · Funciona na minha cidade' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Técnico · Mercado livre vs assinatura', 'São coisas diferentes, {{nome}} 😊

*Mercado livre* costuma ser para *empresas / alta demanda*. ⚡

A *iGreen* (grupo residencial) é *energia por assinatura* / geração compartilhada: *sem obra*, *sem fidelidade*, desconto na conta de luz comum. 🌱', ARRAY['mercado livre','é mercado livre','diferença mercado livre','energia livre','assinatura ou mercado livre']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Técnico · Mercado livre vs assinatura' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cancelamento · Quanto demora pra começar', 'Em média, o *desconto* aparece entre *60 e 90 dias* após a ativação, {{nome}} — no ciclo seguinte da fatura. ⚡

O cadastro em si leva uns *10 minutos* hoje. 😊🌱', ARRAY['quando começa o desconto','quanto demora pra começar','prazo para começar','demora pra ativar']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cancelamento · Quanto demora pra começar' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cancelamento · Fidelidade / multa', '*Zero fidelidade*, {{nome}}! 😊

Cancela quando quiser — *sem multa*, sem burocracia. 🌱

É só avisar pelo app ou WhatsApp do atendimento. ⚡', ARRAY['tem fidelidade','contrato com multa','fico amarrado','prazo de contrato','contrato preso','pago multa para cancelar']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cancelamento · Fidelidade / multa' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cancelamento · Posso cancelar quando quiser', 'Sempre, {{nome}}! 😊

*Sem multa*, *sem fidelidade*. 🌱

Cancelamento em até *30 dias* após solicitar. ⚡', ARRAY['posso cancelar quando quiser','quero cancelar','quero desistir','quero encerrar']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cancelamento · Posso cancelar quando quiser' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cancelamento · Como faço pra cancelar', 'Pelo app da *iGreen* ou pelo *WhatsApp* do atendimento, {{nome}} 😊

Em até *30 dias* o contrato encerra — *sem multa*. 🌱⚡', ARRAY['como faço pra cancelar','como cancelar o contrato','processo de cancelamento']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cancelamento · Como faço pra cancelar' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cancelamento · É difícil cancelar', 'Entendo o medo, {{nome}} 😊

No contrato: *sem fidelidade* e *sem multa*. O pedido é pelo *app* ou *WhatsApp* do atendimento, com prazo de até *30 dias*. 🌱

Se travar, você tem *Reclame Aqui* e canais oficiais — e a *iGreen* responde e resolve a maioria dos casos. ⚡', ARRAY['é difícil cancelar','não conseguem cancelar','difícil de cancelar','demora pra cancelar','atendimento não responde']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cancelamento · É difícil cancelar' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cancelamento · Quero desistir (7 dias)', 'Tranquilo, {{nome}}! 😊

Você tem *7 dias de arrependimento* por lei (CDC). 🌱

Só precisa avisar por escrito que cancela *sem nenhum custo*. ⚡', ARRAY['direito de arrependimento','arrependimento em 7 dias','desistir em sete dias','cancelar em 7 dias']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cancelamento · Quero desistir (7 dias)' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cancelamento · Vou pensar / depois', 'Claro, {{nome}}! 😊

Sem pressa — pensa com calma. 🌱

Quando quiser retomar, é só me chamar aqui mesmo. ⚡

Se já estiver decidido, dá pra continuar agora em poucos minutos.', ARRAY['vou pensar','me fala depois','te aviso depois','vou ver com minha esposa','vou ver com meu marido','falo amanhã']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cancelamento · Vou pensar / depois' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cadastro · Não vou mandar foto da conta', 'Entendo, {{nome}} 😊

Esse passo serve só pra confirmar o *titular* e o *valor* da conta — exigência da *ANEEL* no cadastro. ⚡

Os dados vão direto pra plataforma segura da *iGreen*, protegidos pela *LGPD*. 🌱', ARRAY['não vou mandar foto','não mando foto da conta','privacidade da conta','não envio a conta']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cadastro · Não vou mandar foto da conta' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cadastro · Não vou mandar RG/CNH', 'Sem pressa, {{nome}} 😊

O documento é exigência da *ANEEL* pra cadastrar você como titular. 🌱

Vai direto pra plataforma segura da *iGreen* — não fica comigo, e tudo é protegido pela *LGPD*. ⚡', ARRAY['não vou mandar documento','não mando rg','não mando cnh','não envio identidade','não mando doc']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cadastro · Não vou mandar RG/CNH' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cadastro · Por que precisam do CPF', 'Pra cadastrar você como titular da conta na *iGreen*, {{nome}} — igual qualquer contratação de energia. 😊

Dados ficam protegidos pela *LGPD*, com criptografia e controle de acesso. 🌱⚡', ARRAY['por que precisa do cpf','por que pedem cpf','dados pessoais meus','privacidade dos dados']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cadastro · Por que precisam do CPF' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cadastro · E se vazarem meus dados', 'A *iGreen* segue a *LGPD* à risca, {{nome}} 😊

Dados criptografados, servidores seguros — e você pode pedir exclusão a qualquer momento. 🌱⚡', ARRAY['vão vazar meus dados','medo de vazar dados','segurança dos dados','dados protegidos','proteção lgpd']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cadastro · E se vazarem meus dados' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cadastro · Facial / OTP / assinatura', 'Tranquilo, {{nome}} 😊

A *validação facial* e o *código OTP* são etapas de segurança do portal — confirmam que é você o titular. ⚡

Se travar, tente de novo em rede estável; se precisar, te guio no próximo passo. 🌱', ARRAY['não consigo fazer a facial','problema na facial','código otp','não recebi o otp','assinatura digital','biometria facial']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cadastro · Facial / OTP / assinatura' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cadastro · Quero falar com humano', 'Claro, {{nome}}! 😊

Vou chamar alguém do *time* pra te atender com calma. 🌱

Em instantes te respondem por aqui 🙌

Se preferir seguir pelo cadastro agora, é só dizer *pode seguir*. ⚡', ARRAY['falar com humano','quero um atendente','falar com alguém','quero uma pessoa','falar com consultor','falar com vendedor']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cadastro · Quero falar com humano' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Cadastro · Conhecer presencialmente', 'Tudo é *100% digital*, {{nome}}! 😊

Você resolve pelo *WhatsApp* — *sem sair de casa* e *sem ir a escritório*. 🌱

Explico cada passo aqui e você acompanha tudo em tempo real. ⚡', ARRAY['quero conhecer presencialmente','posso ir no escritório','reunião presencial','ir até vocês','atendimento presencial']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Cadastro · Conhecer presencialmente' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Elegibilidade · Conta mínima / valor mínimo', 'Em geral, a partir de cerca de *R$ 200/mês* já vale a pena analisar, {{nome}} 😊

Contas muito baixas têm mais custo fixo (disponibilidade / iluminação), então o *desconto* pesa menos. ⚡

No cadastro eu confirmo se sua conta encaixa. 🌱', ARRAY['valor mínimo da conta','conta mínima','qual o valor mínimo','conta muito baixa','minha conta é baixa','a partir de quanto']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Elegibilidade · Conta mínima / valor mínimo' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Elegibilidade · Conta no nome de outro', 'O cadastro precisa ser no *nome do titular* da conta de luz, {{nome}} 😊

Se a conta estiver em outro nome, a ativação segue com os dados desse titular (CPF + documento). ⚡

Posso te orientar no passo certo. 🌱', ARRAY['conta no nome de outro','outro titular','conta no nome da minha mãe','não sou o titular','conta no nome do marido','titular diferente']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Elegibilidade · Conta no nome de outro' LIMIT 1),
  ARRAY['audio','video']::text[]
);
SELECT public.refresh_objection_shortcut('59f53614-196c-4b6f-a029-59fadca78bd7', 'Elegibilidade · Casa alugada / não sou dono', 'Pode sim, {{nome}}! 😊

Como *não tem obra* nem placa no telhado, funciona em casa alugada — desde que a *conta de luz* esteja no nome de quem vai assinar. 🌱⚡', ARRAY['casa alugada','sou inquilino','não sou dono','moro de aluguel','moro alugado','imóvel alugado']::text[]);
SELECT public.ensure_qa_media_slots(
  (SELECT id FROM bot_flow_qa WHERE flow_id = '59f53614-196c-4b6f-a029-59fadca78bd7' AND intent_name = 'Elegibilidade · Casa alugada / não sou dono' LIMIT 1),
  ARRAY['audio','video']::text[]
);

-- Total: 50 QAs, 256 gatilhos, lacunas áudio+vídeo por atalho
