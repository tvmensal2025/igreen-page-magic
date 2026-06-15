## Problema

Fluxo B foi criado historicamente como "IA Livre" (zero passos, resposta 100% gerada pela edge `fluxo-b-ai` com persona + conhecimento). A refatoração do **Cérebro IA** passou a tratar B como roteirizado (lendo `bot_flow_steps`). Resultado: clientes em variant B ficam travados com `customer_flow_state.status = paused_system / pause_reason = empty_flow` e o bot não responde nada.

Confirmado no banco para o telefone `5511971254913` (customer `f26056e8-adf8-4ea3-b271-e5de5f81f4f1`): `flow_id = null`, `pause_reason = empty_flow`, e o único Flow B existente (`477f8968…`) tem 0 passos ativos.

## Objetivo

Restaurar o modo **IA Livre** como comportamento padrão do Fluxo B quando não houver passos cadastrados, sem perder a capacidade futura de roteirizar B (que continua sendo um recurso útil do Cérebro).

## Mudanças

### 1. Fallback no Cérebro (`supabase/functions/_shared/cerebro/index.ts`)

Antes de chamar `decidirPasso` (N3), checar:

- Se `customer.flow_variant === "B"` E o flow B carregado tem `steps.length === 0` → **bypass do runEngine** e delegar à Vendedora V2 (chamada interna ao mesmo handler do `fluxo-b-ai`, reusando `_shared/fluxo-b-ia/agent.ts`).
- Caso contrário, segue o fluxo atual (Cérebro com passos).

Isso evita o `empty_flow → paused_system` e devolve a IA livre.

### 2. Wrapper "IA Livre" reutilizável (`supabase/functions/_shared/cerebro/vendedora-livre.ts` — novo)

Função `executarVendedoraLivre({ supabase, customerId, consultantId, inbound, history })` que:

- Carrega persona + conhecimento do consultor (mesma fonte que `fluxo-b-ai` já usa).
- Chama o `agent.ts` compartilhado com `maxTokens=2048` e histórico real do banco.
- Retorna `ResultadoCerebro` no mesmo formato (`reply`, `outbound`, `stateUpdate`, `shouldHandoff=false`) — assim o caller existente (webhook) não muda nada.
- `stateUpdate` apenas marca `last_inbound_at` / `last_outbound_at` — **não** seta `paused_system` nem mexe em `current_step_id`.

### 3. Limpeza preventiva do `customer_flow_state`

Para o `runner.ts` (engine v3), no caso `variant === "B" && empty_flow`, em vez de marcar `paused_system` com `handoff_reason: empty_flow`, retornar um `stateUpdate` neutro (`status: "ativo"`, sem pause_reason). Isso garante que clientes B que escaparem para o engine v3 por outra rota também não fiquem travados.

### 4. Migração one-shot (SQL)

Reativar clientes B já travados:

```sql
UPDATE customer_flow_state
SET status = 'ativo', pause_reason = NULL
WHERE pause_reason = 'empty_flow'
  AND customer_id IN (
    SELECT id FROM customers WHERE flow_variant = 'B'
  );
```

### 5. Testes

- Atualizar `cerebro/__tests__/variant-b-suporte.test.ts` cobrindo: B com 0 passos → chama vendedora-livre, não retorna handoff.
- Adicionar teste de regressão: B com ≥1 passo → continua usando Cérebro normal.

## Fora de escopo

- Não toca em variant A/D.
- Não altera a UI do construtor de Fluxo B (continua possível popular passos manualmente quando quiser roteirizar).
- Não mexe na extensão iGreen nem em outras pendências.

## Risco

Baixo. O fallback é estritamente aditivo: só dispara quando hoje já está quebrado (`steps.length === 0`). Clientes B já roteirizados (se houver no futuro) seguem o caminho atual sem alteração.
