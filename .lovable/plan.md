# Auditoria Profunda — Fase 4

Cobertura validada em todas as 23 funções que disparam para Evolution. Restam **1 gap real (alto)** + **3 decisões conscientes** para revisar.

## 🔴 Gap novo encontrado

### 1. `admin-send-material/index.ts:89-90` — ALTO
Usa `createWhatsAppSender` (de `_shared/whatsapp-api.ts`) e dispara `sender.sendMedia` direto para o lead **sem `checkSendQuota`** e sem `registerSend`. É chamado pelo admin/consultor para mandar materiais — se a instância estiver em `fatal_lock` ou `recovery_mode`, o envio passa por cima da trava.

**Correção:**
1. Importar `checkSendQuota` / `registerSend` de `_shared/anti-ban.ts`.
2. Antes do `sendMedia`, chamar `checkSendQuota(supabase, inst.instance_name)`. Se `!allowed`, retornar **423 Locked** com `{ error, reason, until }` para o painel exibir a trava.
3. Após `ok === true`, chamar `registerSend(supabase, inst.instance_name)`.

## 🟡 Inconsistências (revisar política)

| Local | Tipo | Quem recebe | Status atual |
|---|---|---|---|
| `_shared/notify-consultant.ts:57,125` | `fetch` direto sendText | Consultor (instância do consultor) | Sem guard — decidido manter |
| `super-admin-alerts/index.ts:41` | `fetch` direto sendText | Super-admin | Sem guard — decidido manter |
| `minio-quota-check/index.ts:144` | `fetch` direto sendText | Super-admin | Sem guard — decidido manter |

Esses não disparam para leads, mas **tecnicamente** ainda batem na Evolution e podem agravar um lock existente. Risco baixo (volume mínimo, destinatários são staff). **Recomendo manter como bypass intencional** e adicionar comentário `// INTENTIONAL: staff alert — bypasses anti-ban guard` nas 4 linhas para documentar a decisão.

## ✅ Confirmados cobertos (nada a fazer)

- `evolution-webhook` ✓ (wrap)
- `ai-agent-router` ✓ (2x wrap)
- `bot-stuck-recovery` ✓ (wrap)
- `worker-callback` ✓ (wrap)
- `outbound-media-flush-cron` ✓ (wrap)
- `ai-daily-digest` ✓ (wrap)
- `reactivation-cron` ✓ (check+register inline)
- `reactivation-send` ✓ (wrap em 155)
- `send-scheduled-messages` ✓ (check+register inline)
- `bulk-scheduler` ✓ (check+register inline)
- `crm-auto-progress` ✓ (3 helpers com guard inline)
- `finalize-capture` ✓ (check+register inline)
- `recover-stuck-otp` ✓ (helper com guard inline)
- `manual-step-send` — bypass intencional (operador humano)
- `whapi-webhook` — provider Whapi (Cloud API), não Baileys → não sujeito ao `fatal_lock`
- `_shared/channels/evolution.ts` — adapter genérico, recebe sender já embrulhado dos chamadores

## Plano de execução

**Passo único:** editar `admin-send-material/index.ts`:
- Adicionar import `checkSendQuota`, `registerSend`.
- Inserir guard antes do `sendMedia` (linha 89-90), com resposta 423 quando bloqueado.
- Chamar `registerSend` após `ok === true`.

**Passo opcional** (a confirmar): adicionar comentário documentando bypass nos 4 sites de alerta interno (`notify-consultant.ts` x2, `super-admin-alerts.ts`, `minio-quota-check.ts`).

## Detalhes técnicos

```ts
// admin-send-material/index.ts
import { checkSendQuota, registerSend } from "../_shared/anti-ban.ts";

const quota = await checkSendQuota(admin, inst.instance_name);
if (!quota.allowed) {
  return new Response(JSON.stringify({
    error: "Instância bloqueada (anti-ban)",
    reason: quota.reason,
    until: quota.until ?? quota.next_allowed_at ?? null,
  }), { status: 423, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const sender = createWhatsAppSender(evolutionUrl, evolutionKey, inst.instance_name);
const ok = await sender.sendMedia(phone, mediaUrl, caption, mediatype);
if (ok) await registerSend(admin, inst.instance_name);
```

Instância `igreen-953f7e48509b` continua 100% protegida até 2026-06-18.
