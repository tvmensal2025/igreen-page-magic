## Auditoria profunda — segunda passada

### ✅ Tudo o que está coberto

- `evolution-webhook` (bot conversacional inteiro) → sender com guard
- `ai-agent-router` (2x) → guard
- `bot-stuck-recovery` → guard
- `outbound-media-flush-cron` → guard
- `worker-callback` → guard
- `bulk-scheduler` → `checkSendQuota` direto (linha 235)
- `send-scheduled-messages` → `checkSendQuota` direto (linha 126)
- `reactivation-cron` → `checkSendQuota` (linha 264)
- Hard-lock no `check_send_quota` SQL ativo
- RPCs `register_fatal_disconnect` / `admin_clear_fatal_lock` / `clear_recovery_mode` presentes
- Instância `igreen-953f7e48509b` segue travada até 18/06

### 🔴 Gaps NOVOS encontrados nesta passada


| #   | Local                                          | Tipo                                                      | Risco    | Observação                                                 |
| --- | ---------------------------------------------- | --------------------------------------------------------- | -------- | ---------------------------------------------------------- |
| 1   | `crm-auto-progress/index.ts:24,33,42`          | `fetch` direto a Evolution (sendText/sendMedia/sendAudio) | 🔴 ALTO  | Bot de progressão de CRM dispara para leads, ZERO checagem |
| 2   | `reactivation-send/index.ts:213`               | `sender.sendText` sem `checkSendQuota`                    | 🔴 ALTO  | Callsite escapou do padrão; a outra (linha 348) tem        |
| 3   | `recover-stuck-otp/index.ts` (helper linha 23) | `fetch` direto                                            | 🟡 MÉDIO | Followup de OTP a leads sem check                          |
| 4   | `finalize-capture/index.ts:60`                 | `fetch` direto                                            | 🟡 MÉDIO | Confirmação pós-captura ao lead                            |
| 5   | `ai-daily-digest/index.ts:167`                 | `createEvolutionSender` sem guard                         | 🟢 BAIXO | Relatório ao consultor (não lead), mas inconsistente       |


### 🟢 Casos que NÃO precisam mexer (decisão consciente)

- `manual-step-send` (2x) — envio manual do operador, bypass intencional
- `notify-consultant` (2x) — notifica admin, não lead
- `super-admin-alerts`, `minio-quota-check` — alertas internos
- `_shared/whatsapp-api.ts` — usado pelo canal Whapi (Cloud API, sem risco de ban Baileys)
- `_shared/channels/evolution.ts` — adapter genérico, sender pode ser embrulhado pelo caller

### Plano de correção

**Para os fetches diretos (#1, #3, #4)** — adicionar gate inline antes do `fetch`:

```ts
import { checkSendQuota, registerSend } from "../_shared/anti-ban.ts";
const quota = await checkSendQuota(supabase, instanceName);
if (!quota.allowed) {
  console.warn(`🚫 [<fn>] envio bloqueado: ${quota.reason}`);
  return false;
}
const res = await fetch(...);
if (res.ok) await registerSend(supabase, instanceName);
```

**Para os senders sem guard (#2, #5)** — aplicar `wrapSenderWithGuard` no padrão já estabelecido.

**Arquivos afetados:**

1. `supabase/functions/crm-auto-progress/index.ts` — adicionar quota nos 3 helpers (sendText/sendMedia/sendAudio)
2. `supabase/functions/reactivation-send/index.ts` — envolver sender na linha 155 (cobre callsite 213) OU adicionar checkSendQuota antes da linha 213
3. `supabase/functions/recover-stuck-otp/index.ts` — adicionar quota no helper `sendWhatsAppText`
4. `supabase/functions/finalize-capture/index.ts` — adicionar quota antes do fetch da linha 60
5. `supabase/functions/ai-daily-digest/index.ts` — wrapSenderWithGuard na linha 167

### Critério de aceite

- Nenhum caminho automatizado para LEAD escapa de `check_send_quota`.
- Notificações admin (`notify-consultant`, alerts) permanecem livres.
- `manual-step-send` continua manual.
- Instância em hard-lock fica 100% silenciosa em qualquer cenário.

Posso aplicar? Sim

&nbsp;