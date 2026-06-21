## Plano — Retomada determinística do cadastro + auditoria do reset silencioso

### Objetivo
Garantir que, se algo derrubar o `conversation_step` no meio do cadastro, o bot **retome no passo certo** baseado nos dados já salvos, **sem re-pedir nada**. E instalar uma "câmera" pra identificar o culpado pelo reset.

### Causa raiz (resumo)
- **Dados não se perdem** — frente, verso, conta, OCR e confirmações foram persistidos corretamente no caso Maricelha.
- O que se perde é o **ponteiro do passo** (`customers.conversation_step`): algum processo paralelo (re-welcome reset, flow-router, ou watchdog) sobrescreve o step entre uma outbound e a próxima inbound, **sem registrar a transição** em `bot_step_transitions`.
- Quando o cliente clica de novo "✅ Quero me cadastrar", o orquestrador dispara `capture_conta` sem checar se `electricity_bill_photo_url` já existe — então re-pergunta.

---

### Mudanças

#### 🔴 P0.1 — `resolveResumeStep(customer)` em `_shared/conversation-helpers.ts`
Função pura que devolve o próximo passo faltante baseado SÓ nos campos do customer:

```text
1. !hasBillData                          → aguardando_conta
2. !bill_data_confirmed_at               → confirmando_dados_conta
3. !document_front_url                   → aguardando_doc_auto
4. é CNH? skip verso : !document_back_url → aguardando_doc_verso
5. !doc_data_confirmed_at                → confirmando_dados_doc
6. !cpf                                  → ask_cpf
7. !cep                                  → ask_cep
8. !address_number                       → ask_number
9. !email                                → ask_email
10. tudo OK                              → ask_finalizar
```

#### 🔴 P0.2 — Wiring do resume nos dois bot-flow
Em `whapi-webhook/handlers/bot-flow.ts` e `evolution-webhook/handlers/bot-flow.ts`:
- Generalizar o guard da linha 2949 (hoje só protege `capture_documento`) pra usar `resolveResumeStep`.
- Generalizar o skip da linha 5421 (hoje só checa documentos) pra usar `resolveResumeStep`.
- **Novo**: dentro do dispatcher de capture (linhas 2882–2995), antes de aceitar qualquer `capture_*`, comparar com `resolveResumeStep(customer)` — se divergir, usar o resultado do resume e logar `[resume] dispatcher quis X, resume aponta Y — usando Y`.

#### 🔴 P0.3 — Idempotência de mídia já recebida
No topo do switch principal de `bot-flow.ts`: se inbound é foto/PDF E todos os arquivos esperados (`electricity_bill_photo_url`, `document_front_url`, `document_back_url` se aplicável) já estão salvos → **não sobrescrever**. Responder "Já recebi seus documentos. Vamos continuar 👇" e disparar `resolveResumeStep`.

#### 🟠 P1.1 — Anti-reset durante coleta ativa
Adicionar guard em 3 lugares:
- `whapi-webhook/index.ts` (re-welcome reset, linhas ~820 e ~1660): se step ∈ `legacyCaptureSteps` E `customer_flow_state.entered_step_at` < 10 min → abortar reset, logar `[re-welcome:skip] step protegido em coleta ativa`.
- `bot-stuck-recovery/index.ts`: mesmo guard antes de qualquer reset.
- `_shared/flow-router.ts`: se step atual ∈ `legacyCaptureSteps` E entrada recente → devolver o step atual sem sobrescrever.

#### 🟠 P1.2 — Trigger de auditoria `audit_silent_step_reset`
Migration cria função + trigger `BEFORE UPDATE` em `customers`. Quando:
- `OLD.conversation_step` matchar `^(aguardando_|ask_|confirmando_)` AND
- `NEW.conversation_step` for UUID puro de flow (`^[0-9a-f-]{36}$`) AND
- Não existir transição correspondente em `bot_step_transitions` nos últimos 10s

→ insere em `engine_logs` `{action:'silent_step_reset', from, to, txid, app_name, customer_id}`. Não bloqueia o update — só registra. Em 24h vamos saber **qual função** está causando o reset.

#### 🟡 P2 — Commit-then-step
Auditar os 3 lugares que fazem `updates.X = ...; updates.conversation_step = ...` no mesmo objeto. Garantir que a mudança de step só acontece após o `update` confirmar persistência dos campos novos.

#### Limpeza
- Marcar customer fantasma `4539d2c3-…` (phone 5511971254913) com `bot_paused=true, bot_paused_reason='created_empty_test'`. Não deletar (preserva histórico).

---

### Verificação após implementar
1. `curl_edge_functions` no whapi-webhook simulando: welcome → conta → confirma → frente → **reset forçado via SQL** → cliente reenvia "Quero cadastrar" → esperado: bot pula direto pra `aguardando_doc_verso`.
2. Mesmo cenário com watchdog simulado → anti-reset bloqueia.
3. Query em `engine_logs WHERE action='silent_step_reset'` por 24h pra mapear o culpado real.

---

### Arquivos tocados
- `supabase/functions/_shared/conversation-helpers.ts`
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts`
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts`
- `supabase/functions/_shared/flow-router.ts`
- `supabase/functions/whapi-webhook/index.ts`
- `supabase/functions/bot-stuck-recovery/index.ts`
- Migration: função `log_silent_step_reset()` + trigger `audit_silent_step_reset` em `customers`
- Data fix: pausar customer fantasma

### O que NÃO muda
- Sem mudança de UI/frontend.
- Template welcome (fallback "responda com o número") fica como está.
- Instância super-admin `igreen-0c2711ad4836` em `needs_reconnect` é operacional, não entra aqui.
