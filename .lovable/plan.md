# Plano — Robustez do fluxo de cadastro WhatsApp

## Status por pilar

| Pilar | Status |
|---|---|
| `resolveResumeStep` em capture | ✅ Implementado |
| RESUME no dispatcher (sibling, não aninhado) | ✅ whapi + evolution |
| Guard `shouldSkipAskStep` em capture | ✅ whapi + evolution |
| Idempotência `aguardando_conta` | ✅ whapi + evolution |
| Idempotência `aguardando_doc_auto` | ✅ whapi + evolution |
| Idempotência `aguardando_doc_verso` | ✅ whapi + evolution |
| `ask_quero_cadastrar` retoma cliente existente | ✅ whapi + evolution |
| Auditoria de reset silencioso | ✅ Pacote 1 (junho/2026) — trigger reescrito |
| Auto-retomada de `confirmando_*` parado | ⏳ Pacote 2 — pendente |
| Dedupe de customer por phone | ❌ Não necessário (zero duplicatas em 30 dias) |
| Lock idempotente em `ask_finalizar` | ⏳ Pacote 4 — pendente, baixa prioridade |

---

## Pacote 1 — Visibilidade (APLICADO)

**Problema:** `silent_step_reset_log` ficou vazio por dias mesmo com clientes voltando ao início. O trigger anterior só logava `step_nominal → UUID`, mas a regressão real é `confirmando_dados_doc → aguardando_conta` (nominal → nominal).

**Solução aplicada:**
- Nova função `public.funnel_step_rank(text)` atribui rank ordinal a cada step (welcome=10, aguardando_conta=30, …, portal_submitting=100, UUID/flow:UUID=200).
- `log_silent_step_reset` reescrito: loga **qualquer** transição com `new_rank < old_rank`, exceto quando há `bot_step_transitions` registrada nos últimos 10s (mudança legítima do engine).
- Trigger continua à prova de falhas (`EXCEPTION WHEN OTHERS → RETURN NEW`).

**Como verificar:**
```sql
-- Após alguns dias, deve ter dados:
SELECT from_step, to_step, count(*)
FROM silent_step_reset_log
WHERE created_at > now() - interval '7 days'
GROUP BY 1,2 ORDER BY 3 DESC;
```

Com esses dados poderemos atacar a causa raiz (qual handler está escrevendo `aguardando_conta` em cima de step avançado).

---

## Pacote 2 — Auto-retomada de `confirmando_*` (PENDENTE)

**Problema:** Cliente recebe botão de confirmação WHAPI (expira em 72h) ou pedido "digite 1/2" (Evolution). Se o cliente não responder em 1–6h, fica preso indefinidamente — nenhum cron re-envia.

**Plano detalhado (próxima iteração):**

1. **Nova tabela** `public.confirmacao_retry_log(customer_id PK, step, last_retry_at, retry_count)` — garante idempotência (1 retry por step).
2. **Edge function** `confirmacao-retry`:
   - Lê customers em `confirmando_dados_conta|confirmando_dados_doc|confirmando_doc_verso` com `updated_at < now() - 2h`.
   - Para cada um, dispara o handler correspondente (`re-render` do botão WHAPI ou do prompt Evolution) **apenas se** não há retry recente em `confirmacao_retry_log`.
   - Registra `retry_count++`; se `retry_count >= 2` e `updated_at < now() - 6h`, escala via `bot_handoff_alerts` para o consultor humano.
3. **Cron**: `*/30 * * * *` (a cada 30 min).
4. **NÃO auto-confirmar** — risco de gravar dado errado como venda.

**Bloqueio para shippar agora:** precisa de design das funções de re-render (texto + mídia já enviados antes), do guard contra re-envio em janelas de silêncio do consultor, e de teste e2e. Próxima sessão.

---

## Pacote 4 — Lock em `ask_finalizar` (PENDENTE, baixa)

**Trivial (~10 linhas):** envolver handler de `ask_finalizar` em `customer_processing_lock` igual aos outros. Só executar depois do Pacote 2 estar estável.

---

## Notas operacionais

- WHAPI usa botões (expiram em 72h). Evolution usa "digite 1/2/3". Ambos passam pelo mesmo dispatcher e estão protegidos por `customer_processing_lock` global.
- `bot_step_transitions` é a fonte de verdade para mudanças legítimas. Se algum handler novo trocar `conversation_step` sem inserir transição, o Pacote 1 vai gerar falso-positivo no log — auditar antes de criar novos steps.
