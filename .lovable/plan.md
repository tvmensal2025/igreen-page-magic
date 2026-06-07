# Plano — Fluxo B = APENAS a Vendedora V2 (deletar todo o resto)

## Decisão

Variant B passa a ter **um único caminho de código**: a Vendedora V2 (`_shared/vendedora/orchestrator.ts`, chamada via `runFluxoBAI`). Tudo que existe hoje para B em outros lugares (V3 step engine, nudge legacy, fallback de bot-flow, etc.) é deletado para não voltar a misturar.

## Diagnóstico atual

Hoje convivem 3 caminhos paralelos para variant B, e o que está rodando é o errado:


| Caminho                                | Arquivo                                                          | Status hoje                                                  |
| -------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| **Vendedora V2** (queremos manter)     | `_shared/vendedora/*` via `_shared/fluxo-b-ai.ts`                | Nunca executa — gate só roda quando V3 está desligado        |
| **V3 step engine variant B** (deletar) | `_shared/engine/variants/b.ts` + `runner.ts`                     | É o que está rodando hoje — manda `passo_*` + `boas_vindas`  |
| **Nudge legacy fluxo-b-ai** (deletar)  | linhas 87‑320 de `_shared/fluxo-b-ai.ts` (após o `return` da V2) | Código morto exceto pelo nudge — duplica lógica da Vendedora |


`ai_decisions` últimas 24 h: 0 entradas `vendedora_v2`. Confirmado: V3 estava sequestrando todos os turnos B.

## Mudanças

### 1. Variant B nunca entra no V3

- `_shared/engine/loader.ts` (~linha 80): se `customer.flow_variant === "B"`, **lançar erro** `variant_b_should_not_reach_v3` para garantir que nenhum caller esquecido caia no V3 silenciosamente.
- `_shared/engine/variants/b.ts`: **deletar arquivo**.
- `_shared/engine/runner.ts` (~linha 455): remover branch `if (input.flow.variant === "B")` e remover import do `variantB`.
- `_shared/engine/helpers.ts` `pickVariant`: tirar case `"B"` (ou apontar para um throw).
- Atualizar testes em `_shared/engine/__tests__/v3-runner_test.ts` (remover/ajustar arbitrários que geram `variant: "B"`).

### 2. Bypass V3 nos dois webhooks (defesa em profundidade)

`whapi-webhook/index.ts` (1311) e `evolution-webhook/index.ts` (1626), antes do gate `isEngineV3Enabled`:

```ts
const fbVariant = String((customer as any)?.flow_variant || "").toUpperCase();
if (fbVariant === "B") {
  // Variant B = Vendedora V2 pura. Cai direto no bot-flow legado,
  // que dispatcha runFluxoBAI. Captura de mídia continua determinística.
} else if (await isEngineV3Enabled(...)) { /* V3 normal pra A/C/D */ }
```

### 3. Limpar `fluxo-b-ai.ts` — só a Vendedora V2 sobra

Reescrever `_shared/fluxo-b-ai.ts` para conter **apenas**:

- Carregar customer + consultant.
- Chamar `runVendedoraV2(...)` e retornar.

Apagar:

- Todo o bloco "nudge legacy" (linhas 87 em diante: histórico, knowledge base manual, `buildFluxoBSystemPrompt`, `callWithTools`, `sanitizeReply`, fallback profissional). A Vendedora já tem RAG, memória, fallback determinístico, sanitizer próprio.
- Constantes `FLASH_MODEL`/`PRO_MODEL` locais.
- Parâmetro `nudgeHook` e flag `isNudgeRun`.

`_shared/fluxo-b-prompt.ts`: **deletar** (era só do legacy).

### 4. Worker de follow-up sem caminho legacy

`process-followups/index.ts` chama `runFluxoBAI(..., nudgeHook)`. Como o nudge legacy some, o worker passa a chamar a Vendedora normalmente — adapta `inboundText` para um marcador interno `"[nudge]"` e a Vendedora trata como turno novo do bot (sem mensagem do lead). Remove `nudgeHook` da assinatura.

### 5. Limpar fallback B em `whapi-webhook/handlers/bot-flow.ts`

- Manter o gate B → `runFluxoBAI` (linhas 631‑666), mas tirar o `try/catch` que faz "fall-through pro fluxo padrão A/D" em erro. Em erro: envia mensagem padrão de retentativa + log; NUNCA cai no fluxo determinístico A/D pra um lead B (era exatamente o que misturava).
- Mesma coisa em `evolution-webhook/handlers/bot-flow.ts`.

### 6. Reset de leads B presos

Migration de dados (UPDATE):

```sql
UPDATE public.customers
SET conversation_step = NULL,
    fluxo_b_state = NULL,
    updated_at = now()
WHERE flow_variant = 'B'
  AND conversation_step IS NOT NULL
  AND conversation_step NOT IN (
    'aguardando_conta','aguardando_documento','aguardando_humano',
    'aguardando_doc_auto','aguardando_doc_frente','aguardando_doc_verso',
    'aguardando_otp','validando_otp','portal_submitting',
    'cadastro_finalizando','finalizando','complete'
  );
```

Steps de captura de mídia/handoff/OTP permanecem (cadastro determinístico segue intocado). Só zera os steps scriptados de flow (`flow:*`, `welcome`, `passo_*`, UUIDs de step).

## Deploy

- Edge functions: `whapi-webhook`, `evolution-webhook`, `process-followups`.
- Migration via tool de insert (UPDATE em customers).
- Não toca em `ai_persona_fluxo_b`, `ai_knowledge_sections`, nem na biblioteca de mídia.

## Validação

1. `psql` confirma 0 customers B com `conversation_step` scriptado.
2. Lead de teste B manda "Oi" → logs mostram `[vendedora-v2]`, **não** `engine_v3_handled` nem `passo_*`/`boas_vindas`.
3. `SELECT source, count(*) FROM ai_decisions WHERE created_at > now()-interval '10 min' GROUP BY source` lista `vendedora_v2`.
4. Lead B manda foto da conta → continua caindo no handler determinístico de OCR (mídia não foi afetada).

## Fora do escopo

- Variant A/C/D continuam exatamente como estão (V3 ligado).
- Mídia/OCR/portal não muda.
- Não mexo na persona do consultor nem em `ai_knowledge_sections`.

Posso implementar? SIM, DEXAIDNO O FLUXO B APENAS COM A VENDEDROA