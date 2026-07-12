## Diagnóstico

"Envie manualmente" é o **fallback** de `start-customer-attendance` / `end-customer-attendance`. Ele só aparece quando `sendWelcomeHeader` retorna um dos códigos:

| código | causa real | fix real |
|---|---|---|
| `automation_disabled` | toggle `start_customer_attendance` OFF em Admin → Automações | ligar o toggle |
| `channel_unavailable` (`whapi_token_missing`) | super admin sem `whapi_token` em `settings` | atalho → Config Whapi |
| `channel_unavailable` (`no_instance_for_consultant`) | consultor sem `whatsapp_instances` conectada | atalho → Config Evolution |
| `send_failed_greeting` / `send_failed_protocol` | Evolution respondeu `false` (instância `disconnected`/`close`) | atalho → status da instância + reconectar |
| `no_phone` | `phone_whatsapp` inválido/sem DDI | atalho → editar telefone do cliente |
| `rate_limited` | anti-ban bloqueou envio | mostrar quando libera; não é erro |
| `protocol_generation_failed` | RPC de protocolo caiu | já tem fallback local; não deveria mais aparecer |

Hoje o toast joga tudo no mesmo balaio ("Envie manualmente") sem dizer **qual** e sem link para resolver. Por isso parece "manual toda hora".

## Objetivo

1. **Automático de verdade** quando dá pra ser automático (toggle ON + canal OK).
2. Quando não dá, mensagem específica + **atalho clicável** para a configuração exata.
3. Nunca mais mostrar "envie manualmente" genérico.

## Escopo

### A. Frontend — `useCustomerAttendance` (start + end)
- Trocar `useToast` genérico por sonner com `action`:
  - `automation_disabled` → botão **"Ativar automação"** → `/admin?tab=agendamentos&section=automacoes&flag=start_customer_attendance`.
  - `channel_unavailable` + detail `whapi_token_missing` → **"Configurar Whapi"** → `/admin?tab=config&section=whapi`.
  - `channel_unavailable` + detail `no_instance_for_consultant` / `no_consultant` → **"Conectar WhatsApp"** → `/admin?tab=whatsapp-config`.
  - `send_failed_greeting` / `send_failed_protocol` → **"Ver instância"** → `/admin?tab=whatsapp-config&instance=<name>` + botão secundário **"Tentar de novo"** que reinvoca a edge.
  - `no_phone` → **"Editar telefone"** → abre chat do cliente com sheet de edição.
  - `rate_limited` → sem ação (info), reagenda automaticamente.
- Descrição mostra o `detail` real (não mais só "tente de novo").

### B. Frontend — `runFastStartAttendance.ts` e `runAttendanceBatch.ts`
- Mesmo helper de toast; no batch, cada linha "skipped" ganha botão **"Abrir chat"** e **"Reprocessar"** no relatório final (`LeadsBatchReport`).

### C. Edge — endurecer o "automático"
- `start-customer-attendance/index.ts`:
  - devolver `detail` sempre (hoje só devolve pra alguns códigos) + `fixHint: "whapi_token"|"evolution_instance"|"phone"|"toggle"` para o front escolher o CTA sem parse frágil.
  - antes de retornar `send_failed_*`, tentar **1 retry** com 800ms de backoff (rede/timeout momentâneo é o que mais gera manual falso).
  - se `origin_channel` gravado mas instância **offline**, resolver de novo pelo papel (super → whapi, resto → evolution) em vez de assumir o origin morto — já existe `resolveAttendanceChannel`, só falta o "revive" quando `send_failed_*`.
- `end-customer-attendance/index.ts`: mesmo tratamento (retorna `fixHint`).

### D. Helper novo — `src/lib/attendanceShortcut.ts`
- Mapa `fixHint → { label, href, secondaryLabel?, secondaryAction? }`.
- Exporta `notifyAttendanceOutcome(result, { navigate, retry })` — 1 função usada pelos 3 chamadores (hook, fast-start, batch).

### E. Fora de escopo
- Motor de cadência, worker portal-2, atribuição de campanha, RLS, migração de banco.

## Verificação

- Toggle OFF → toast "Automação desligada" + botão leva à aba Automações com o flag destacado.
- Consultor sem instância → toast "Conecte o WhatsApp" + botão abre config da instância.
- Instância `close`/`disconnected` → retry automático; se falhar, toast "Instância X offline" + botão "Reconectar".
- Fluxo feliz (toggle ON + instância `connected`) → **sem toast de "envie manualmente"**, atendimento vai automático.
