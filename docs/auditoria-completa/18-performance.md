# 18 — Performance

**Data:** 2026-07-16  
**Modo:** heurística + correção pontual

---

## 1. Pontos quentes

| Área | Observação | Ação |
|---|---|---|
| `pending_outbound_media` cron | Filtro `succeeded_at IS NULL` + `scheduled_for` | Índice parcial Onda 4 |
| `customers` DNC | Já existe `idx_customers_do_not_contact` | OK |
| Admin `fetchCustomers` | Paginação 1000 + cache | Cache sem PII; select ainda largo (débito) |
| Chat / bot-flow | Monólitos 6k linhas; cold start Deno | AUD-006 médio prazo |
| pg_cron overlap | Vários jobs `*/5` | Gates + automation toggles; auth Onda 3 |
| EF `.select("*")` | ~38 arquivos | Refator incremental |

---

## 2. Correção aplicada

```sql
CREATE INDEX IF NOT EXISTS pending_outbound_media_due_partial_idx
  ON public.pending_outbound_media (scheduled_for)
  WHERE succeeded_at IS NULL;
```

---

## 3. Recomendações (sem patch agora)

1. Reduzir `selectFields` do Admin ao necessário por aba.  
2. Evitar `select('*')` em EFs quentes (voice enqueue, webhooks).  
3. Monitorar latência `evolution-webhook` / `whapi-webhook` (Sentry já parcialmente ligado).  
4. Não reduzir intervalo do flush abaixo de 1 min no pg_cron sem worker dedicado.
