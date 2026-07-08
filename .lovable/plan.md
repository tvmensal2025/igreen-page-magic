## Auditoria do Supabase — o que está pesando

### 1. Cron jobs (verificado em `cron.job`)

26 jobs ativos. Situação após os últimos ajustes:

- **De alta frequência (potencialmente pesado):**
  - `rodizio-metrics-10min` — a cada 10min, 11h–00h
  - `instance-health-cron-30min` — a cada 30min
  - `faq-reengagement-nudge-30min` — a cada 30min
  - `cleanup-http-response-temporary-relief` — a cada 15min
  - `bot-stuck-recovery-hourly`, `bot-loop-watchdog-hourly`, `pos-venda-auto-progress-hourly`, `flow-d-health-cron-hourly`, `fb-campaign-healthcheck`, `production-health-snapshot-hourly`, `super-admin-alerts-hourly` — 7 jobs de hora em hora
- **Diários (ok, sem impacto significativo):** 15 jobs.

Nenhum job por minuto ativo — a limpeza anterior funcionou.

### 2. `pg_net`

`net.http_request_queue` = 0 pendentes, apenas 1 resposta na última hora. Nenhum loop de webhook em andamento.

### 3. Realtime

`realtime.subscription` = 0. Apenas 4 canais no frontend, todos com cleanup. Não é o gargalo.

### 4. Conexões / pg_stat_activity

- Existe uma sessão do `postgres_exporter` em `idle in transaction (aborted)` — típico de instância sob pressão.
- Consultas simples de metadata (`pg_stat_user_tables`, `pg_size_pretty`) estão levando **mais de 1 minuto** e caindo por timeout.
- `pg_stat_statements` **não está habilitado** — por isso não conseguimos rankear queries lentas.

### 5. Bloat

Apenas `production_health_snapshot` com ~4 mil tuples mortos. Nada grave.

### 6. Edge Functions com erro em loop

`whapi-webhook` gera continuamente `BadResource: Bad resource ID` em `req.json()` + `connection closed before message completed`. Está falhando em cada chamada do Whapi Cloud, gerando reboots frequentes da função e ruído em logs.

### 7. Diagnóstico

- O DB está lento **mesmo para queries triviais de catálogo**. Isso indica saturação de CPU/IO da instância Supabase, não um cron ou função específica em loop.
- Fatores agravantes prováveis:
  1. Muitas Edge Functions ativas (150+) sendo chamadas por webhooks Whapi/Evolution/Meta o tempo todo → cada uma abre conexão ao Postgres.
  2. `whapi-webhook` reiniciando toda hora por erro no parse.
  3. Ausência de `pg_stat_statements` cega qualquer otimização.
  4. Extensão `pg_cron` + `pg_net` funcionando, mas com jobs redundantes ainda ativos que poderiam ser diários.

## Plano de ajuste (sem apagar nada crítico)

### Etapa A — Reduzir carga imediata (migration)

1. Baixar frequência de jobs que não precisam ser tão rápidos:
  - `rodizio-metrics-10min` → a cada 2 hora 
  - `faq-reengagement-nudge-30min` → 1×/hora
  - `instance-health-cron-30min` → 1×/hora
  - `cleanup-http-response-temporary-relief` → 1×/hora
  - Consolidar `bot-stuck-recovery-hourly` + `bot-loop-watchdog-hourly` em 1 job só, 1×/2h.
2. Manter intocados os jobs diários (não pesam).

### Etapa B — Corrigir `whapi-webhook`

- Ler o body uma única vez com `await req.text()` e só então `JSON.parse`.
- Se vier vazio ou inválido, retornar `200 { ok: true, msg: "ignored_bad_body" }` sem exceção.
- Isso elimina o loop de erros `BadResource` e reduz reboots da função.

### Etapa C — Habilitar observabilidade

- Habilitar extensão `pg_stat_statements` para conseguirmos ver as queries que mais consomem tempo. Sem isso, seguimos no escuro.
- Rodar `VACUUM ANALYZE production_health_snapshot`.

### Etapa D — Não apagar Edge Functions agora

Apagar em massa é arriscado (WhatsApp, campanhas, OCR, painéis dependem). Depois que a carga cair, faço um segundo passo para listar funções sem chamadas nos últimos 30 dias e proponho remoção uma a uma, com sua aprovação.

### Etapa E — Validação

- Rodar `pg_stat_activity` de novo.
- Testar login `/auth/v1/token`.
- Confirmar que `whapi-webhook` parou de gerar erros.
- Confirmar que consultas simples de metadata voltam a responder em <1s.

## Resultado esperado

- Menos conexões simultâneas no Postgres.
- Auth volta a responder.
- Fim do loop de erro no `whapi-webhook`.
- Base pronta para uma segunda rodada de limpeza (funções obsoletas, índices) com dados reais do `pg_stat_statements`.