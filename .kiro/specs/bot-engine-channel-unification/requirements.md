> ⚠️ FONTE DE VERDADE WA = **Whapi** (não Evolution). Este spec pode estar defasado — siga `.kiro/steering/regras-duras.md` + `wa-webhook.md`. Ver `.kiro/specs/STATUS.md`.

# Requirements Document

## Introduction

O bot conversacional do iGreen é a porta de entrada WhatsApp de uma plataforma SaaS multi-tenant que origina leads para a cooperativa de energia (iGreen Energy). Cada consultor configura o seu próprio fluxo de venda em `/admin/fluxos` (UI FluxoBuilder, tabela `bot_flow_steps`) e espera que o bot siga aquele fluxo à risca em todos os canais que estiverem ativos para a sua conta.

Hoje o sistema executa três motores de fluxo em paralelo, mais um roteador que decide a cada turno qual motor responde:

- **Motor Legacy_Cadastro** — pipeline determinístico de cadastro (OCR de conta, OCR de documento, CPF, portal, OTP, facial). Implementado em `supabase/functions/whapi-webhook/handlers/bot-flow.ts` (≈5.264 linhas) e `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (≈4.641 linhas), com ≈623 linhas divergentes entre os dois.
- **Motor Conversational** — interpreta os fluxos desenhados em `/admin/fluxos`. Implementado em `supabase/functions/whapi-webhook/handlers/conversational/index.ts` (≈2.552 linhas) e `supabase/functions/evolution-webhook/handlers/conversational/index.ts` (≈2.280 linhas), com ≈272 linhas divergentes.
- **Motor Engine_V3** — runner puro novo em `supabase/functions/_shared/flow-engine/v3-*.ts` (≈2.450 linhas). Atualmente em modo `dark` para os doze consultores aprovados: roda em paralelo aos motores legados, escreve em `engine_logs`, mas não emite outbound.
- **Roteador** — `supabase/functions/_shared/flow-router.ts`, função `routeEngine()`. Decide a cada turno entre Legacy_Cadastro e Conversational lendo `customers.conversation_step` e comparando contra a lista hardcoded `CADASTRO_STEPS` (48 itens) e a forma do step (prefixo `flow:`, UUID ou `passo_*`).

Esse desenho gera bugs reais e recorrentes:

1. O Roteador troca de motor no meio da conversa quando o passo muda.
2. A lista `CADASTRO_STEPS` força o Legacy_Cadastro em passos híbridos (ex.: `ask_quero_cadastrar`), mesmo quando o consultor desenhou um CTA conversacional para aquele ponto.
3. Correções aplicadas no lado Whapi escapam do lado Evolution e vice-versa (`sleepForMedia`, botões, auto-resume, LGPD, comandos `SAIR`).
4. A ordem de envio de mídia (texto, áudio, vídeo, imagem) tem três implementações diferentes.
5. Em alguns ramos do Conversational a IA (Gemini) propõe um `goto_step_id` que não existe no fluxo, "inventando" uma resposta sem validação.

Há ainda uma diferença irredutível entre canais que precisa ser respeitada e modelada como capability, não como código duplicado:

- **Whapi** suporta botões interativos (`sendButtons`); o lead clica.
- **Evolution** não suporta botões interativos; precisa enviar lista numerada (`*1.* Sim` / `*2.* Não`) e aceitar a resposta em dígito.

Esta feature unifica os três motores em um motor único e determinístico (o Motor_Unificado), elimina o Roteador como decisor a cada turno, e move a diferença Whapi×Evolution para o adapter de canal. Cada lado do webhook fica fino: parse de inbound → carrega contexto → chama o Motor_Unificado → executa outbound via adapter de canal → persiste estado.

O contrato com o consultor é uma frase: **o que está desenhado em `/admin/fluxos` é o que o lead recebe, na ordem configurada, no canal dele, sem o pipeline trocar no meio do caminho e sem a IA inventar transição**.

A validação é feita por:

- Testes baseados em propriedades (PBT) sobre o Motor_Unificado puro (paridade Whapi×Evolution, idempotência, ausência de turno silencioso).
- Auditoria explícita dos 48 itens hoje em `CADASTRO_STEPS`, com classificação `cadastro-only` / `cta-conversacional` / `híbrido` validada pelo super-admin via perguntas em PT-BR durante o detailing.
- Comparação dos `engine_logs` em modo `dark` (Engine_V3) contra o comportamento legado, antes de qualquer promoção a `canary` ou `on`.
- Kill-switch por consultor para reverter qualquer rollout.

A decisão final entre **promover Engine_V3 a Motor_Unificado** ou **aposentar Engine_V3 e construir o Motor_Unificado a partir do Conversational** fica explicitamente registrada como requisito de DECISÃO baseada em dados (Requisito 13). Esta spec não escolhe entre as duas; ela exige que a escolha seja feita com métricas dos `engine_logs` antes de qualquer mudança em produção.

Documentação atualizada de Supabase Edge Functions, Whapi e Evolution API SHALL ser consultada via Context7 durante a fase de Design, antes do plano técnico ser fechado. Scripts de auditoria (comparação de `bot-flow.ts` Whapi vs Evolution, mapeamento de uso real dos `CADASTRO_STEPS`, análise das linhas dos `engine_logs`) SHALL ser escritos em Python e versionados junto com os documentos da spec.

---

## Glossary

- **Motor_Unificado**: o motor único e puro a ser construído por esta feature. Função pura `runEngine(state, inbound, flow, capabilities, hooks, config) → result`. É o sucessor único dos motores Legacy_Cadastro, Conversational e Engine_V3. Não chama `Date.now`, `fetch`, `Math.random` nem cliente Supabase — toda I/O fica no dispatcher e nos adapters de canal.
- **Canal**: um provedor de mensageria WhatsApp suportado pelo sistema. Hoje há dois canais ativos: `Whapi` e `Evolution`. Cada canal tem um `Adapter` próprio em `supabase/functions/_shared/channels/`.
- **Adapter_de_Canal**: módulo que traduz comandos abstratos de outbound (`text`, `choice`, `media`, `audio_slot`, `presence`) em chamadas HTTP concretas ao provedor (Whapi REST, Evolution API REST). É o único componente autorizado a conhecer detalhes do provedor.
- **Channel_Capabilities**: declaração estática do que um canal pode fazer. Inclui `supportsButtons: boolean`, `supportsList: boolean`, `supportsAudio: boolean`, `supportsVideo: boolean`, `maxButtons: number`. Vive em `_shared/channels/types.ts` e é o único campo lido pelo Motor_Unificado para decidir como renderizar uma escolha.
- **Rendering_Button**: forma de renderizar uma escolha (`step.stepType = "ask_choice"`) usando botões interativos clicáveis. Aplicável quando `Channel_Capabilities.supportsButtons = true`. Padrão para Whapi.
- **Rendering_Numbered**: forma de renderizar uma escolha como lista numerada de texto, no formato `*1.* Opção A\n*2.* Opção B`, e aceitar a resposta do lead como dígito (`1`, `2`, ...). Aplicável quando `Channel_Capabilities.supportsButtons = false`. Padrão para Evolution.
- **Step_Cadastro_Only**: passo cuja semântica é executar uma etapa do pipeline determinístico de cadastro (OCR conta, OCR doc, CPF, portal, OTP, facial). Hoje vive em `bot-flow.ts`. Não pode ser substituído por um nó `bot_flow_steps` arbitrário.
- **Step_CTA_Conversacional**: passo cuja semântica é puramente apresentar uma escolha ao lead e seguir transição conforme `bot_flow_steps.transitions`. Pode ser desenhado livremente em `/admin/fluxos`.
- **Step_Híbrido**: passo que historicamente está em `CADASTRO_STEPS` mas cuja semântica real é uma escolha conversacional, OU passo conversacional que dispara, ao casar uma transição específica, um `Step_Cadastro_Only`. Exemplo concreto: `ask_quero_cadastrar` (CTA pós-simulação que pode ramificar para o pipeline de captura de documento).
- **Auditoria_Cadastro_Steps**: processo de classificar cada um dos 48 itens hoje em `CADASTRO_STEPS` em uma das três categorias `Step_Cadastro_Only`, `Step_CTA_Conversacional` ou `Step_Híbrido`, com decisão explícita do super-admin para cada item. Resultado materializado em uma tabela versionada na spec.
- **Kill_Switch**: mecanismo por consultor (`consultants.bot_engine_mode`) que, **enquanto a flag global de produção `bot_engine_production_mode = false`**, controla se o Motor_Unificado responde aos turnos daquele consultor (`legacy` força legado, `dark`/`canary`/`on` ativam o Motor_Unificado conforme o modo). Lido em todo turno com cache de 30 segundos. WHEN `bot_engine_production_mode = true`, o Kill_Switch torna-se informativo (não desativa o Motor_Unificado para nenhum consultor).
- **Production_Mode_Global**: flag única `bot_engine_production_mode` (boolean, default `false`) controlada pelo SuperAdmin. WHEN `true`, o Motor_Unificado é o único motor de produção e responde a todos os consultores, sobrescrevendo qualquer `consultants.bot_engine_mode` individual. É o estado-alvo após a fase `on` e a fase de validação de `cleanup`.
- **Modo_Dark**: estado do Motor_Unificado em que ele roda em paralelo ao motor que de fato responde ao lead, escreve em `engine_logs`, mas **não** emite outbound. Usado para coletar evidência antes de promover.
- **Modo_Canary**: estado em que o Motor_Unificado responde de fato ao lead para um subconjunto controlado de consultores (lista explícita), enquanto os demais seguem em `Modo_Dark` ou no caminho legado.
- **Modo_On**: estado em que o Motor_Unificado responde a todos os consultores cujo `Kill_Switch` não está em `legacy`. É o estado-alvo após a fase de validação.
- **Engine_Logs**: linhas escritas pelo dispatcher na tabela `engine_logs`. Cada linha tem `kind` (ex.: `engine_step_enter`, `engine_transition_match`, `engine_repeat`, `engine_no_match`, `engine_handoff`, `engine_invalid_step`, `engine_safe_text`, `engine_dedupe_blocked`). Fonte primária de evidência para todas as métricas desta spec.
- **Inbound_Event**: evento de entrada normalizado pelo Adapter_de_Canal. Tipos: `text`, `button_click`, `number_reply`, `media`, `no_input`. O Motor_Unificado só lê `Inbound_Event`; nunca lê o JSON cru do provedor.
- **Outbound_Message**: comando abstrato de saída produzido pelo Motor_Unificado. Tipos: `text`, `choice`, `media`, `audio_slot`, `presence`. Mapeado 1:1 para um método do Adapter_de_Canal.
- **Paridade_Canal**: propriedade pela qual, dado o mesmo `state`, o mesmo `flow` e o mesmo `inbound` semanticamente equivalente (clique de botão em Whapi ↔ resposta numérica equivalente em Evolution), o Motor_Unificado produz a mesma transição de estado e a mesma sequência de `Outbound_Message` modulo apenas a estratégia de rendering (`Rendering_Button` vs `Rendering_Numbered`).
- **Round_Trip_Botão_Número**: propriedade testável segundo a qual, para todo `step.stepType = "ask_choice"` e toda opção `o`, o `buttonId` que Whapi enviaria para `o` e o dígito que Evolution receberia para `o` mapeiam para a mesma transição em `bot_flow_steps.transitions`.
- **Validação_Goto_Step**: regra pela qual qualquer `goto_step_id` proposto pelo motor ou por um hook de IA SHALL existir como `bot_flow_steps.id` no fluxo carregado; caso contrário a transição é rejeitada e cai no fallback determinístico do passo atual.
- **Handoff_Humano**: estado em que `customers.bot_paused = true` e existe uma linha em `bot_handoff_alerts` para o lead. É o único caminho de escalonamento; nunca deve haver dois alertas para a mesma pausa.

---

## Requirements

### Requirement 1: Motor único e determinístico em todos os canais

**User Story:** Como SuperAdmin operador da plataforma, quero um único motor processando todos os turnos de bot, para que qualquer fluxo desenhado no `/admin/fluxos` rode igual em Whapi e em Evolution sem trocas inesperadas de pipeline.

#### Acceptance Criteria

1. WHEN um inbound chega ao endpoint `whapi-webhook` AND o consultor dono do `customer` tem `Kill_Switch ≠ "legacy"`, THE Motor_Unificado SHALL ser invocado exatamente uma vez para aquele turno através da função `runEngine`.
2. WHEN um inbound chega ao endpoint `evolution-webhook` AND o consultor dono do `customer` tem `Kill_Switch ≠ "legacy"`, THE Motor_Unificado SHALL ser invocado exatamente uma vez para aquele turno através da função `runEngine`.
3. THE Motor_Unificado SHALL ser referencialmente transparente, de modo que o mesmo `EngineInput` produza sempre o mesmo `EngineOutput`.
4. THE Motor_Unificado SHALL NOT chamar `Date.now`, `fetch`, `Math.random`, `crypto.randomUUID` ou qualquer método de cliente Supabase.
5. WHERE valores de tempo, bucket de minuto ou chaves de idempotência são necessários dentro do Motor_Unificado, THE Motor_Unificado SHALL ler tempo exclusivamente de `EngineConfig.now`, bucket de minuto exclusivamente de `EngineConfig.minuteBucket`, e chaves de idempotência exclusivamente de `EngineConfig.idempotencyKeyFn`.
6. THE Webhook_Entry de Whapi e o Webhook_Entry de Evolution SHALL conter, fora da fronteira do Adapter_de_Canal, apenas: parse de inbound, intercept de OTP, consulta de `Kill_Switch`, chamada do Motor_Unificado e chamada do dispatcher.
7. WHEN a flag global `bot_engine_production_mode = true` (Modo_On global) está ativa, THE Roteador legado `routeEngine()` SHALL NOT decidir entre Legacy_Cadastro e Conversational para nenhum consultor, regardless do valor do `consultants.bot_engine_mode` individual (Kill_Switch), AND THE engine escolhido em qualquer turno SHALL ser sempre o Motor_Unificado. Nota de consistência: enquanto `bot_engine_production_mode = true`, o campo `consultants.bot_engine_mode` é informativo apenas (registrado em logs), AND uma reversão por consultor não é mais possível por Kill_Switch — ela exige desligar a flag global por SuperAdmin.

---

### Requirement 2: Diferença Whapi × Evolution modelada como capability de canal

**User Story:** Como cliente final em qualquer canal, quero receber a interação no formato nativo do meu app (botão clicável no Whapi, lista numerada no Evolution), para que a experiência seja fluida e a resposta numérica seja reconhecida quando eu não puder clicar.

#### Acceptance Criteria

1. THE Channel_Capabilities de Whapi SHALL declarar `supportsButtons = true`, `maxButtons = 3`.
2. THE Channel_Capabilities de Evolution SHALL declarar `supportsButtons = false`.
3. WHEN o Motor_Unificado emite um `Outbound_Message` de `kind = "choice"` AND `Channel_Capabilities.supportsButtons = true`, THE Adapter_de_Canal SHALL renderizar a escolha como botões interativos clicáveis (Rendering_Button).
4. WHEN o Motor_Unificado emite um `Outbound_Message` de `kind = "choice"` AND `Channel_Capabilities.supportsButtons = false`, THE Adapter_de_Canal SHALL renderizar a escolha como lista numerada no formato `*1.* <label>\n*2.* <label>` (Rendering_Numbered).
5. WHEN o Motor_Unificado emite `kind = "choice"` AND `choice.options.length > Channel_Capabilities.maxButtons` AND `Channel_Capabilities.supportsButtons = true`, THE Adapter_de_Canal SHALL fazer downgrade para Rendering_Numbered no mesmo turno AND SHALL escrever uma linha em `engine_logs` com `kind = "engine_choice_downgraded"`.
6. WHEN um inbound chega em canal Evolution AND o `state.lastChoiceOptions` da última outbound contém N opções AND o texto do inbound casa o regex `^\s*([1-9])\b`, THE Webhook_Entry SHALL traduzir o inbound para um `Inbound_Event` de `kind = "number_reply"` apontando para a opção correspondente.
7. WHEN um inbound chega em canal Whapi como clique de botão, THE Webhook_Entry SHALL traduzi-lo para um `Inbound_Event` de `kind = "button_click"` cujo `buttonId` é o ID do botão clicado.
8. THE código do Motor_Unificado SHALL NOT conter ramo condicional sobre o nome do canal (`if (channel === "whapi")`); toda decisão dependente de canal SHALL ler exclusivamente de `Channel_Capabilities`.
9. WHERE um Adapter_de_Canal recebe um `Outbound_Message` cuja renderização exige uma capability não declarada (ex.: `kind = "audio_slot"` em canal com `supportsAudio = false`), THE Adapter_de_Canal SHALL fazer downgrade documentado para `kind = "text"` com o texto do slot AND SHALL escrever em `engine_logs` linha `kind = "engine_capability_downgrade"`.

---

### Requirement 3: Auditoria explícita dos 48 CADASTRO_STEPS

**User Story:** Como SuperAdmin, quero que cada um dos 48 passos hoje listados em `CADASTRO_STEPS` seja classificado e validado por mim, para que steps híbridos (como `ask_quero_cadastrar`) deixem de ser silenciosamente forçados ao motor legado quando o desenho do fluxo no `/admin/fluxos` espera comportamento conversacional.

#### Acceptance Criteria

1. THE Auditoria_Cadastro_Steps SHALL produzir uma tabela em `.kiro/specs/bot-engine-channel-unification/cadastro-steps-audit.md` listando cada um dos 48 itens hoje em `CADASTRO_STEPS` exatamente uma vez, com as colunas `step_key`, `categoria ∈ {cadastro-only, cta-conversacional, híbrido}`, `evidência_em_código` (caminho de arquivo + intervalo de linhas) e `decisão_super_admin`.
2. THE Auditoria_Cadastro_Steps SHALL ser preenchida durante a fase de Design por meio de perguntas de clarificação em português brasileiro feitas ao SuperAdmin, uma rodada de perguntas por subgrupo de steps (OCR conta, OCR doc, dados pessoais, endereço, portal/OTP, edição pós-OCR, CTAs híbridos).
3. WHEN a Auditoria_Cadastro_Steps é gerada, THE Auditoria_Cadastro_Steps SHALL ser baseada em script Python versionado em `.kiro/specs/bot-engine-channel-unification/audit-cadastro-steps.py` que faz `grep` em ambos `bot-flow.ts` (Whapi e Evolution) e produz a evidência de uso real de cada `step_key`.
4. FOR ALL items classificados como `cadastro-only`, THE Motor_Unificado SHALL delegar a execução do passo ao módulo `pipeline-cadastro` (sucessor unificado de `bot-flow.ts`) AND SHALL NOT permitir override por `bot_flow_steps`.
5. FOR ALL items classificados como `cta-conversacional`, THE Motor_Unificado SHALL ler o passo de `bot_flow_steps` AND SHALL NOT consultar a lista herdada `CADASTRO_STEPS`.
6. FOR ALL items classificados como `híbrido`, THE Motor_Unificado SHALL primeiro tentar casar uma transição em `bot_flow_steps.transitions`; IF nenhuma transição casa, THEN THE Motor_Unificado SHALL delegar ao `pipeline-cadastro`.
7. WHEN o documento de Design é considerado pronto, THE Documento_Design SHALL conter uma seção que cita explicitamente o resultado da Auditoria_Cadastro_Steps e mostra o veredito por categoria; sem essa seção o Design não pode avançar para Tasks.
8. THE constante `CADASTRO_STEPS` em `_shared/flow-router.ts` SHALL ser removida ou marcada como `@deprecated` com comentário apontando para `cadastro-steps-audit.md` ao final do rollout em `Modo_On`.

---

### Requirement 4: Paridade total entre Whapi e Evolution para qualquer fluxo

**User Story:** Como consultor que desenha um fluxo no `/admin/fluxos`, quero que o lead receba o mesmo conteúdo em qualquer canal, para que eu não tenha que duplicar regras nem testar dois caminhos.

#### Acceptance Criteria

1. FOR ALL `step` em `bot_flow_steps`, FOR ALL `state` válido, WHEN o Motor_Unificado roda com `Channel_Capabilities` de Whapi e o resultado em `Channel_Capabilities` de Evolution para o mesmo `inbound` semanticamente equivalente, THE sequência de `Outbound_Message` SHALL ser idêntica modulo apenas a estratégia de rendering das escolhas (`Rendering_Button` em Whapi, `Rendering_Numbered` em Evolution).
2. FOR ALL `step` em `bot_flow_steps` cujo `step.stepType = "ask_choice"`, FOR ALL opção `o` declarada no passo, THE buttonId emitido em Whapi para `o` AND o índice numérico emitido em Evolution para `o` SHALL mapear para a mesma transição quando o lead responde (Round_Trip_Botão_Número).
3. THE testes baseados em propriedades SHALL exercitar o critério 4.1 com pelo menos 100 iterações de `(step, state, inbound)` aleatórios cobrindo todos os `stepType` declarados em `bot_flow_steps`.
4. THE testes baseados em propriedades SHALL exercitar o critério 4.2 com pelo menos 100 iterações de `(step ask_choice, opção)` aleatórios.
5. WHEN o teste de paridade Whapi×Evolution falha, THE pipeline de CI SHALL bloquear o merge AND SHALL anexar ao job o contraexemplo encontrado pelo PBT.
6. THE divergência atual de ≈623 linhas entre `whapi-webhook/handlers/bot-flow.ts` e `evolution-webhook/handlers/bot-flow.ts` SHALL ser zerada ao final do rollout em `Modo_On`, validada por script Python que reporta `0` diff linha-a-linha em uma versão normalizada (sem comentários e sem espaços em branco).
7. THE divergência atual de ≈272 linhas entre `whapi-webhook/handlers/conversational/index.ts` e `evolution-webhook/handlers/conversational/index.ts` SHALL ser zerada ao final do rollout em `Modo_On`, sob o mesmo critério.

---

### Requirement 5: Ordem de mídia consistente em todos os canais

**User Story:** Como consultor, quero que a ordem em que texto, áudio, vídeo e imagem chegam ao lead seja exatamente a que eu configurei no `/admin/fluxos`, para que minha narrativa de venda chegue na sequência correta independente do canal.

#### Acceptance Criteria

1. WHEN um passo tem `flow.mediaOrderByStepKey[step.stepKey]` definido e não vazio, THE Motor_Unificado SHALL emitir os `Outbound_Message` na ordem exata declarada nesse vetor.
2. WHEN um passo não tem `flow.mediaOrderByStepKey[step.stepKey]` definido ou tem o vetor vazio, THE Motor_Unificado SHALL emitir os `Outbound_Message` na ordem natural de construção (texto, depois opções de escolha, depois mídias declaradas).
3. THE Motor_Unificado SHALL emitir cada `Outbound_Message` com um campo `idempotencyContent` não vazio.
4. WHEN o Motor_Unificado emite mais de um `Outbound_Message` em um turno, THE Motor_Unificado SHALL garantir que dois itens adjacentes nunca tenham o mesmo `idempotencyContent`.
5. WHEN o último `Outbound_Message` de um turno tem `idempotencyContent = X` AND o primeiro `Outbound_Message` do próximo turno também teria `idempotencyContent = X` AND menos de 2 segundos passaram desde o último envio AND o `Outbound_Message` candidato do novo turno NÃO está marcado com `intentionalRepeat = true` por configuração explícita do passo, THE Motor_Unificado SHALL descartar esse primeiro outbound do novo turno AND SHALL escrever em `engine_logs` linha `kind = "engine_dedupe_blocked"`. WHERE o passo declara repetição intencional (`step.allowAdjacentRepeat = true`) ou o `Outbound_Message` é marcado pelo construtor como `intentionalRepeat = true`, THE Motor_Unificado SHALL preservar o outbound idêntico AND SHALL escrever em `engine_logs` linha `kind = "engine_repeat_intentional"`.
6. WHEN `Channel_Capabilities.supportsAudio = false` AND o passo declara mídia de áudio, THE Adapter_de_Canal SHALL fazer downgrade para `Outbound_Message` de `kind = "text"` com o conteúdo de transcrição configurado AND SHALL escrever em `engine_logs` linha `kind = "engine_capability_downgrade"`.

---

### Requirement 6: Sem turno silencioso

**User Story:** Como lead, quero receber uma resposta sempre que eu mandar uma mensagem, para que eu nunca sinta que o bot me ignorou.

#### Acceptance Criteria

1. WHEN `inbound.kind ∈ {text, button_click, number_reply, media}`, THE Motor_Unificado SHALL retornar um resultado em que `outbound.length ≥ 1` OR uma deferred-action visível em `logs` como `engine_ai_answer_deferred`, `engine_ai_decide_deferred`, ou um log de OCR/portal deferido.
2. WHEN nenhuma transição casa AND `step.fallback` é nulo AND nenhum handler de fallback produz outbound nem deferred-action, THE Motor_Unificado SHALL emitir um único `Outbound_Message` de `kind = "text"` cujo conteúdo é `step.messageText` quando não vazio, caso contrário a string literal `"Pode me responder, por favor? 🙂"`. IF `step.fallback` está declarado mas o handler executou sem produzir outbound nem deferred-action, THEN THE Motor_Unificado SHALL emitir log `kind = "engine_fallback_silent"` com `payload.fallback_mode = step.fallback.mode` AND SHALL aplicar o caminho de safe-text desta mesma forma.
3. WHEN o caminho do critério 6.2 dispara, THE Motor_Unificado SHALL emitir log `kind = "engine_safe_text"` AND log `kind = "engine_no_match"` para o turno.
4. IF um erro interno do Motor_Unificado impede a geração normal de outbound para um inbound de kind ∈ {`text`, `button_click`, `number_reply`, `media`}, THEN THE Webhook_Entry SHALL emitir o safe-text literal `"Pode me responder, por favor? 🙂"` no canal correto AND SHALL escrever log `kind = "engine_safe_text"` AND SHALL NOT delegar ao motor legado naquele turno, mesmo que o caminho de safe-text execute corretamente — a proibição de delegação ao legado é absoluta enquanto o consultor está em `bot_engine_mode ∈ {"canary", "on"}`.

---

### Requirement 7: Validação de `goto_step_id` e contenção da IA

**User Story:** Como SuperAdmin, quero que toda transição produzida pelo motor (incluindo as propostas pela IA) seja validada contra os passos que existem no fluxo carregado, para que a IA nunca leve o lead a um step inexistente.

#### Acceptance Criteria

1. FOR ALL `goto_step_id` proposto por uma transição declarada, por um fallback ou por um deferred-action de IA, THE Motor_Unificado SHALL verificar que `goto_step_id` existe em `flow.steps` antes de aplicar a transição.
2. IF uma transição proposta tem `goto_step_id` que não existe em `flow.steps`, THEN THE Motor_Unificado SHALL rejeitar a transição AND SHALL aplicar o fallback determinístico do passo atual AND SHALL escrever em `engine_logs` linha `kind = "engine_invalid_step"` com `payload.proposed_goto = <id>`.
3. WHEN `flow.strict_mode = true`, THE Motor_Unificado SHALL NOT executar fallbacks de modo `ai` ou `ai_answer` AND SHALL ignorar qualquer deferred-action de IA proposta pelos hooks.
4. WHEN um deferred-action de IA retorna ao Motor_Unificado, THE resposta da IA SHALL ser validada por critério 7.1 antes de ser aplicada como transição.
5. THE Motor_Unificado SHALL emitir exatamente um log de decisão por turno, escolhido de `{engine_transition_match, engine_repeat, engine_goto, engine_safe_text, engine_handoff, engine_ai_answer_deferred, engine_ai_decide_deferred, engine_no_match, engine_invalid_step}`.

---

### Requirement 8: Kill-switch por consultor (subordinado à Production_Mode_Global)

**User Story:** Como SuperAdmin operando o rollout, quero poder desligar o Motor_Unificado para um consultor específico em segundos sem fazer deploy enquanto a flag global de produção ainda não está ativa, para que um problema localizado no rollout não vire um incidente para os doze consultores ao mesmo tempo. Após `bot_engine_production_mode = true`, aceito explicitamente que o Kill_Switch individual deixe de desativar o Motor_Unificado, porque a meta nesse ponto é zero divergência entre consultores.

#### Acceptance Criteria

1. THE tabela `consultants` SHALL ter uma coluna `bot_engine_mode` com domínio `{"legacy", "dark", "canary", "on"}` e default `"legacy"`.
2. THE configuração global SHALL incluir uma flag `bot_engine_production_mode` (boolean, default `false`) controlada exclusivamente pelo SuperAdmin via UI dedicada com confirmação explícita.
3. WHEN um inbound é processado, THE Webhook_Entry SHALL ler `bot_engine_production_mode` e `consultants.bot_engine_mode` para o consultor dono do customer com cache em memória de TTL ≤ 30 segundos.
4. WHEN `bot_engine_production_mode = true`, THE Webhook_Entry SHALL invocar o Motor_Unificado para responder ao lead em todos os turnos, regardless do valor de `consultants.bot_engine_mode`, AND SHALL escrever em cada `engine_logs` linha o campo `payload.production_override = true` quando o `bot_engine_mode` individual seria `legacy`.
5. WHILE `bot_engine_production_mode = false` AND `bot_engine_mode = "legacy"` para o consultor, THE Webhook_Entry SHALL NOT invocar o Motor_Unificado para aquele turno AND SHALL invocar o caminho legado.
6. WHILE `bot_engine_production_mode = false` AND `bot_engine_mode = "dark"` para o consultor, THE Webhook_Entry SHALL invocar o Motor_Unificado em paralelo para fins de logging em `engine_logs` AND SHALL responder ao lead com a saída do caminho legado.
7. WHILE `bot_engine_production_mode = false` AND `bot_engine_mode ∈ {"canary", "on"}` para o consultor, THE Webhook_Entry SHALL responder ao lead com a saída do Motor_Unificado AND SHALL NOT executar o caminho legado para aquele turno.
8. THE UI SuperAdmin SHALL expor (i) um controle por consultor que altera `bot_engine_mode` de e para qualquer um dos quatro valores e (ii) um controle global único que alterna `bot_engine_production_mode` com confirmação explícita ("digite 'PRODUCAO' para confirmar"); ambos SHALL invalidar o cache de leitura em todas as instâncias de Edge Function em até 60 segundos após a mudança.
9. IF a leitura de `bot_engine_mode` ou `bot_engine_production_mode` falha (timeout, erro de rede), THEN THE Webhook_Entry SHALL usar o último valor cacheado em memória para a chave correspondente quando ele existir e ainda estiver dentro do TTL estendido de 5 minutos AND SHALL escrever log `kind = "engine_killswitch_read_failed_using_cache"`; quando não houver cache válido, THE Webhook_Entry SHALL assumir `bot_engine_production_mode = false` AND `bot_engine_mode = "legacy"` AND SHALL escrever log `kind = "engine_killswitch_read_failed"`.
10. IF a leitura de `bot_engine_mode` retorna sucesso mas com valor fora do domínio `{"legacy", "dark", "canary", "on"}`, THEN THE Webhook_Entry SHALL tratar o turno como `bot_engine_mode = "legacy"` AND SHALL escrever log `kind = "engine_killswitch_invalid_value"` com `payload.observed_value = <valor>` AND SHALL inserir uma linha em `bot_handoff_alerts` com `reason = "engine_killswitch_invalid_value"` para revisão pelo SuperAdmin.

---

### Requirement 9: Observabilidade via `engine_logs`

**User Story:** Como SuperAdmin, quero ver em `engine_logs` exatamente quem decidiu o que em cada turno, para que eu possa diagnosticar qualquer comportamento divergente entre Whapi e Evolution sem precisar reproduzir o caso.

#### Acceptance Criteria

1. FOR ALL turno processado pelo Motor_Unificado, THE dispatcher SHALL escrever pelo menos uma linha em `engine_logs` com `kind = "engine_step_enter"` no início do turno AND uma linha de decisão com um dos `kind` enumerados no Requisito 7.5 AND uma linha por `Outbound_Message` emitido.
2. THE coluna `engine_logs.payload` SHALL conter para cada linha de decisão pelo menos os campos `channel ∈ {"whapi", "evolution"}`, `mode ∈ {"dark", "canary", "on"}`, `consultant_id`, `customer_id`, `flow_id`, `step_id`, `inbound_kind`, `transition_id`.
3. WHEN o Motor_Unificado roda em `Modo_Dark`, THE dispatcher SHALL escrever as linhas de outbound com `payload.shadowed = true` e SHALL NOT enviar a mensagem ao canal.
4. THE SuperAdmin SHALL ter uma view em `/admin` que agrega `engine_logs` por consultor, modo e canal nas últimas 72 horas, mostrando contagem por `kind`.
5. WHEN o número de linhas com `kind = "engine_invalid_step"` em uma janela de 1 hora para um consultor excede 5, THE sistema SHALL inserir uma linha em `bot_handoff_alerts` com `reason = "engine_invalid_step_burst"` AND, WHILE `bot_engine_production_mode = false`, SHALL setar `bot_engine_mode = "legacy"` para aquele consultor AND SHALL emitir log `kind = "engine_killswitch_auto"`. WHILE `bot_engine_production_mode = true`, THE sistema SHALL emitir log `kind = "engine_killswitch_auto_suppressed"` em vez de alterar `bot_engine_mode` (porque a flag global ignora kill-switches individuais), AND SHALL inserir uma linha adicional em `bot_handoff_alerts` com `reason = "engine_invalid_step_burst_production_locked"` AND SHALL notificar o SuperAdmin para avaliação manual da flag global.

---

### Requirement 10: Único canal de escalonamento

**User Story:** Como consultor, quero que cada conversa pausada gere exatamente um alerta no meu painel, para que eu nunca perca um handoff e nunca veja alertas duplicados para a mesma pausa.

#### Acceptance Criteria

1. WHEN o Motor_Unificado retorna `stateUpdate.status = "paused_system"`, THE Motor_Unificado SHALL emitir exatamente uma entrada em `result.logs` carregando `sideEffect.kind = "insert_handoff_alert"`, e essa contagem-de-um SHALL ser enforçada diretamente neste critério (o enforcement não é delegado ao dispatcher).
2. WHEN o dispatcher recebe um log com `sideEffect.kind = "insert_handoff_alert"`, THE dispatcher SHALL garantir a inserção de exatamente uma linha em `bot_handoff_alerts` para aquele turno, retentando em falhas transitórias até a inserção ter sucesso ou cair em DLQ AND SHALL NOT silenciosamente descartar o alerta.
3. WHEN `stateUpdate.status ≠ "paused_system"`, THE Motor_Unificado SHALL NOT emitir log com `sideEffect.kind = "insert_handoff_alert"`.

---

### Requirement 11: Rollout faseado e reversível, com transição final irreversível por design

**User Story:** Como SuperAdmin, quero que a saída do código duplicado e a entrada do Motor_Unificado sejam faseadas e reversíveis enquanto a flag global de produção estiver desligada, e que após eu ligar a flag global a transição seja deliberadamente irreversível por kill-switch individual, para que os doze consultores em produção nunca percam atendimento durante a transição e para que a estabilização final não seja ameaçada por uma reversão por consultor.

#### Acceptance Criteria

1. THE plano de rollout SHALL ser dividido em cinco fases ordenadas: `dark`, `canary` (lista explícita de consultores), `on` (todos os consultores aprovados em `bot_engine_mode = "on"` com `bot_engine_production_mode = false`), `production_lock` (`bot_engine_production_mode = true`), `cleanup` (remoção dos códigos duplicados).
2. WHEN a fase `dark` está ativa, THE Motor_Unificado SHALL rodar em paralelo para todos os doze consultores aprovados durante pelo menos 7 dias corridos com `engine_logs` ininterrupto antes da fase `canary` poder começar.
3. WHEN a fase `canary` é iniciada, THE lista inicial de consultores em `Modo_Canary` SHALL respeitar o limite configurável `bot_engine_canary_max_consultants` (default `3`, máximo absoluto `5`) AND SHALL ser definida explicitamente no documento de Design.
4. WHEN a fase `production_lock` é iniciada, THE SuperAdmin SHALL setar `bot_engine_production_mode = true` somente após todos os consultores aprovados estarem em `bot_engine_mode = "on"` por pelo menos 7 dias corridos consecutivos sem nenhum acionamento de `engine_killswitch_auto`.
5. THE fase `cleanup` SHALL apagar os arquivos `whapi-webhook/handlers/bot-flow.ts`, `evolution-webhook/handlers/bot-flow.ts`, `whapi-webhook/handlers/conversational/index.ts`, `evolution-webhook/handlers/conversational/index.ts` somente quando `bot_engine_production_mode = true` por pelo menos 14 dias corridos consecutivos sem nenhum acionamento de `engine_killswitch_auto_suppressed`. WHEN um acionamento de `engine_killswitch_auto_suppressed` ocorrer durante essa janela, THE contador de 14 dias SHALL ser reiniciado a zero AND SHALL exigir nova janela contínua de 14 dias sem acionamentos antes que `cleanup` possa ser executado.
6. WHEN a fase `cleanup` é executada, THE constante `CADASTRO_STEPS` em `_shared/flow-router.ts` SHALL ser removida AND THE função `routeEngine()` SHALL ser removida AND THE testes relacionados SHALL ser excluídos.
7. WHILE `bot_engine_production_mode = false`, IF qualquer passo do rollout precisa ser revertido, THEN THE reversão SHALL ser feita exclusivamente alterando `consultants.bot_engine_mode` (Kill_Switch) para os consultores afetados, SEM redeploy.
8. WHILE `bot_engine_production_mode = true`, IF um problema de produção é detectado, THEN THE única reversão disponível SHALL ser desligar `bot_engine_production_mode` via UI SuperAdmin (que volta o sistema ao comportamento por consultor), AND THE alteração de `consultants.bot_engine_mode` SHALL NOT desativar o Motor_Unificado enquanto a flag global estiver `true`.

---

### Requirement 12: Validação por Property-Based Tests

**User Story:** Como engenheiro de QA, quero que as garantias do Motor_Unificado sejam expressas como propriedades testáveis, para que eu encontre contraexemplos automaticamente em vez de depender de cenários manuais.

#### Acceptance Criteria

1. THE suíte de testes SHALL conter uma propriedade `parity_whapi_evolution`: para todo `(state, flow, inbound)` gerado, `runEngine` com `Channel_Capabilities` Whapi e `runEngine` com `Channel_Capabilities` Evolution produzem `stateUpdate` idênticos AND produzem `outbound[]` semanticamente equivalentes (Rendering_Button vs Rendering_Numbered como única diferença).
2. THE suíte de testes SHALL conter uma propriedade `round_trip_button_number`: para todo `step ask_choice` e toda opção `o`, o `buttonId` que Whapi enviaria e o dígito que Evolution receberia para `o` mapeiam para a mesma transição.
3. THE suíte de testes SHALL conter uma propriedade `idempotência_de_outbound`: para todo turno com mais de um outbound, dois itens adjacentes nunca têm o mesmo `idempotencyContent`.
4. THE suíte de testes SHALL conter uma propriedade `sem_turno_silencioso`: para todo `(state, flow, inbound)` com `inbound.kind ∈ {text, button_click, number_reply, media}`, `runEngine` retorna `outbound.length ≥ 1` ou um log de deferred-action.
5. THE suíte de testes SHALL conter uma propriedade `validade_goto`: para todo turno em que `runEngine` aplica uma transição, `goto_step_id` resultante existe em `flow.steps`.
6. THE suíte de testes SHALL conter uma propriedade `decisão_única`: para todo turno, exatamente um log de decisão é emitido (lista do Requisito 7.5).
7. THE suíte de testes SHALL conter teste de regressão dos 48 itens hoje em `CADASTRO_STEPS`, executando um cenário concreto por step em ambos os canais Whapi e Evolution, comparando o `stateUpdate` e o `outbound` resultantes contra um snapshot revisado por humano.
8. WHEN qualquer propriedade dos critérios 12.1 a 12.6 falha OR um contraexemplo é registrado pela ferramenta de PBT mesmo com o teste reportando sucesso (ex.: shrink encontrou caso e o framework não falhou o assert), THE pipeline de CI SHALL anexar ao job o contraexemplo encontrado pelo PBT (semente, `state`, `inbound`, `outbound[]` de cada lado) AND SHALL bloquear o merge incondicionalmente, sem possibilidade de override por status alternativo de pipeline.

---

### Requirement 13: Decisão fundamentada sobre o destino do Engine_V3

**User Story:** Como SuperAdmin, quero que a escolha entre promover Engine_V3 a Motor_Unificado ou aposentar Engine_V3 e construir o Motor_Unificado a partir do Conversational seja registrada com base nas métricas reais dos `engine_logs`, para que essa decisão não seja por intuição.

#### Acceptance Criteria

1. THE Documento_Design SHALL conter uma seção "Decisão sobre o destino do Engine_V3" que registra explicitamente uma das duas opções: (a) promover Engine_V3 a Motor_Unificado, ou (b) aposentar Engine_V3 e construir o Motor_Unificado a partir do Conversational unificado.
2. THE seção do critério 13.1 SHALL ser fundamentada em três métricas extraídas de `engine_logs` das últimas 72 horas em `Modo_Dark`: taxa de divergência de decisão Engine_V3 versus motor que respondeu, contagem de `engine_invalid_step` por consultor, contagem de `engine_no_match` por consultor.
3. THE script Python de extração das métricas do critério 13.2 SHALL ser versionado em `.kiro/specs/bot-engine-channel-unification/v3-vs-legacy-metrics.py`.
4. WHEN a decisão registrada é (a), THE plano de tasks SHALL incluir tasks de promoção do Engine_V3 (preencher gaps identificados, mover para `Modo_Canary`) AND THE seção do critério 13.1 SHALL NOT ser considerada concluída até essas tasks aparecerem em `tasks.md`.
5. WHEN a decisão registrada é (b), THE plano de tasks SHALL incluir tasks de unificação dos dois Conversational (Whapi + Evolution) para um único módulo, e tasks de aposentadoria controlada do Engine_V3 (manter logs históricos, parar de gerar novos) AND THE seção do critério 13.1 SHALL NOT ser considerada concluída até essas tasks aparecerem em `tasks.md`.

---

### Requirement 14: Consulta a documentação atualizada via Context7

**User Story:** Como SuperAdmin, quero que a fase de Design consulte a documentação atualizada de Supabase Edge Functions, Whapi e Evolution API antes de fechar decisões técnicas, para que o desenho não fique baseado em comportamento desatualizado das APIs externas.

#### Acceptance Criteria

1. WHEN a fase de Design é iniciada, THE Documento_Design SHALL listar consultas Context7 feitas para os tópicos mínimos: limites e payload de Supabase Edge Functions, contrato de `sendButtons` de Whapi, contrato de mensagens interativas em Evolution API, e nuances de webhook retry de cada provedor.
2. THE Documento_Design SHALL anotar para cada consulta Context7 a versão / data da documentação consultada.
3. IF uma consulta Context7 retorna comportamento que invalida um pressuposto desta spec (ex.: limite de botões diferente do declarado em `Channel_Capabilities`), THEN, condicionado a que as consultas Context7 listadas no critério 14.1 já tenham sido todas concluídas e registradas, THE Documento_Design SHALL referenciar a discrepância AND SHALL atualizar o requisito correspondente desta spec via uma seção de "Correções pós-Context7" antes de avançar para Tasks. WHILE qualquer das consultas obrigatórias do critério 14.1 estiver pendente, THE manuseio de discrepâncias SHALL ser bloqueado AND THE Design SHALL NOT avançar para Tasks.

---

### Requirement 15: Scripts de auditoria e comparação em Python

**User Story:** Como engenheiro encarregado da unificação, quero que toda comparação mecânica entre Whapi e Evolution e toda contagem de uso real dos `CADASTRO_STEPS` seja feita por scripts Python versionados, para que esses números sejam reproduzíveis e auditáveis.

#### Acceptance Criteria

1. THE script `.kiro/specs/bot-engine-channel-unification/diff-bot-flow.py` SHALL comparar `whapi-webhook/handlers/bot-flow.ts` e `evolution-webhook/handlers/bot-flow.ts` em uma forma normalizada (sem comentários, sem espaços em branco redundantes) AND SHALL produzir contagem de linhas divergentes por região do arquivo.
2. THE script `.kiro/specs/bot-engine-channel-unification/diff-conversational.py` SHALL fazer o equivalente do critério 15.1 para `whapi-webhook/handlers/conversational/index.ts` e `evolution-webhook/handlers/conversational/index.ts`.
3. THE script `.kiro/specs/bot-engine-channel-unification/audit-cadastro-steps.py` SHALL produzir, para cada um dos 48 step_keys em `CADASTRO_STEPS`, a contagem de matches encontrados em ambos os `bot-flow.ts` AND a categoria proposta (`cadastro-only`, `cta-conversacional`, `híbrido`) com base em heurística declarada na docstring.
4. THE script `.kiro/specs/bot-engine-channel-unification/v3-vs-legacy-metrics.py` SHALL extrair as três métricas exigidas pelo Requisito 13.2 a partir de `engine_logs` lendo via Supabase REST.
5. FOR ALL os scripts dos critérios 15.1 a 15.4, THE script SHALL imprimir um JSON estruturado em stdout AND SHALL ter `--help` documentando entradas e saídas AND SHALL ser executável com `python3 nome-do-script.py` sem dependências fora da stdlib além das já presentes em `.tmp/` (ex.: `requests`).

---
