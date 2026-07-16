# 16 — Relatório final da auditoria

**Data:** 2026-07-16  
**Repositório:** `igreen-page-magic` (workspace Cursor → `igreen-official-portal`)  
**Modo:** auditoria + correções incrementais (sem reativar envio automático em massa)

---

## 1. Veredito executivo

O sistema está **em produção e em ajuste**. A auditoria cobriu inventário, arquitetura, WhatsApp/DNC, crons, voz, solar, Meta, workers, código morto, segurança residual e performance.

**Risco principal histórico:** contato indevido (DNC) e crons/`verify_jwt=false` sem auth — **mitigado em código** nas Ondas 1–4.  
**Risco residual operacional:** deploy + flags ainda pendentes; unificação `bot-flow` Evo/Whapi adiada.

---

## 2. Escala (fotografia)

| Área | Ordem de grandeza |
|---|---|
| Edge Functions | ~196 |
| `verify_jwt=false` | ~60 |
| Migrations | ~722 |
| Jobs pg_cron (únicos no repo) | ~62 |
| Frontend funções (heurística) | ~3300 |
| Vitest | 471 pass / 6 skip (medição Onda 1) |

---

## 3. Achados e status de correção

| ID | Pri | Tema | Código |
|---|---|---|---|
| AUD-001 | P0 | reactivation-send DNC | ✅ Onda 1 |
| AUD-002 | P1 | messageSender fail-open | ✅ Onda 1 |
| AUD-003 | P1 | SuperAdmin `isAdmin` | ✅ Onda 1 |
| AUD-004 | P1 | facebook healthcheck cron | ✅ Onda 1 |
| AUD-005 | P1 | assertCanContact raro | ✅ senders críticos + teste cobertura |
| AUD-006 | P1 | bot-flow duplicado | ⏸ aceito fora do pacote |
| AUD-007 | P1 | webhook grace | ✅ Evolution = Whapi (flag) |
| AUD-008 | P1 | WORKER_SECRET change-me | ✅ Onda 1 |
| AUD-009 | P1 | crons envio sem auth | ✅ Onda 3 (grace→ENFORCE) |
| AUD-010 | P2 | flush sem schedule | ✅ Onda 3 |
| AUD-011 | P1 | solar snapshotId IDOR | ✅ Onda 3 |
| AUD-012 | P1 | solar-hd-probe público | ✅ Onda 3 |
| AUD-014 | P2 | secret cron voz | ops |
| AUD-015 | P1 | DEFINER sem search_path | ✅ Onda 4 |
| AUD-016 | P1 | daily_reheat_queue RLS ampla | ✅ Onda 4 |
| AUD-017 | P1 | sessionStorage PII | ✅ Onda 4 (Admin + Network) |

Docs de domínio: `00`–`15`, `ONDA1`–`ONDA4`, `VALIDACAO-ONDA1`.

---

## 4. Ondas de patch (código)

| Onda | Escopo |
|---|---|
| 1 | DNC reactivation, messageSender, SuperAdmin, FB healthcheck, workers |
| 2 | Mais DNC, webhook flag, lead-intake RL, voice cron DNC |
| 3 | cron-auth, solar, flush schedule, Evolution enforce |
| 4 | search_path DEFINER, RLS reheat queue, cache sem PII, índice flush |

---

## 5. Checklist ops (produção)

1. Aplicar migrations `20260716120000_onda3_*` e `20260716130000_onda4_*`.  
2. Deploy EFs afetadas + workers com `WORKER_SECRET` forte.  
3. Confirmar `settings.embed_internal_token` / `service_shared_secret`.  
4. `ENFORCE_CRON_AUTH=true` **depois** da migration de headers.  
5. Evolution: `?secret=` se `EVOLUTION_WEBHOOK_SECRET` setado.  
6. Whapi: `ENFORCE_WEBHOOK_ORIGIN=true` só com secret na URL.  
7. **Não** ligar `ALLOW_SOLAR_HD_PROBE` em prod.  
8. Kill switch: Super Admin → Assistente Global → `bot_global_enabled`.

---

## 6. Débito consciente (não “esquecido”)

- Unificar monólitos `bot-flow.ts` (~6k+6k) — plano E2E dryRun obrigatório.  
- Migrar ~100 EFs de `CORS *` para `buildCors` (já existe helper).  
- Policies `USING(true)` legítimas (catálogo, tour, service_role) — não mexer em massa.  
- Performance fina (N+1 chat, select `*`) — ver `18-performance.md`.

---

## 7. Conclusão

Auditoria **temática concluída**. Correções P0/P1 de contato e exposição pública **aplicadas no código**. Falta **operacionalizar** (migrate/deploy/flags) e, no médio prazo, **AUD-006** + CORS allowlist gradual.
