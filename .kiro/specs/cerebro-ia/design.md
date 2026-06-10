# Design Técnico — Cérebro IA

> Documento de design (pt-BR). Guia a construção; nenhum código é escrito a partir
> dele sem aprovação. Fiel ao código real auditado e às regras do `aproveitamento.md`.

## Overview

O Cérebro IA é um módulo novo e isolado, em TypeScript/Deno, que faz o fluxo montado no
construtor visual (`bot_flow_steps`) comandar a IA que conversa com o cliente no
WhatsApp. Hoje a vendedora (Fluxo B) ignora o construtor e segue uma sequência fixa
escrita no código (`vendedora/state-machine.ts`) — essa é a peça quebrada.

O design mostra COMO montar o cérebro único reusando o motor determinístico (`runEngine`)
e as proteções que já existem. Cada peça nova é pequena e apenas orquestra o que já
está pronto.

**Regra de Ouro:** o Cérebro SUBSTITUI a vendedora atual. Ao final existem DOIS caminhos
— determinístico (`runEngine`, intocado) e conversacional (Cérebro, único). Nunca três.

## Architecture

### Princípios (de onde vem cada um)

| Princípio | Vem de | Aplicação |
|-----------|--------|-----------|
| O fluxo manda, a IA executa | Rasa CALM | Decisor de Passo usa `runEngine` para a ordem |
| IA gera "comando", não a ordem | Rasa CALM | A IA entende e escreve; nunca inventa a sequência |
| Separar decidir de escrever | SalesGPT | N3 (Decisor) ≠ N4 (Escritor) |
| Estado tipado e retomável | LangGraph | N8 sobre `customer_flow_state` (já existe) |
| Validação num ponto único | Flowise (moderation) | N5 (Guarda) consolida crítico + travas |
| Intenções enxutas | Botpress | N2 usa conjunto pequeno e fechado |
| Motor permanece puro | seu engine v3 | `runEngine` intocado; Cérebro fica FORA dele |

### Estrutura de pastas (nova, isolada)

```
supabase/functions/_shared/cerebro/
├── index.ts            (N1) orquestrador — porta de entrada única
├── entendimento.ts     (N2) intenção + dados + objeção
├── decisor-passo.ts    (N3) decide o passo via runEngine (o conserto)
├── escritor.ts         (N4) escreve a mensagem do passo
├── guarda.ts           (N5) valida tudo antes de enviar
├── estado.ts           (N8) lê/atualiza estado campo a campo
├── tipos.ts            contratos TypeScript do Cérebro
└── __tests__/          testes de cada peça isolada
```

Nada fora dessa pasta é recriado; tudo que já existe é IMPORTADO.

### Fluxo de um turno

```
Cliente manda mensagem no WhatsApp
   │
   ▼
Webhook (evolution/whapi) — ponto de entrada ÚNICO por canal
   │  decide: determinístico → engine ; conversacional → Cérebro
   ▼
N1 Orquestrador
   ├─→ N8 lê estado (onde o cliente parou)
   ├─→ N2 Entendimento (intenção + dados + objeção)   [reusa extractors]
   ├─→ N3 Decisor de Passo ──chama──→ loadContext + runEngine [motor intocado]
   │        └─ aplica reparo (correção/cancelar/dúvida) se preciso
   ├─→ N4 Escritor ──usa──→ RAG + memória + gateway          [reusa]
   ├─→ N5 Guarda valida o texto (bloqueia/ajusta se preciso)
   └─→ N8 grava estado atualizado (campo a campo)
   │
   ▼
Resposta enviada pelo canal (anti-ban + proteções intactos)
   │
   ▼
N10 grava a decisão em ai_decisions (em sombra: NÃO envia, só registra e compara)
```

### Ligação N3 ↔ runEngine (ponto mais delicado)

O `runEngine` é função pura (não faz rede nem chama IA — proibido por lint). O Cérebro
fica SEMPRE por fora:

1. N3 chama `loadContext({ supabase, customerId, capabilities })` → `{ state, flow,
   capabilities }` (contrato real existente em `engine/loader.ts`).
2. N3 monta o `InboundEvent` e chama `runEngine({ state, inbound, flow, capabilities,
   hooks, config })` → `{ outbound, stateUpdate, logs, deferred }`.
3. A decisão de PASSO sai do `runEngine`. A ESCRITA fica com N4.
4. O `runEngine` continua puro e testado. É o padrão CALM: motor decide o passo, IA
   escreve.

### Pipeline de cadastro (mídia, OCR, OTP, portal) — não é só texto

O atendimento não termina em texto: ele precisa coletar foto da conta, documento,
validar OTP e enviar o cadastro ao portal iGreen. O Cérebro NÃO reimplementa isso —
ele reusa o que já existe, acionando pelo mesmo mecanismo do `runEngine`.

Como funciona dentro do Cérebro:

1. **Passos de mídia/sistema** já existem em `bot_flow_steps` como `ask_media` (pedir
   foto/documento) e `system_capture` (com `pipelineKind`: `ocr_conta`, `ocr_documento`,
   `cadastro_portal`, `finalizar_cadastro`).
2. Quando N3 (Decisor) chega num desses passos, o `runEngine` devolve uma
   **`DeferredAction`** (`ocr`, `portal_submit`, `otp_submit`) — exatamente o que o motor
   já produz hoje. O Cérebro NÃO executa OCR/portal por conta própria.
3. Quem executa a ação assíncrona é o **dispatcher existente** (`_shared/dispatcher/` +
   hooks de OCR/portal/OTP), igual ao caminho do engine v3. O Cérebro só repassa.
4. **OTP** continua sendo interceptado ANTES do Cérebro (o webhook já tem
   `otp-intercept`); o Cérebro nem vê esse turno. Mantém o comportamento atual.
5. O fechamento do cadastro (hoje no `vendedora/closer.ts` → `finalize-capture`) passa a
   ser um passo `system_capture: finalizar_cadastro` no fluxo — disparado por N3, não por
   código fixo.

Regra: mídia recebida e captura determinística (foto/documento) continuam tratadas no
caminho determinístico/dispatcher. O Cérebro decide QUANDO pedir e QUANDO finalizar,
lendo o fluxo — mas não substitui o OCR, o worker do portal nem a interceptação de OTP.

> Origem da ideia: Rasa CALM trata "chamar uma ação externa" como passo do fluxo
> (`action:` / `call:`), não como código solto. É o mesmo princípio do `system_capture`.

### Não quebrar o worker do portal (auditoria do código real)

A leitura de `_shared/portal-worker.ts` revelou regras que o Cérebro DEVE respeitar
(senão quebra o cadastro no `worker-portal-2`):

1. **Despacho único pelo helper existente.** O envio ao portal é SEMPRE via
   `dispatchPortalWorker(supabase, customerId)`. O Cérebro NUNCA monta payload de portal
   nem chama o worker direto. O passo `finalizar_cadastro` apenas aciona esse helper.
2. **Roteamento digital vs autoconexao preservado.** O helper decide o worker por
   `consultants.portal_kind` (`digital` → worker 1; `autoconexao` → `worker-portal-2`).
   O Cérebro não interfere nessa escolha.
3. **Gate de documentos do Portal 2 respeitado.** O `worker-portal-2` exige conta de
   energia + documento (frente; e verso se RG). O helper já valida isso
   (`checkDocsPresentForPortal2`). O Cérebro só deve chegar no passo de finalização
   QUANDO o fluxo garantir esses anexos — espelhando o gate, nunca contornando.
4. **Payload e campos intocados.** Campos como `media_consumo`, `igreen_id`,
   `portal2_celular_alt` e a estimativa de consumo continuam montados pelo helper. O
   Cérebro não recalcula nem altera esses dados.
5. **OTP fora do Cérebro.** A interceptação de OTP (`otp-intercept` + `submit-otp`) e o
   `WORKER_PORTAL_URL`/`PORTAL2_WORKER_URL` permanecem no fluxo atual. O Cérebro não
   processa o turno de OTP.

Em uma frase: o Cérebro decide o QUANDO (qual passo), o helper e o worker decidem o
COMO (despacho, roteamento, payload). Nada do `portal-worker.ts` é reescrito.

### Migração de clientes que já estão em conversa

Ao virar a chave para `canary`/`on`, existem clientes no meio do atendimento com
`fluxo_b_state` preenchido pela vendedora antiga. Regra de migração:

1. N8 lê o estado antigo (`fluxo_b_state.etapa`) e o `conversation_step` atual.
2. Um mapa de equivalência (etapa antiga → passo do fluxo) define onde o cliente
   "entra" no fluxo do construtor, SEM reiniciar o cadastro.
3. Dados já coletados (nome, valor, mídia, e-mail) são respeitados pelo `runEngine`
   (que já decide o passo a partir dos dados presentes — não repergunta o que já tem).
4. Se o estado antigo não tiver equivalente claro, o cliente é tratado de forma
   conservadora: handoff para humano em vez de recomeçar (evita repetir cadastro).

### Automação (follow-up / reativação) religada ao Cérebro

Hoje `process-followups` e `ai-followup-cron` chamam `runFluxoBAI` (a vendedora) com um
"nudge". Quando a vendedora é aposentada:

1. Esses crons passam a chamar o **N1 (Orquestrador)** com um inbound sintético do tipo
   `no_input`/nudge (o `runEngine` já trata `no_input`).
2. O Cérebro decide a ação de reaquecimento lendo o fluxo, igual a um turno normal.
3. Enquanto a chave não está em `on`, os crons continuam chamando a vendedora (sem
   mudança), preservando o comportamento atual.

Isso garante que follow-up e reativação NÃO param quando a chave virar.

### Ativação segura (reusa `flow_engine_v3` + RolloutPanel)

| Estágio | O Cérebro... | Quem responde ao cliente |
|---------|--------------|--------------------------|
| off | inativo | sistema atual |
| dark | decide e grava, NÃO envia | vendedora atual |
| canary | responde para consultores escolhidos | Cérebro (subconjunto) |
| on | responde para todos | Cérebro (vendedora antiga aposentada) |

Avanço por taxa de coincidência (N10) acima do limite em `rollout_config`. Fail-open:
erro no Cérebro → cai pro caminho atual (como `runEngineV3IfEnabled` já faz).

## Components and Interfaces

> Contratos em alto nível (formato), não implementação. Permitem testar cada peça
> isolada (Requisito 7.4).

### N1 — Orquestrador (`index.ts`)
- **Entrada:** `{ supabase, customerId, consultantId, inbound, canalCapabilities }`
- **Saída:** `{ reply, outbound[], stateUpdate, shouldHandoff, decisao }`
- **Faz:** coordena N2 → N8 → N3 → N4 → N5. Sem regra de negócio. Único ponto chamado
  pelo webhook. Substitui o papel de `vendedora/orchestrator.ts`.

### N2 — Entendimento (`entendimento.ts`)
- **Entrada:** `{ inboundText, historico, estado }`
- **Saída:** `{ intencao (conjunto fechado), dados, objecao? }`
- **Reusa:** extractors (`captureExtractors.ts`, `vendedora/extractors.ts`) + perfilador.
- **Ideia:** Botpress (intenções enxutas) + correção CALM (sem catálogo grande).

### N3 — Decisor de Passo (`decisor-passo.ts`) — central
- **Entrada:** `{ supabase, customerId, inbound, entendimento, capabilities }`
- **Saída:** `{ passoAtual, proximoPasso, acaoDeterministica, reparo? }`
- **Faz:** `loadContext` + `runEngine` para decidir o passo a partir de `bot_flow_steps`.
  Aplica padrões de reparo (correção/cancelar/dúvida fora de hora). Sem sequência fixa.
- **Ideia:** Rasa CALM.

### N4 — Escritor (`escritor.ts`)
- **Entrada:** `{ passoAtual, entendimento, estado, ragText, memoria, persona }`
- **Saída:** `{ texto }`
- **Reusa:** `vendedora/rag.ts`, `vendedora/memory.ts`, gateway `chatCascade`. Ajusta
  tom por etapa de venda.
- **Ideia:** SalesGPT (escritor separado + tom por estágio).

### N5 — Guarda de Segurança (`guarda.ts`)
- **Entrada:** `{ textoProposto, passoAtual, estado }`
- **Saída:** `{ aprovado, textoFinal, motivoBloqueio? }`
- **Reusa:** `vendedora/critico.ts` + travas determinísticas. Ponto ÚNICO: não inventar,
  não vazar, não pedir cedo, sem jargão (glossário).
- **Ideia:** Flowise (moderação como passo único) + travas existentes.

### N8 — Estado/Memória (`estado.ts`)
- **Entrada:** `{ supabase, customerId }` / `{ customerId, patch }`
- **Saída:** estado lido / confirmação de escrita campo a campo
- **Reusa:** `loadFlowState` + `customer_flow_state` + `fluxo_b_state` +
  `conversation_summary`. Camadas de memória (sessão/perfil/operacional/conteúdo).
- **Ideia:** LangGraph (estado tipado, retomável).

### N10 — Métricas de sombra (view)
- **Entrada:** `ai_decisions` / `engine_logs`
- **Saída:** taxa de coincidência por estágio (dark/canary/on)
- **Definição da coincidência (objetiva):** compara-se o **passo/ação decidido** pelo
  Cérebro com o **passo/ação do sistema atual** no mesmo turno. Coincide quando o
  próximo passo (ou a ação determinística: pedir foto, finalizar, handoff) é o mesmo.
  NÃO se compara o texto exato da mensagem (subjetivo).
- **Critério de avanço:** coincidência ≥ limite de `rollout_config` (ex.: 90%) ao longo
  de pelo menos N turnos (ex.: 200) sem regressão de erro. Abaixo disso, o estágio não
  avança (sinaliza não-apto).

### Rastreabilidade dos requisitos (cobertura no design)

| Requisito | Onde é endereçado | Fase |
|-----------|-------------------|------|
| 1 (módulo isolado TS) | Estrutura de pastas; tipos | núcleo |
| 2, 3, 14, 15 (ativação/sombra/rollout) | Ativação segura; N10 | núcleo |
| 4 (entendimento) | N2 | núcleo |
| 5, 20 (estado/memória em camadas) | N8 | núcleo |
| 6 (decisor lê o fluxo + reparo) | N3; pipeline de cadastro | núcleo |
| 8 (escritor) | N4 | núcleo |
| 9 (guarda) | N5 | núcleo |
| 13, 19 (linguagem/glossário) | N5 aplica glossário; ver nota abaixo | núcleo |
| 16 (não interferência) | Error Handling; Data Models; Property 2 | núcleo |
| 17 (reúso de tabelas) | Data Models | núcleo |
| 18 (segurança das referências) | nota de segurança abaixo | núcleo |
| 7 (habilidades) | **fase posterior** (N7) | posterior |
| 10 (conector de IA) | **fase posterior** (N6) | posterior |
| 11 (construtor visual) | **fase posterior** | posterior |
| 12 (painel automações) | **fase posterior** (N9) | posterior |

**Nota linguagem (Req 13/19):** o glossário único (assunto, transferir para atendente,
etc.) é aplicado por N5 na saída ao cliente e nos rótulos de interface. É um filtro de
texto, não uma peça à parte.

**Nota segurança (Req 18):** nenhum código dos clones é importado/executado. Os clones
ficam só em `.tmp/referencias-analise/` (ignorada pelo git) e podem ser apagados. O
Cérebro não cria nenhum ponto que execute código vindo de configuração de fluxo.

### Aproveitamento dos clones (templates → viram DADO, não código)

| Template clonado | Vira o quê | Onde |
|------------------|-----------|------|
| Fluxos CALM (`order_pizza.yml`, `transfer_money.yml`) | Modelo de fluxo no construtor | `bot_flow_steps` (dados) |
| `patterns.yml` do CALM | Padrões de reparo que N3/N5 implementam em TS | regra |
| `stages.py` do SalesGPT | Tabela de tom por etapa para N4 | dado/persona |
| Blocos do Typebot | Rótulos claros (fase posterior) | UI |
| Categorias do Flowise | Confirmam N5 (guarda única) e conector (fase posterior) | desenho |

## Data Models

Nenhuma tabela ou coluna nova. Reuso integral do existente:

| Dado | Tabela/coluna existente | Uso no Cérebro |
|------|-------------------------|----------------|
| Passos do fluxo | `bot_flow_steps` | N3 lê via `loadContext`/`runEngine` |
| Fluxo ativo | `bot_flows` | N3 (variante, strict_mode) |
| Estado do cliente | `customer_flow_state` (+ `fluxo_b_state`) | N8 lê/grava |
| Memória/resumo | `customers.conversation_summary` | N8 (camadas de memória) |
| Base de conteúdo | `ai_knowledge_sections` | N4 via RAG |
| Decisões/sombra | `ai_decisions`, `engine_logs` | N1/N10 registram e comparam |
| Config do agente | `ai_agent_config` | persona/ligado-desligado |
| Chave de rollout | `consultants.flow_engine_v3` + `rollout_config` | ativação por estágio |

`InboundEvent`, `CustomerSnapshot`, `EngineOutput` reusam os tipos já definidos em
`engine/types.ts`. Os tipos novos do Cérebro vivem em `cerebro/tipos.ts` e referenciam
esses, sem duplicar.

## Correctness Properties

### Property 1: Um caminho conversacional só
Em `on`, nenhum turno conversacional passa pela vendedora antiga; todo turno passa pelo
Cérebro. Não existe terceiro caminho.

**Validates: Requirements 14.1, 14.2**

### Property 2: Motor puro intocado
`runEngine` nunca recebe IA dentro de si; o teste de pureza continua passando.

**Validates: Requirements 1.3, 16.2**

### Property 3: A ordem vem do dado
Mudar `bot_flow_steps` muda a decisão de N3 sem alterar código.

**Validates: Requirements 6.2, 6.3**

### Property 4: Nunca silencioso
Todo inbound do cliente gera resposta ou handoff (herdado do `runEngine`, garantia G2).

**Validates: Requirements 6.6, 9.6**

### Property 5: Guarda sempre roda
Nenhuma mensagem sai sem passar por N5 (Guarda de Segurança).

**Validates: Requirements 9.1, 9.7**

### Property 6: Sombra não envia
Em `dark`, o Cérebro nunca envia ao cliente; apenas registra a decisão.

**Validates: Requirements 3.3, 2.3**

### Property 7: Sem duplicação de estado
Estado e decisões usam somente as tabelas existentes; nenhuma estrutura nova em paralelo.

**Validates: Requirements 17.1, 17.3**

### Property 8: Cadastro fecha
Quando o fluxo chega num passo de finalização, o Cérebro dispara a ação de cadastro
(via `DeferredAction`/dispatcher existente); a conversa não trava sem fechar.

**Validates: Requirements 6.1, 7.3**

### Property 9: Cliente em conversa não recomeça
Ao virar a chave, cliente com cadastro parcial não é reiniciado: dados já coletados são
respeitados e ele entra no passo equivalente (ou vai a handoff).

**Validates: Requirements 5.4, 14.1**

### Property 10: Worker do portal intocado
O cadastro no portal é sempre via `dispatchPortalWorker`; o Cérebro não monta payload,
não escolhe worker e não contorna o gate de documentos do Portal 2.

**Validates: Requirements 16.1, 16.3**

## Error Handling

- **Fail-open geral:** qualquer erro no Cérebro → cai para o caminho atual (vendedora/
  engine), nunca bloqueia o atendimento. Mesmo padrão de `runEngineV3IfEnabled`.
- **Timeout:** o Cérebro respeita o teto de 25s dos handlers (C3); se estourar, handoff
  ou caminho atual.
- **Erro de IA (gateway):** N4 cai para texto seguro/template (reuso do fallback atual);
  N5 garante que nada técnico vaza.
- **Estado ausente/corrompido:** N8 trata como cliente novo sem reiniciar cadastro
  indevidamente (herda regra do `loadFlowState`).
- **Dois webhooks:** qualquer alteração de roteamento é feita em par (evolution + whapi)
  para não divergir (C2).

## Testing Strategy

- **Unidade:** cada peça (N2, N3, N4, N5, N8) testada isolada com entradas sintéticas.
- **Paridade em sombra:** Cérebro vs sistema atual no mesmo turno; mede coincidência de
  PASSO/AÇÃO (N10), não de texto.
- **Pipeline de cadastro:** testar que passos de mídia/OCR/OTP/portal disparam a
  `DeferredAction` certa e que o dispatcher existente executa (sem reimplementar OCR).
- **Migração:** testar cliente com `fluxo_b_state` parcial entrando no passo equivalente
  sem recomeçar o cadastro.
- **Follow-up:** testar que os crons chamam o Cérebro (nudge `no_input`) quando em `on`.
- **Não-regressão:** anti-ban, dedup, lock, rate limit, timeout 25s e interceptação de
  OTP intactos.
- **Propriedades:** testes para Property 1–9 (em especial 1 — caminho único; 2 — pureza
  do motor; 8 — cadastro fecha; 9 — não recomeça).
- **E2E:** reusa `bot-e2e-runner` para conversas completas (incluindo foto+documento+
  finalização) antes de avançar estágio.

## Out of Scope (fase posterior)

N6 (conector de IA trocável), N7 (habilidades empacotadas), N9 (painel de automações).
Entram depois do núcleo provar valor, conforme decisão de auditoria no `aproveitamento.md`.
