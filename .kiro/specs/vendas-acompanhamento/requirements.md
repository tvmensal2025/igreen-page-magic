# Requisitos — Vendas e Acompanhamento (venda única)

## Visão geral

Esta funcionalidade organiza o módulo de Produtos (catálogo, orçamento e
acompanhamento) como uma **ferramenta de proposta e fechamento**: o consultor
monta um orçamento bonito para **convencer** o cliente, envia por link, e o
cliente **aceita** (bate o martelo). O aceite é o **ponto final** do
acompanhamento neste sistema.

A **venda oficial** (cadastro do cliente, contrato, pagamento, ativação) é feita
em **outro sistema/link da própria empresa iGreen** e está **totalmente fora do
escopo** deste projeto. Aqui registramos apenas até o cliente dizer "sim".

### Princípios

- **Fluxo principal pelo WhatsApp**: o caminho central é o consultor montar a
  proposta, **enviar o link pelo WhatsApp**, o cliente abrir, **aceitar** e o
  negócio voltar marcado como fechado no painel.
- **Ferramenta de fechamento**: o orçamento serve para convencer o cliente; o
  objetivo é chegar ao aceite.
- **Acompanhar até o "sim"**: o ciclo termina quando o cliente aceita a
  proposta. O que vem depois (cadastro oficial, pagamento, ativação, pós-venda)
  é feito pela empresa, em outro lugar.
- **Venda única**: não há recorrência, mensalidade nem MRR no acompanhamento.
- **Sem cobrança**: o sistema não recebe dinheiro nem integra meio de pagamento.
- **Aproveitar o que existe**: reaproveitar as tabelas `products`, `proposals`,
  `sales` e os painéis atuais, simplificando-os em vez de reconstruir.

### Termos

- **Orçamento (proposta)**: oferta enviada ao cliente por link público, usada
  como ferramenta de convencimento/fechamento.
- **Aceite**: momento em que o cliente concorda com a proposta. É o marco final
  do acompanhamento neste sistema.
- **Registro de fechamento** (tabela `sales`): registro interno que marca que
  uma proposta foi aceita. NÃO representa o cadastro oficial da empresa.
- **Funil/pipeline**: as etapas pelas quais a proposta passa até o aceite.
- **Comissão estimada**: cálculo local e aproximado; o valor oficial é o do
  portal iGreen.
- **Cadastro oficial**: processo externo da empresa (outro link/sistema), fora
  do escopo deste projeto.

---

## Requisito 1 — Funil simplificado (até o aceite)

**História:** Como consultor, quero um funil curto e claro que vá apenas até
"Fechado" (cliente aceitou), para acompanhar minhas propostas sem etapas que são
responsabilidade da empresa.

### Critérios de aceitação

1. QUANDO o consultor visualiza o pipeline, ENTÃO o sistema DEVE exibir as
   etapas: **Interesse**, **Negociando**, **Fechado** e **Perdido**.
2. O sistema NÃO DEVE exibir etapas do cadastro oficial/pós-venda (ativação,
   captura de documentos, recusa de cadastro) no funil.
3. QUANDO uma proposta atinge a etapa **Fechado** (cliente aceitou), ENTÃO o
   sistema DEVE registrar a data do aceite e considerar o acompanhamento
   concluído. A partir daí, o cadastro oficial é feito pela empresa, fora deste
   sistema.
4. QUANDO um negócio é marcado como **Perdido**, ENTÃO o sistema DEVE permitir
   registrar um motivo (texto livre, opcional).
5. O sistema DEVE preservar o histórico de mudança de etapa para auditoria.
6. QUANDO existirem registros em etapas antigas (ex.: `capturing`, `submitted`,
   `active`), ENTÃO a migração DEVE convertê-los para as novas etapas sem perda
   de dados (ex.: todos os fechados/ativos viram **Fechado**).

---

## Requisito 2 — Registro de fechamento a partir do orçamento aceito

**História:** Como consultor, quero que o negócio seja marcado como fechado
automaticamente quando o cliente aceita meu orçamento, para não precisar
registrar nada à mão e saber que está pronto para o cadastro oficial.

### Critérios de aceitação

1. QUANDO o cliente aceita um orçamento na página pública, ENTÃO o sistema DEVE
   criar um registro de fechamento vinculado ao mesmo produto, consultor e
   cliente.
2. QUANDO o registro é criado por aceite, ENTÃO o sistema DEVE iniciá-lo na
   etapa **Fechado**, registrando a data do aceite.
3. QUANDO o orçamento já possui um registro vinculado (`sale_id`), ENTÃO o
   sistema NÃO DEVE criar um registro duplicado.
4. QUANDO o registro é criado por aceite, ENTÃO o sistema DEVE copiar o valor do
   orçamento.
5. QUANDO o cliente aceita, recusa ou contrapõe um orçamento, ENTÃO o sistema
   DEVE notificar o consultor (comportamento atual preservado).
6. QUANDO o cliente aceita, ENTÃO a notificação ao consultor DEVE deixar claro
   que o próximo passo (cadastro oficial) é feito no sistema da empresa.

> Observação: hoje o aceite cria o registro em "capturing". Como não há mais
> captura/pós-venda no escopo, o aceite deve marcar como **Fechado**
> diretamente.

---

## Requisito 3 — Registro manual de fechamento

**História:** Como consultor, quero registrar manualmente um negócio fechado,
para contabilizar acordos que aconteceram fora do fluxo de orçamento por link
(ex.: cliente fechou direto no WhatsApp ou pessoalmente).

### Critérios de aceitação

1. QUANDO o consultor cria um registro manualmente, ENTÃO o sistema DEVE exigir
   produto e permitir informar cliente, valor e observações.
2. QUANDO o consultor cria um registro manualmente, ENTÃO o sistema DEVE
   permitir escolher a etapa inicial (Interesse, Negociando ou Fechado).
3. QUANDO o consultor move um registro entre etapas, ENTÃO o sistema DEVE
   atualizar a etapa e registrar a mudança no histórico.

---

## Requisito 4 — Acompanhamento sem recorrência

**História:** Como consultor, quero um painel de acompanhamento que mostre
quantos negócios fechei e quanto vou ganhar, sem números de mensalidade que não
se aplicam.

### Critérios de aceitação

1. QUANDO o consultor abre o acompanhamento, ENTÃO o sistema DEVE exibir:
   total de negócios fechados, valor total fechado e comissão estimada total.
2. O sistema NÃO DEVE exibir métricas de receita recorrente (MRR) nem separar
   valores em "mensal" vs "único".
3. QUANDO existem orçamentos aguardando resposta, ENTÃO o sistema DEVE exibir um
   resumo do pipeline (quantidade e valor em aberto).
4. O sistema DEVE deixar explícito que a comissão é uma estimativa local e que o
   valor oficial é o do portal iGreen.
5. O acompanhamento DEVE permitir filtrar/visualizar por produto.

---

## Requisito 5 — Catálogo de produtos vendáveis

**História:** Como consultor, quero ver no catálogo apenas o que posso vender,
para não me confundir com produtos que não geram venda direta.

### Critérios de aceitação

1. QUANDO o consultor monta um orçamento, ENTÃO o sistema DEVE oferecer somente
   os produtos vendáveis (allowlist atual por slug).
2. QUANDO um produto não gera venda direta (ex.: Expansão), ENTÃO o sistema DEVE
   tratá-lo explicitamente, sem oferecer um modo de preço sem planos.
3. O sistema DEVE preservar o catálogo completo (landing, pontuação) para os
   demais usos, apenas filtrando o que aparece no seletor de orçamento.

---

## Requisito 6 — Valores monetários em centavos

**História:** Como consultor, quero que os valores sejam exatos nos relatórios,
para que a soma das vendas e a comissão estimada não tenham erros de centavos.

### Critérios de aceitação

1. O sistema DEVE armazenar todos os valores monetários como inteiros em
   centavos (ex.: `amount_cents`).
2. QUANDO um valor é exibido, ENTÃO o sistema DEVE convertê-lo para reais apenas
   na camada de apresentação.
3. QUANDO cálculos de valor/desconto/comissão são feitos, ENTÃO o sistema DEVE
   operar em centavos inteiros, arredondando somente no final.
4. QUANDO a migração roda, ENTÃO os valores existentes (`numeric`) DEVEM ser
   convertidos para centavos sem perda nem distorção.

---

## Requisito 7 — Cálculo de orçamento por família (ajustes)

**História:** Como consultor, quero que o valor do orçamento reflita as opções
escolhidas, para enviar propostas corretas ao cliente.

### Critérios de aceitação

1. QUANDO o consultor monta um orçamento de telecom sem portabilidade, ENTÃO o
   sistema DEVE usar o preço correspondente (hoje só usa o preço com
   portabilidade).
2. QUANDO o consultor registra dados de captura por família, ENTÃO o sistema
   DEVE validar os campos esperados da família antes de salvar.
3. O sistema DEVE manter os modos de precificação atuais (mensalidade, projeto
   único, estimativa de economia, mercado livre), tratando cada um corretamente.

---

## Requisito 8 — Envio da proposta pelo WhatsApp (fluxo principal)

**História:** Como consultor, quero enviar o link da proposta pelo WhatsApp e
receber o cliente de volta já com a resposta, para conduzir todo o fechamento
pela conversa.

### Critérios de aceitação

1. QUANDO o consultor finaliza a montagem do orçamento, ENTÃO o sistema DEVE
   gerar um link público único (`/proposta/:token`) e oferecer as ações
   **Enviar no WhatsApp** e **Copiar link**.
2. QUANDO o consultor envia pelo WhatsApp, ENTÃO o sistema DEVE montar uma
   mensagem com o nome do produto, o valor principal e o link, e enviá-la ao
   telefone do destinatário pela instância conectada.
3. QUANDO o WhatsApp não está conectado ou o envio falha, ENTÃO o sistema DEVE
   informar o consultor e permitir copiar o link para envio manual.
4. QUANDO o cliente abre o link e responde (aceitar/recusar/contrapor), ENTÃO o
   sistema DEVE registrar a resposta e notificar o consultor (Requisito 2).
5. O link público NÃO DEVE exigir login do cliente e DEVE funcionar apenas pelo
   token (sem expor dados de outros consultores ou clientes).

## Fora de escopo

- **Cadastro oficial da empresa** (outro link/sistema): contrato, ativação,
  validação — o acompanhamento aqui termina no aceite do cliente.
- Recebimento de pagamento (Pix, boleto, cartão) e qualquer integração de
  cobrança.
- Controle de pagamento, inadimplência ou conciliação financeira.
- Pós-venda: ativação, captura de documentos, esteira 30/60/90/120 dias.
- Cálculo oficial de comissão (continua sendo do portal iGreen).
- Assinaturas/recorrência de qualquer tipo.
