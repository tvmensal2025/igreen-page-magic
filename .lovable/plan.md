# Auditoria profunda do Fluxo D — garantir paridade pública e respostas sem erro

## Objetivo

Verificar se o Fluxo D (público, base de todos os consultores) está respondendo:

- Sem **pular passos**
- Sem **duplicar mensagens**
- Sem **resposta errada** (passo trocado / contexto perdido)
- **Idêntico** entre Whapi (super admin) e Evolution (consultores)

## Escopo da análise (read-only)

Vou inspecionar os 4 pontos onde esses bugs nascem:

### 1. Dedup de entrada (evita resposta duplicada)

- `_shared/bot/dedupe.ts` + `webhook_message_dedup` (TTL, race condition entre Whapi/Evolution)
- `_shared/customer-lock.ts` (lock por telefone — verifica se está liberando em caso de erro)
- `whatsapp_message_buffer` (debounce de mensagens em rajada)

### 2. Resume-or-skip (evita pular passo / pedir dado que já tem)

- `_shared/bot/resume-or-skip.ts`
- `customer_flow_state` vs `customers.bot_current_step`
- Guard de retomada inserido nos webhooks

### 3. Engine de despacho (evita resposta errada / passo trocado)

- `_shared/engine/engine.ts` (avanço de step)
- `_shared/engine/decision.ts` (escolha de próximo step)
- `_shared/engine/dispatcher.ts` (envio único — `conversational-send-idempotency`)
- `_shared/engine/loader.ts` (carregamento do Fluxo D público vs override do dono)
- `step-namespace.ts` (isolamento de slots por consultor)

### 4. Paridade Whapi ↔ Evolution

- Comparar `evolution-webhook/index.ts` vs `whapi-webhook/index.ts` (2.850 vs 2.583 linhas) — checar se ambos chamam o mesmo `webhook-entry.ts` com os mesmos guards
- `bot_flow_steps` do Fluxo D público (sync_mode='public')
- `loader.ts` regra: mídia do dono vence fallback público

### 5. Testes existentes

Rodar (sem deploy):

- `engine_test.ts`
- `dedupe_test.ts`
- `reemit-buttons_test.ts`
- `resume-or-skip` (se houver)
- `customer-lock_test.ts`

## Entrega

Relatório em `/mnt/documents/fluxo-d-audit.md` contendo:

- ✅/❌ por categoria (dedup, resume, dispatch, paridade)
- Lista de bugs encontrados com arquivo:linha
- Diff sugerido para cada bug (sem aplicar)
- Veredito final: "Fluxo D está consistente" OU "precisa corrigir X, Y, Z"

## Após o relatório

Você decide o que corrigir. Eu **não vou aplicar mudança** automática — só depois da sua aprovação por correção, porque qualquer ajuste no engine impacta produção imediatamente (Supabase compartilhado).

**Tempo estimado:** 2-3 chamadas de análise, sem deploy.

Posso prosseguir com a auditoria? SIM

&nbsp;