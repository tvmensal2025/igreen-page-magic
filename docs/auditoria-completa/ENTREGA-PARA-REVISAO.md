# ENTREGA PARA REVISÃO — Auditoria iGreen (handoff)

**Data:** 2026-07-16  
**Repo Git:** `igreen-page-magic`  
**Branch:** `fix/hardening-auditoria`  
**Workspace Cursor:** `igreen-official-portal` (mesmo código)  
**Estado:** **FECHADO LOCAL** — patches prontos; **não** commitados / **não** deployados  

---

## 0. Contexto

1. Sistema **em produção**, em ajuste. Regra: não reativar envio automático em massa; não apagar código/migrations.  
2. Ondas 1–4 + pós-revisão (B1–B3) + fechamento AUD-005 nos senders críticos.  
3. **Nada aplicado em produção** (sem migrate, sem deploy EF, sem flags `ENFORCE_*`).  
4. `outbound-gate.ts` **wired** nos crons/senders automáticos (não nos monólitos bot-flow — AUD-006 adiado de propósito).

---

## 1. Pacote fechado (escopo hardening)

| Item | Status |
|---|---|
| AUD-001 reactivation DNC | ✅ |
| AUD-002 messageSender fail-closed | ✅ |
| AUD-003 SuperAdmin `isSuperAdmin` | ✅ |
| AUD-004 FB healthcheck auth | ✅ |
| AUD-005 assert nos senders críticos | ✅ + teste estático |
| AUD-006 unificar bot-flow | ⏸ **aceito / fora do pacote** (risco alto) |
| AUD-007 webhook grace + flag | ✅ Evolution = Whapi |
| AUD-008 workers secret fraco | ✅ |
| Crons auth + grace | ✅ |
| Solar token / probe | ✅ |
| RLS reheat + DEFINER `search_path=''` | ✅ (migration local) |
| PII sessionStorage | ✅ |
| B1–B3 pós-revisão | ✅ |

### Fora do pacote (ops / fase 2)

- Commit / PR / migrate / deploy  
- `ENFORCE_CRON_AUTH` / `ENFORCE_WEBHOOK_ORIGIN`  
- Unificação monólitos Evolution/Whapi (AUD-006)  
- CORS `*` em massa  
- E2E Playwright com envio real  

---

## 2. Senders com gate (AUD-005)

Gate = `assertBotOutboundAllowed` (kill switch + DNC) **ou** `assertCanContact` (manual/voz):

- reactivation-send / reactivation-cron  
- bot-followup-checker / process-followups / faq-reengagement-nudge  
- cadence-tick / send-scheduled-messages / bulk-scheduler  
- outbound-media-flush-cron / bot-stuck-recovery / portal-otp-watchdog  
- resend-portal-link / admin-send-material / manual-step-send / start-customer-attendance  
- voice-dialer-cron / voice-sms-send / voice-dialer-enqueue  

Teste: `src/test/outbound-dnc-coverage.test.ts`

---

## 3. Checklist ops (quando for operacionalizar)

1. Revisar diff  
2. Commit  
3. Apply migrations onda3 → onda4  
4. Garantir tokens de cron/serviço  
5. Deploy EFs  
6. Deploy workers com `WORKER_SECRET` ≥16 e não fraco  
7. Configurar `?secret=` nas URLs Evolution/Whapi **antes** de `ENFORCE_WEBHOOK_ORIGIN=true`  
8. Só então `ENFORCE_CRON_AUTH=true`  
9. Smoke: DNC, solar token, inbound WA em grace, cron com enforce  

---

## 4. Veredito

| Pergunta | Resposta |
|---|---|
| Pacote de hardening local fechado? | **Sim** (exceto AUD-006 aceito) |
| Produção já protegida? | **Não** (sem deploy) |
| Deploy cego? | **Não** — ordem migrate → EF → flags |

**Conclusão:** código local **fechado para o escopo de auditoria/hardening**. Produção só muda após migrate/deploy/flags conscientes.
