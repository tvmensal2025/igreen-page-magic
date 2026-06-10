# Análise das Referências Clonadas — o que aproveitar

> Documento de análise (pt-BR). Baseado na leitura do código real dos projetos
> clonados em `.tmp/referencias-analise/` (pasta temporária, ignorada pelo git).
> Os clones podem ser apagados depois — o conhecimento útil ficou registrado aqui.
>
> Regra firme: aproveitamos IDEIAS/PADRÕES, nunca o código nem a ferramenta.
> Tudo que for construído é 100% TypeScript/Deno no projeto atual.

## Projetos analisados (clonados, rasos)

| Projeto | Origem | Tamanho | Linguagem | Papel na análise |
|---------|--------|---------|-----------|------------------|
| rasa-calm | RasaHQ/rasa-calm-demo | 4.2M | Python/YAML | fluxo manda + padrões de reparo |
| salesgpt | filip-michalsky/SalesGPT | 30M | Python | separar decidir/escrever, estágios |
| flowise | FlowiseAI/Flowise | 74M | TypeScript | categorias de nós, RAG, conector |
| typebot | baptisteArno/typebot.io | 575M | TypeScript | blocos do construtor visual |

Botpress NÃO foi clonado (repositório muito grande); analisado via documentação
(Context7) nas rodadas anteriores — intenções/entidades e base de conhecimento.

---

## 1) Rasa CALM — o achado mais valioso (fluxo declarativo + reparo)

### O que o código real mostra (data/flows/*.yml)

Os fluxos do CALM são **declarativos** (YAML = dados, não código). Cada passo é um
`collect` (coletar um dado) com condições `next/if` determinísticas. Exemplo real
de `transfer_money.yml`:

- `collect: transfer_money_recipient` (coleta o destinatário)
- `collect: transfer_money_amount_of_money` (coleta o valor)
- `action: check_transfer_funds` → `if: not slots.has_sufficient_funds` →
  `set_slots: amount=null` e **volta** para o passo `ask_amount`
- `collect: final_confirmation` com `ask_before_filling: true`

Tradução para o seu mundo: isso é EXATAMENTE o que o `bot_flow_steps` já guarda
(captures, transitions, condition_expr). A diferença é que o CALM **lê a ordem dos
dados**; sua vendedora lê a ordem **fixa no código** (`state-machine.ts`).

### Padrões de reparo (patterns.yml) — ouro puro

O CALM tem fluxos meta prontos para "consertar" a conversa:

- `pattern_correction` — cliente corrige um dado já informado → confirma e reanota.
- `pattern_cancel_flow` — cliente desiste → cancela com mensagem adequada.
- `pattern_clarification` — pedido ambíguo (casa com 2 fluxos) → pede esclarecimento;
  após 2 tentativas, encaminha para humano.
- `pattern_cannot_handle` — IA não conseguiu entender → resposta segura / handoff.
- `pattern_chitchat` — conversa fora do roteiro → resposta livre controlada.

Hoje você faz isso com remendos espalhados (`leadFezPergunta`, anti-repetição,
contadores de tentativa). O CALM mostra que devem ser **padrões nomeados e
reaproveitáveis**.

### O que APROVEITAR (vira requisito)

- A ordem dos passos vem dos dados (`bot_flow_steps`), não do código → Requisito 6.
- Padrões de reparo nomeados: correção, cancelamento, clarificação, não-entendi,
  conversa fora do roteiro → Requisito 6.5, 6.6, 6.7 e Guarda (Req 9).
- `ask_before_filling` (confirmar antes de assumir um dado) e `set_slots ... next`
  (corrigir e voltar a um passo) — disciplina determinística que combina com suas
  travas anti-foto-cedo.

### O que NÃO aproveitar

- O software Rasa, o treino de modelo NLU, o servidor Python.
- O catálogo grande de intenções do mundo "nlu-based" (a própria Rasa abandonou no
  CALM). Ficamos só com um punhado de intenções comerciais → Requisito 4.5.

---

## 2) SalesGPT — separar "decidir" de "escrever" + estágios

### O que o código real mostra (salesgpt/stages.py, tools.py)

- `CONVERSATION_STAGES`: 8 estágios de venda em texto (Introdução, Qualificação,
  Proposta de valor, Análise de necessidade, Apresentação da solução, Contorno de
  objeção, Fechamento, Encerrar). É só um dicionário — simples e editável.
- Arquitetura: uma cadeia detecta o estágio (StageAnalyzer) e outra escreve a
  resposta (SalesConversation). Duas responsabilidades separadas.
- `tools.py`: ferramentas isoladas (busca na base de produto, gerar link de
  pagamento, enviar e-mail, agendar). Cada uma é uma função nomeada com descrição.

### O que APROVEITAR (vira requisito)

- Separar ESCRITA de DECISÃO → Requisitos 6 (decisor) e 8 (escritor).
- Ferramentas isoladas e nomeadas → Requisito 7 (habilidades).
- A noção de estágio de venda serve para ajustar o TOM do escritor.

### Correção importante (evita bagunça)

- NÃO criar um "detector de etapa por IA" separado. Como o Decisor de Passo (CALM)
  já define a etapa de forma determinística, um classificador paralelo criaria
  "duas verdades". Do SalesGPT fica só a separação decidir/escrever → Requisito 6.4.

### O que NÃO aproveitar

- O código Python/LangChain, o agente livre sem trava (você tem proteções melhores).

---

## 3) Typebot — blocos do construtor visual

### O que o código real mostra (packages/blocks/*/src)

- inputs: text, choice, email, number, phone, url, date, time, file, payment,
  rating, pictureChoice, cards.
- logic: condition, jump, wait, setVariable, script, redirect, return, abTest,
  typebotLink, webhook.
- integrations: openai, httpRequest, sendEmail, googleSheets, chatwoot, pixel, etc.

### O que APROVEITAR (vira requisito)

- Blocos claros que faltam ficar evidentes no seu construtor: **botão/escolha,
  espera, condição, encaminhar para humano, finalizar** → Requisito 11.2.
- `wait` (espera) e `condition` (decisão) já têm equivalente no seu
  `canonicalStepTypes` (branch, ask_choice) — falta rótulo claro em pt-BR.
- A experiência de pré-visualizar a conversa (você já tem FlowSimulator) →
  Requisito 11.1.

### O que NÃO aproveitar

- O motor do Typebot, o software, trocar seu construtor. O seu já está ligado ao
  banco (`bot_flow_steps`) e ao engine v3.

---

## 4) Flowise — categorias de nós, RAG e conector de modelos

### O que o código real mostra (packages/components/nodes/*)

Categorias de nós: chatmodels, llms, embeddings, memory, retrievers, vectorstores,
tools, chains, agents, agentflow, sequentialagents, moderation, outputparsers,
documentloaders, textsplitters, cache.

Dois pontos úteis:

- `chatmodels` / `llms` como camada separada e trocável → confirma a ideia do
  Conector de IA trocável (Lovable/GPT/Gemini) → Requisito 10.
- `moderation` como passo dedicado antes/depois do modelo → confirma a ideia da
  Guarda de Segurança como ponto único → Requisito 9.
- `retrievers` + `vectorstores` separados → seu RAG (`vendedora/rag.ts`) já cobre;
  a ideia extra é "reformular a busca quando não acha" (autocorreção) — opcional,
  baixo valor agora.

### O que APROVEITAR

- Conector de modelos como peça isolada (Req 10) e moderação como passo único (Req 9).

### O que NÃO aproveitar

- O Flowise como ferramenta, o ecossistema LangChain, os nós em si.

---

## 5) Botpress (via documentação) — intenções/entidades e base

### O que aproveitar

- Um punhado pequeno de intenções comerciais visíveis e ajustáveis (Req 4).
- Boas práticas de base de conhecimento (já coberto pelo seu `ai_knowledge_sections`).

### O que NÃO aproveitar

- A plataforma, o catálogo grande de intenções, os "autonomous nodes" sem trava.

---

## Mapa final: ideia → de onde vem → requisito desta spec

| Ideia aproveitada | Fonte | Requisito |
|-------------------|-------|-----------|
| Ordem dos passos vem dos dados (fluxo manda) | Rasa CALM | 6.1, 6.2, 6.3 |
| Padrões de reparo nomeados (correção/cancelar/clarificar) | Rasa CALM | 6.5–6.7, 9 |
| Confirmar antes de assumir dado | Rasa CALM | 9.3 |
| Separar decidir de escrever | SalesGPT | 6, 8 |
| Uma fonte única de etapa (sem detector paralelo) | correção CALM×SalesGPT | 6.4 |
| Habilidades isoladas e nomeadas | SalesGPT + Dify | 7 |
| Blocos claros (botão, espera, humano, finalizar) | Typebot | 11.2 |
| Pré-visualizar a conversa | Typebot | 11.1 |
| Conector de modelos trocável | Flowise | 10 |
| Moderação como passo único | Flowise | 9.7 |
| Punhado de intenções comerciais visíveis | Botpress | 4.1, 4.5 |
| Painel de automações (gatilho → ação) | n8n (docs) | 12 |

## Conclusão da análise

Nada nas referências contradiz o plano; pelo contrário, o código real confirma as
duas correções já feitas (sem catálogo grande de intenções; sem detector de etapa
paralelo) e reforça que o coração é o **Decisor de Passo lendo `bot_flow_steps`**
(padrão CALM), que você já tem infraestrutura para suportar (engine v3 + tabelas).

Os clones em `.tmp/referencias-analise/` podem ser apagados quando você quiser —
o que importava já está extraído aqui.

---

## Anexo — contribuições aproveitadas de uma análise externa (ChatGPT)

Uma análise externa sugeriu, no geral, **plugar ferramentas prontas** (Dify + n8n +
Typebot + Evolution como serviços rodando). Essa recomendação foi **rejeitada** para
o nosso caso porque fere três regras do projeto: não criar dependência pesada, não
mudar a arquitetura e não mexer na integração de WhatsApp. Ela também desconhece o que
já existe no código (engine v3, vendedora com RAG/memória, construtor visual, rollout).

Mesmo assim, três pontos dela são valiosos e foram incorporados:

1. **Segurança como critério de decisão.** A análise externa apontou falhas graves
   recentes (execução de código, RCE, bypass de autenticação) em alguns projetos de
   referência. Isso confirma que os clones servem **só para leitura** e nunca devem ser
   executados ou expostos. Virou o Requisito 18.
2. **Glossário de linguagem para o cliente** (ex.: intenção→assunto, transferir para
   atendente em vez de handoff, consumo em vez de uso de token). Reforça e amplia o
   Requisito 13. Virou base do Requisito 19.
3. **Camadas de memória separadas** (sessão / perfil / operacional / base de conteúdo),
   em vez de uma memória única gigante. Refina o Requisito 5. Virou o Requisito 20.

O que foi **rejeitado** da análise externa: adotar Dify/n8n como núcleo rodando;
"fortalecer" a camada de WhatsApp com Meta/Evolution (mexeria na integração atual);
tratar o sistema como se começasse do zero.

---

## Como vai ficar — visão dos primeiros passos

```
HOJE                                  DEPOIS (Cérebro em TypeScript, aditivo)
─────────────────────────             ─────────────────────────────────────────
Construtor visual ──✗── Vendedora      Construtor visual ──→ Cérebro ──→ resposta
(bot_flow_steps)   não  (state-machine        (bot_flow_steps)  │
                   fala  fixa no código)                        ├─ Entendimento
                                                                ├─ Estado/Memória (4 camadas)
                                                                ├─ Decisor de Passo (lê o fluxo)
                                                                ├─ Habilidades
                                                                ├─ Escritor
                                                                ├─ Guarda de Segurança
                                                                └─ Conector de IA (Lovable/GPT/Gemini)
                                       Reusa: engine v3, RAG, memória, anti-ban, proteções
                                       Atrás da chave flow_engine_v3 (off→dark→canary→on)
```

### Primeiros passos sugeridos (sem implementar ainda)

1. **Fechar os requisitos** (este documento + requirements.md) — inclui os Req 18, 19, 20.
2. **Escrever o design técnico**: estrutura de pastas de `cerebro/`, contratos de cada
   peça, e como o Decisor de Passo conversa com o engine v3.
3. **Definir as métricas de modo sombra**: qual taxa de coincidência libera cada estágio.
4. **Só então** implementar a primeira peça em modo sombra (decide e registra, não envia).

Os clones em `.tmp/referencias-analise/` já cumpriram o papel e podem ser apagados:
`rm -rf .tmp/referencias-analise`.
