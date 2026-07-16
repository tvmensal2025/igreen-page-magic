# ENTREGA PARA REVISÃO — Auditoria iGreen (handoff)

**Data:** 2026-07-16 (atualizado pós go-live)  
**Repo Git:** `igreen-page-magic`  
**Projeto prod:** IGREEN `zlzasfhcxcznaprrragl`  
**Estado:** **APLICADO EM PRODUÇÃO** (migrate onda3/4 + deploy EFs + ops fix FB/close/voice)

---

## 0. Contexto

1. Sistema **em produção**, em ajuste. Regra: não reativar envio automático em massa; não apagar código/migrations.  
2. Ondas 1–4 + pós-revisão (B1–B3) + AUD-005 nos senders críticos.  
3. **Já aplicado:** migrate onda4→onda3, deploy EFs (`main`), ops fix crons FB/close/voice.  
4. **`ENFORCE_CRON_AUTH` / `ENFORCE_WEBHOOK_ORIGIN` ainda desligados** (grace).  
5. `outbound-gate.ts` **wired** nos crons/senders automáticos (não nos monólitos bot-flow — AUD-006 adiado).

---

## 1. Pacote fechado (escopo hardening)

| Item | Status |
|---|---|
| AUD-001–005, 007–008 + crons/solar/RLS/PII | ✅ código + prod |
| AUD-006 unificar bot-flow | ⏸ fora do pacote |
| Ops: FB healthcheck 401 / duplicata close / voice metrics morto | ✅ corrigido (2026-07-16) |

### Ainda fase 2 (não dia 0)

- `ENFORCE_CRON_AUTH` / `ENFORCE_WEBHOOK_ORIGIN` após smoke  
- Headers nos demais crons (FB syncs, etc.) antes do enforce  
- AUD-006, CORS `*` em massa  

---

## 2. Checklist ops (estado)

1. ~~Revisar diff~~ ✅  
2. ~~Commit / PR / merge main~~ ✅ (PR #2)  
3. ~~Apply migrations onda4 → onda3~~ ✅  
4. ~~Deploy EFs~~ ✅  
5. ~~Ops fix FB/close/voice~~ ✅ (migration + EF FB)  
6. Workers: confirmar `WORKER_SECRET` ≥16 **antes** de redeploy  
7. Configurar `?secret=` nas URLs Evolution/Whapi **antes** de `ENFORCE_WEBHOOK_ORIGIN=true`  
8. Só então `ENFORCE_CRON_AUTH=true`  

---

## 3. Veredito

| Pergunta | Resposta |
|---|---|
| Hardening em produção? | **Sim** (grace, sem ENFORCE) |
| Rollback necessário? | **Não** |
| Próximo salto de segurança | Smoke → ENFORCE_* com calma |

Ver `STATUS.md` e `19-go-live-producao.md`.
