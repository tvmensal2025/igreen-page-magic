# Auditoria de paridade — Fluxo D entre Whapi e Evolution

Data: 2026-06-27
Escopo: confirmar que o Fluxo D (variante D, template público) é executado de
forma idêntica para todos os números conectados pelos consultores,
independentemente do canal (Whapi ou Evolution). A única divergência permitida
é a renderização de escolhas (botão interativo no Whapi × lista numerada
`*1.* / *2.*` no Evolution) e a captura da resposta correspondente.

Modo: **somente leitura**. Nenhuma alteração de fluxo, código de produção,
migração ou deploy foi feita.

---

## 1. Resolução do fluxo (configuração no banco) — ✅ OK

Consulta direta em `bot_flows` (variante D, ativos):

| Consultor                       | flow_id        | is_public | sync_mode | Resolve para         |
| ------------------------------- | -------------- | --------- | --------- | -------------------- |
| Rafael Ferreira (super-admin)   | `320bf22c…558` | **true**  | custom    | `320bf22c` (próprio) |
| Bruna Roberta da Costa          | `22b628c3…7`   | false     | public    | `320bf22c` ✅         |
| silviaclaudiaalmeida            | `fbd9cadd…c`   | false     | public    | `320bf22c` ✅         |
| olimpiajanete15                 | `b2aad73d…9`   | false     | public    | `320bf22c` ✅         |
| Abel Olympio de Oliveira        | `7fa0fab1…0`   | false     | public    | `320bf22c` ✅         |
| henzofelipef                    | `5801a046…b`   | false     | public    | `320bf22c` ✅         |
| elizavip4545                    | `e360cc4a…d`   | false     | public    | `320bf22c` ✅         |

100% dos consultores com Fluxo D ativo (exceto o super-admin, que é o
**dono** do template público) estão em `sync_mode='public'`. A resolução é
feita por `_shared/resolve-flow.ts`, arquivo único, importado pelos dois
webhooks. Resultado: **todos recebem o mesmo `flow_id`** quando o motor vai
carregar passos, transições e mídia. As mídias seguem `resolveMediaOwnerId`,
também unificado, e apontam para o super-admin → áudios/vídeos/imagens do
Fluxo D são os mesmos para todos.

Veredito da camada de configuração: **paridade total ✅**.

---

## 2. Diferenças permitidas (canal) — ✅ corretas

| Item                       | Whapi                       | Evolution                       |
| -------------------------- | --------------------------- | ------------------------------- |
| Render de `ask_choice`     | botões interativos (≤3)     | texto numerado `*1.* / *2.*`    |
| Captura da resposta        | `button_id`                 | dígito no texto                 |
| Adapter                    | `_shared/channels/dispatch-choice.ts` (já único) | idem |

Estão modeladas como capability e não exigem ação.

---

## 3. Divergências de REGRA (motor) — ❌ não deveriam existir

Comparação automatizada dos handlers:

```
whapi-webhook/handlers/bot-flow.ts            6.267 linhas
evolution-webhook/handlers/bot-flow.ts        5.804 linhas
  → 196 blocos divergentes (~30 canal-OK, ~54 RULE-DIFF, ~112 outros/comentários)

whapi-webhook/handlers/conversational/index.ts   2.867 linhas
evolution-webhook/handlers/conversational/index.ts 2.626 linhas
  → 122 blocos divergentes (~23 canal-OK, ~29 RULE-DIFF, ~70 outros/comentários)
```

### 3.1 BUG-paridade — somente no Whapi (Evolution NÃO tem)

| # | Regra                                                | Whapi (linha)                     | Evolution | Impacto no Fluxo D |
|---|------------------------------------------------------|-----------------------------------|-----------|--------------------|
| 1 | `stepHasInteractiveWait` + `__post_bill_wait_step_id` (fix de auto-avanço pós-simulação) | `bot-flow.ts:134, 4195, 4274, 4329, 4379` | **AUSENTE** | Em Evolution, o lead que receber a simulação (`d_resultado`) pode ainda ser empurrado para `capture_documento` sem clicar — exatamente o bug que acabamos de corrigir só em Whapi |
| 2 | LGPD opt-out (`SAIR`/`PARAR`/`STOP`/`CANCELAR`)      | `conversational/index.ts:821-849` | **AUSENTE** | Cliente Evolution não consegue sair com palavra-chave |
| 3 | ANTI-WELCOME-DUPLICADO (não reentra welcome se outbound recente) | `conversational/index.ts:1163-1197` | **AUSENTE** | Evolution pode disparar welcome em duplicidade |
| 4 | INTERCEPÇÃO DE ADIAMENTO (“amanhã eu mando”, “tô sem luz”) em passos de captura | `bot-flow.ts:2789-2852` | **AUSENTE** | Evolution não reconhece adiamento → continua repetindo capture |
| 5 | LOCK GLOBAL: consultor com fluxo custom ativo NUNCA cai em passos legacy | `bot-flow.ts:2930-2983` | **AUSENTE** | Em Evolution, lead pode escapar do fluxo custom para passos legacy |
| 6 | Redirect de `capture_documento` → `capture_conta` quando lead ainda não enviou conta | `bot-flow.ts:3077-3078` (bloco vizinho) | **AUSENTE** | Evolution pode pedir documento antes da conta |

### 3.2 BUG-paridade — valores diferentes entre canais

| # | Regra                                                | Whapi            | Evolution         |
|---|------------------------------------------------------|------------------|-------------------|
| 7 | Step persistido após confirmar a conta               | `aguardando_conta` (`bot-flow.ts:2581-2583`) | `aguardando_doc_auto` (`bot-flow.ts:2464-2466`) — leads do mesmo Fluxo D terminam em estados diferentes |
| 8 | Threshold de desvios para handoff alert              | 8 (`bot-flow.ts:1133`) | 5 (`bot-flow.ts:1117`) |
| 9 | Teto de `initial_delay_seconds`                      | 300s (`conversational/index.ts:957`) | 15s (`conversational/index.ts:902-904`) — flow com delay grande nunca dispara em Evolution |
| 10 | Select de passos do flow                            | sem `transitions, step_type` (`bot-flow.ts:1253`) | inclui `transitions, step_type` (`bot-flow.ts:1256`) → comportamento de transição muda |
| 11 | Fallback de mídia pública quando consultor não tem nada no slot | já existe via outro caminho | bloco explícito em `conversational/index.ts:227-235` e `445-453` — verificar se o ramo do Whapi cobre os mesmos casos |

### 3.3 Paridade confirmada (não precisa de ação)

- `step-mismatch-cure` (auto-cura de step órfão entre variantes): **presente
  nos dois** (`whapi-webhook/index.ts:1875` e `evolution-webhook/index.ts:1820`). ✅
- `conversational-send-idempotency` (deduplicação de envio): **importado e
  usado nos dois** (`whapi-webhook/index.ts:30` e `evolution-webhook/index.ts:40`). ✅
- `_shared/bot/state-machine`, `_shared/bot/templates`, `_shared/bot/step-namespace`:
  já vivem em shim único, importado pelos dois lados. ✅
- `_shared/resolve-flow.ts` e `_shared/pick-flow-variant.ts`: únicos. ✅

---

## 4. Veredito final

| Camada              | Status     | Observação |
|---------------------|------------|------------|
| Resolução de fluxo  | ✅ idêntico | Todos resolvem para `320bf22c` |
| Resolução de mídia  | ✅ idêntico | `resolveMediaOwnerId` único |
| Render de escolha   | ✅ canal-OK | Botão vs lista numerada (esperado) |
| **Motor de execução** | ❌ **6 regras só em Whapi + 5 valores divergentes** | Detalhes em §3.1 e §3.2 |

O Fluxo D **NÃO** está sendo executado igualmente nos dois canais. A
configuração no banco é única, mas o miolo dos webhooks continua duplicado e
acumula divergências reais — incluindo o fix recente de auto-avanço pós-
simulação, que precisa ser portado para o Evolution antes que reapareça lá.

---

## 5. Recomendação

1. **Curto prazo (paridade urgente)** — portar para o Evolution as 6 regras
   da §3.1 e alinhar os 5 valores da §3.2. Especialmente crítico:
   - item 1 (`stepHasInteractiveWait`) — reproduz no Evolution o bug que
     acabamos de corrigir no Whapi.
   - item 7 (`conversation_step` divergente após a conta).
   - item 10 (`select` sem `transitions` no Whapi pode quebrar transições do
     Fluxo D em Whapi quando o consultor edita transições no Flow Builder).
2. **Médio prazo** — seguir a spec `bot-engine-channel-unification` já
   iniciada: extrair o miolo de `bot-flow.ts` e `conversational/index.ts`
   para `_shared/bot/` e deixar `whapi-webhook` e `evolution-webhook` só com
   parse de inbound, persistência e adapter de canal. Isso elimina por
   construção qualquer nova divergência.

Nenhuma das ações acima foi executada nesta auditoria — apenas relatada.
