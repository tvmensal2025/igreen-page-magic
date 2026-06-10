# Lista Definitiva de Aproveitamento — Cérebro IA

> Fonte da verdade (pt-BR). Objetivo: nada faltar, nada duplicado, nada criado à toa.
> Regra de ouro: REUSAR o que já existe e funciona; CRIAR só o mínimo; das referências
> aproveitar IDEIA (vira dado/template), nunca código.

---

## BLOCO 1 — REUSO do nosso próprio sistema (NÃO recriar)

Estas peças já existem, estão validadas e serão IMPORTADAS pelo Cérebro. Recriar
qualquer uma delas é duplicação proibida.

| # | O que reusamos | Onde está hoje | Por que reusar (não recriar) |
|---|----------------|----------------|------------------------------|
| R1 | Motor de fluxo puro (`runEngine`) | `_shared/engine/runner.ts` | Já decide passo lendo `bot_flow_steps`; é o "decisor" determinístico pronto |
| R2 | Carregar contexto/fluxo | `_shared/engine/loader.ts` | Já monta flow + estado para o motor; o Decisor chama isto |
| R3 | Entrada unificada do engine | `_shared/engine/webhook-entry.ts` | Já faz loadContext→runEngine→executeActions; ponto de plugue |
| R4 | Modo sombra + fail-open | `_shared/engine/webhook-hook.ts` (`runEngineV3IfEnabled`) | JÁ roda em paralelo sem enviar e cai pro legado em erro |
| R5 | Estado canônico do cliente | `_shared/customer-flow-state.ts` (`loadFlowState`) + `customer_flow_state` | É o "estado em grafo"; já tem currentStep, status, retries |
| R6 | Extractors (nome, valor, e-mail, cpf...) | `_shared/captureExtractors.ts` e `vendedora/extractors.ts` | Entendimento reusa; não reescrever extração |
| R7 | RAG (FAQ + conversas vencedoras) | `vendedora/rag.ts` + `ai_knowledge_sections` | Base de conteúdo já indexada; Escritor consulta |
| R8 | Memória persistente | `vendedora/memory.ts` + `customers.conversation_summary` | Vira a camada de memória; não criar tabela nova |
| R9 | Gateway de IA + cascata de modelos | `_shared/ai-gateway.ts` / `vendedora/gateway.ts` (`chatCascade`) | Base do Conector de IA (Lovable/GPT/Gemini) |
| R10 | Crítico (valida resposta) | `vendedora/critico.ts` | Vira parte da Guarda de Segurança |
| R11 | Travas determinísticas (anti-foto-cedo etc.) | `vendedora/orchestrator.ts` | Migram para a Guarda; lógica já existe |
| R12 | Match de transição/intenção | `_shared/flow-router.ts` (`matchTransition`) | Roteamento por botão/intenção já pronto |
| R13 | Chave de ativação/rollout | coluna `consultants.flow_engine_v3` + `rollout_config` + RolloutPanel | off→dark→canary→on já implementado |
| R14 | Registro de decisões | tabela `ai_decisions` + `engine_logs` | Comparação sombra grava aqui; não criar tabela |
| R15 | Construtor visual + simulador | `src/components/admin/flow-builder/` (`FlowSimulator`) | Pré-visualização já existe; só melhorar rótulos |
| R16 | Crons de follow-up/recuperação | `process-followups/`, `ai-followup-cron/` | Automação já roda; só ganha tela de controle |
| R17 | Tabelas e flags existentes | `bot_flows`, `bot_flow_steps`, `ai_agent_config`, `flow_router_rules` | Confirmadas no banco; reusar todas |

---

## BLOCO 2 — IDEIAS das referências (viram DADO/TEMPLATE, nunca código)

Nada de código dos clones entra. As ideias viram configuração nas tabelas que já
existem, ou disciplina de organização.

| # | Ideia | Vem de | Vira o quê no nosso sistema | Por que aproveitar |
|---|-------|--------|------------------------------|--------------------|
| I1 | Fluxo manda, IA executa | Rasa CALM | Decisor de Passo lê `bot_flow_steps` (R1) | Conserta a peça quebrada |
| I2 | Passos `collect` + condições | Rasa CALM | Modelo de fluxo no construtor (dados) | Estrutura clara de coleta |
| I3 | Padrões de reparo (corrigir, cancelar, clarificar, não-entendi) | Rasa CALM | Regras nomeadas na Guarda + Decisor | Hoje são remendos espalhados |
| I4 | Confirmar antes de assumir dado | Rasa CALM | Regra na Guarda | Evita erro de dado |
| I5 | Separar DECIDIR de ESCREVER | SalesGPT | Decisor (R1) ≠ Escritor (peça nova) | Organização; menos confusão |
| I6 | Estágios de venda (tom) | SalesGPT | Ajuste de tom do Escritor (texto/persona) | Conduz melhor a conversa |
| I7 | Uma só fonte de etapa | correção CALM×SalesGPT | NÃO criar detector de etapa por IA | Evita "duas verdades" |
| I8 | Habilidades isoladas e nomeadas | SalesGPT + Dify | Pasta `cerebro/habilidades/` reusando OCR/cálculo/closer | Testável, claro |
| I9 | Blocos claros (botão/espera/humano/finalizar) | Typebot | Rótulos no `canonicalStepTypes` | Construtor mais fácil |
| I10 | Pré-visualizar conversa | Typebot | Melhoria no FlowSimulator (R15) | Validar antes de publicar |
| I11 | Conector de modelo trocável | Flowise | Peça `conector-ia.ts` sobre R9 | Trocar IA sem reescrever |
| I12 | Moderação como passo único | Flowise | Guarda de Segurança (ponto único) | Consolida o que está espalhado |
| I13 | Punhado de intenções comerciais | Botpress | Lista pequena no Entendimento | Sem catálogo gigante |
| I14 | Glossário de linguagem do cliente | ChatGPT (externo) | Termos comerciais na interface/mensagens | Cliente não vê jargão |
| I15 | Camadas de memória (sessão/perfil/operacional/conteúdo) | ChatGPT (externo) | Organização da memória (R7, R8) | Memória não vira bagunça |
| I16 | Não executar projetos de referência | ChatGPT (externo) | Restrição de segurança | Falhas deles não entram |

---

## BLOCO 3 — O que vamos CRIAR de novo (auditado: NÚCLEO vs FASE POSTERIOR)

Auditoria aplicou 3 perguntas a cada peça: (a) o sistema funciona sem ela?
(b) quem serve? (c) o que conserta? O que não passou foi movido para "fase posterior"
para NÃO inflar o início.

### 3.1 — NÚCLEO MÍNIMO (sem isto o Cérebro não funciona) — 6 peças + métricas

| # | Peça nova | Arquivo previsto | Para quem | Por que é essencial |
|---|-----------|------------------|-----------|---------------------|
| N1 | Orquestrador | `_shared/cerebro/index.ts` | interno | Porta de entrada; sem ele as peças não se conversam |
| N2 | Entendimento | `_shared/cerebro/entendimento.ts` | cliente | Entende intenção/dados/objeção (hoje espalhado e frágil) |
| N3 | Decisor de Passo | `_shared/cerebro/decisor-passo.ts` | consultor→cliente | **A peça quebrada**: liga a IA ao fluxo do construtor via `runEngine` (R1) |
| N4 | Escritor | `_shared/cerebro/escritor.ts` | cliente | Escreve a mensagem; separa escrever de decidir |
| N5 | Guarda de Segurança | `_shared/cerebro/guarda.ts` | cliente+negócio | Valida antes de enviar (consolida crítico R10 + travas R11) |
| N8 | Estado/Memória | `_shared/cerebro/estado.ts` | cliente | Conversa retomável; organiza leitura/escrita sobre R5/R8 |
| N10 | Métricas de sombra | view sobre `ai_decisions`/`engine_logs` (R14) | interno/você | Sem medir, não dá pra virar a chave com segurança |

> N1–N8 são arquivos pequenos que ORQUESTRAM o que já existe. Não há reescrita de
> motor, anti-ban, RAG, memória ou proteções.

### 3.2 — FASE POSTERIOR (úteis, mas NÃO no início — auditoria cortou do núcleo)

| # | Peça | Por que NÃO entra agora | Quando fazer |
|---|------|-------------------------|--------------|
| N6 | Conector de IA trocável | Só vale se trocar Lovable/GPT/Gemini for objetivo real; hoje funciona | Quando houver necessidade concreta de troca |
| N7 | Habilidades empacotadas | A conversa funciona sem empacotar; OCR/cálculo/closer já existem | Faseado, conforme cada habilidade for precisa |
| N9 | Painel de automações | É tela de conveniência; os crons (R16) já rodam sozinhos | Projeto separado, depois do núcleo |

> Decisão de auditoria: começar SÓ com 3.1. Isso conserta o problema real (a IA seguir
> o construtor) sem inflar o escopo nem fazer peça à toa.

---

## BLOCO 4 — DESCARTADO de propósito (para não implementar à toa)

Registrado aqui para ninguém implementar depois "por engano".

| # | Descartado | Por que NÃO fazer |
|---|------------|-------------------|
| X1 | Rodar Dify/n8n/Flowise/Botpress/Typebot/Rasa como serviço | Dependência pesada, muda arquitetura, 2º caminho no WhatsApp |
| X2 | Detector de etapa por IA separado | Cria "duas verdades"; a etapa vem do fluxo (I7) |
| X3 | Catálogo grande de intenções | A própria Rasa abandonou; manutenção infinita (I13) |
| X4 | Substituir o sistema atual pelo novo | 90% funciona; jogaria fora anti-ban e proteções |
| X5 | Tabela nova de memória/decisão | Já existem `conversation_summary`, `ai_decisions`, `engine_logs` |
| X6 | Reescrever o motor de fluxo | `runEngine` já é estilo CALM/LangGraph e está testado |
| X7 | Mexer na integração de WhatsApp (Evolution/Whapi) | Risco de bloqueio; regra do projeto |
| X8 | Copiar código dos clones | Python/plataforma; não roda no Deno |

---

## BLOCO 5 — INTOCÁVEL (não alterar)

| # | Não tocar | Por quê |
|---|-----------|---------|
| T1 | Anti-ban (`_shared/anti-ban.ts`) | Protege os números; alterar = risco de bloqueio |
| T2 | Trio de proteção do webhook (dedup + lock + rate limit) | Previne duplicata; validado |
| T3 | `caller-auth.ts` + RLS | Segurança crítica já validada |
| T4 | Migrations já aplicadas | Nunca alterar migration aplicada |
| T5 | Integração Evolution/Whapi | Canal estável; não trocar |
| T6 | PWA cache strategy | Evita HTML velho |

---

## Pontos cirúrgicos (a auditoria do código revelou — exigem cuidado)

| # | Ponto | Cuidado |
|---|-------|---------|
| C1 | Bypass do Fluxo B ("Variant B NUNCA entra no V3") | Desfazer de forma controlada, em modo sombra primeiro |
| C2 | Dois webhooks espelhados (evolution + whapi) | Alterar SEMPRE em par para não divergir |
| C3 | Timeout de 25s da IA nos handlers | O Cérebro não pode estourar esse teto |

---

## Resumo de uma linha

REUSAR (Bloco 1) + IDEIAS viram dado/template (Bloco 2) + CRIAR só o mínimo
orquestrador (Bloco 3); DESCARTAR o resto de propósito (Bloco 4); NÃO TOCAR no que
protege o negócio (Bloco 5); ter cuidado nos 3 pontos cirúrgicos.

---

## COMO ESTÁ HOJE → COMO VAI FICAR (auditado, sem deixar nada para trás)

### Visão técnica (o que muda por dentro)

| Tema | Como está hoje | Como vai ficar |
|------|----------------|----------------|
| Decisão do passo da conversa | Ordem fixa no código (`vendedora/state-machine.ts`): nome→valor→simulação→foto→doc→email | Ordem vem do construtor visual (`bot_flow_steps`) lida pelo `runEngine` |
| Construtor visual x IA | Separados: a IA ignora o que o consultor monta | Unidos: o que o consultor monta comanda a IA |
| Mudar o atendimento | Só mexendo no código + deploy | O consultor muda no construtor, sem programador |
| Onde a lógica vive | Espalhada no `orchestrator.ts` (decisão+escrita+travas juntas) | Separada: Entendimento, Decisor, Escritor, Guarda |
| Tratar dúvida/objeção/correção | Remendos espalhados (`leadFezPergunta`, anti-repetição) | Padrões de reparo nomeados (ideia CALM) |
| Validação antes de enviar | Crítico + travas em pontos diferentes | Um ponto único: Guarda de Segurança |
| Fluxo B (vendedora) | Bypass força caminho legado, pula o motor | Passa pelo Cérebro, atrás da chave, em sombra primeiro |
| Anti-ban, proteções, RAG, memória, canal | Funcionando | **Iguais — não tocamos** |

### Para o CONSULTOR (quem configura e atende)

| Hoje | Vai ficar |
|------|-----------|
| Monta fluxo no construtor, mas a IA não obedece | O fluxo que ele monta passa a comandar a IA de verdade |
| Para mudar a conversa, depende de programador | Muda sozinho, no construtor visual |
| Não enxerga por que a IA travou num cliente | Estado retomável + registro de decisão para diagnóstico |
| Vê telas com termo técnico | Linguagem comercial (glossário único) |
| (fase posterior) liga/desliga automação no código | (fase posterior) painel próprio gatilho→ação |

### Para o CLIENTE (quem conversa no WhatsApp)

| Hoje | Vai ficar |
|------|-----------|
| Conversa parece formulário; trava quando foge do script | Conversa mais natural, segue o fluxo certo e não trava |
| IA pode repetir, pedir dado cedo ou usar jargão | Guarda impede pedir cedo, repetir, inventar ou usar jargão |
| Dúvida/objeção fora de hora confunde a IA | Padrões de reparo tratam e voltam ao ponto certo |
| Se a IA cai, conversa pode se perder | Estado salvo: retoma de onde parou, sem reiniciar cadastro |
| Risco de número bloqueado (anti-ban protege) | **Igual — anti-ban mantido intacto** |

---

## OBJETIVO (uma frase)

Fazer o atendimento que o CONSULTOR monta no construtor visual comandar de verdade a
IA que conversa com o CLIENTE no WhatsApp — consertando só a peça quebrada (a decisão
de passo), reusando tudo que já funciona, sem risco para os números e sem reescrever
o sistema.

## Escopo fechado do INÍCIO (o que entra na primeira leva)

Entra: N1, N2, N3, N4, N5, N8, N10 (núcleo) + I1–I8, I12–I16 (ideias que viram dado/
regra) + todos os REUSOS do Bloco 1.
NÃO entra agora: N6, N7, N9 (fase posterior). Nada do Bloco 4. Nada do Bloco 5 é tocado.
Cuidado nos 3 pontos cirúrgicos (C1, C2, C3).

---

## REGRA DE OURO — UM cérebro único, sem duplicação (blindagem anti-bagunça)

Esta é a regra mais importante do projeto. Ela existe para garantir o que o dono pediu:
"um único, perfeito, sem erro" — e impedir o maior risco (acabar com 3 coisas fazendo
trabalho parecido).

### O princípio

O `cerebro/` **NÃO é um terceiro mundo**. Ele **assume o lugar** da Vendedora_Atual
(`vendedora/orchestrator.ts` — a peça quebrada). Não roda ao lado dela para sempre.

Ao final do rollout existem **exatamente DOIS caminhos**, nunca três:

| Caminho | Quem cuida | Status |
|---------|-----------|--------|
| Determinístico (passos sem IA livre) | `engine/runEngine` (intocado) | mantido como está |
| Conversacional (IA que conversa) | **Cérebro** (substitui a vendedora) | novo, único |

### Regras concretas (vão para o design)

1. **Substituição, não adição.** O `cerebro/index.ts` substitui o papel do
   `vendedora/orchestrator.ts`. Não criamos um terceiro orquestrador permanente.
2. **Reuso por dentro.** O Cérebro CHAMA `runEngine`/`webhook-entry` para a parte
   determinística (decidir passo) e usa RAG, memória, gateway e travas existentes.
   Não recria nada disso.
3. **Aposentadoria ao virar a chave.** Enquanto a chave está em `dark`/`canary`, a
   vendedora antiga ainda responde (segurança). Quando a chave vai para `on` e a
   métrica de coincidência aprova, a vendedora antiga é **desativada** — não fica
   "dormindo" no caminho. Código morto é removido depois de estável.
4. **Ponto de entrada único por canal.** Cada webhook (evolution, whapi) tem UM ponto
   que decide: determinístico → engine; conversacional → Cérebro. Sem caminhos
   paralelos escondidos. O bypass atual do Fluxo B (C1) é removido nesse processo.
5. **Sem tabela/estado duplicado.** Estado em `customer_flow_state` + `fluxo_b_state`;
   decisões em `ai_decisions`/`engine_logs`. Nada novo é criado em paralelo.
6. **Migração limpa.** A sequência fixa de etapas (`state-machine.ts`) só é removida
   depois que o Decisor de Passo (lendo o construtor) provar paridade em sombra. Some
   de vez — não vira "fallback eterno".

### Resultado final esperado

Um sistema com UM cérebro conversacional (limpo, lendo o construtor visual) + UM motor
determinístico (intocado). A peça quebrada deixa de existir. Nada roda em triplicado.
Tudo que clonamos virou IDEIA aplicada nesse cérebro único — nenhum código de
referência entrou, nenhuma estrutura ficou duplicada.

> Se em qualquer momento do design ou da implementação aparecer um TERCEIRO caminho
> conversacional, ou a vendedora antiga sobrevivendo ao estágio `on`, isso é um ERRO
> de execução do plano e deve ser corrigido — não é o desenho pretendido.
