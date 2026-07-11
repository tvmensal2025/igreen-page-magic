
## Objetivo

Na Captação, ao clicar em **Iniciar atendimento** com **1 lead selecionado** → dispara direto o protocolo (sem abrir modal). Com **2+ leads** → abre o modal atual com opções de áudio/imagem/texto/timer.

Também acertar o motivo do "Falhou" que aparece na tela hoje.

## Diagnóstico do "Falhou"

`runAttendanceBatch.startAttendanceForLead` trata **qualquer** `ok:false` (fora de `already_sent`) como `throw` → o lead vira **Falhou** no modal. Mas a edge `start-customer-attendance` já retorna `ok:false` com `fallback:true` em vários cenários "soft" (`channel_unavailable`, `send_failed_greeting`, `rate_limited`, `no_phone`, `protocol_generation_failed`) — nesses casos deveria mostrar aviso amigável, não "Falhou" cru.

## Mudanças

### 1. `src/components/captacao/CaptacaoPanel.tsx`
- Novo handler `handleOpenBatch(leads, periodLabel)`:
  - Se `leads.length === 1`: chama direto `supabase.functions.invoke("start-customer-attendance", …)` com toast de progresso/sucesso/erro (mesmo padrão do `useCustomerAttendance.startAttendance`), atualiza a lista via `refresh`, sem abrir modal.
  - Se `leads.length > 1`: fluxo atual (setBatchLeads / setBatchOpen).
- Passa `handleOpenBatch` no `onOpenBatch` do `CaptureLeadList` (assinatura já compatível).

### 2. `src/components/captacao/CaptureLeadList.tsx`
- Ajuste no botão da barra de seleção: label dinâmico
  - 1 selecionado → "Iniciar atendimento" (envia direto)
  - 2+ → "Abrir atendimento (N) — áudio/mensagem" (abre modal)
- Sem mudança de fluxo/regra além do label; a decisão real fica no Panel.

### 3. `src/components/captacao/runAttendanceBatch.ts`
- Em `startAttendanceForLead`, tratar `body.fallback === true` como **skipped** com detalhe (ex.: "canal indisponível") em vez de `throw`. Retornar novo estado `"fallback"` mapeado para `skipped` com `detail` legível — evita marcar como Falhou quando o back devolveu recuperável.

### 4. Nada muda em edge functions.

## Fora de escopo
- Redesign do modal batch.
- Alterar regras de canal/whapi/evolution.
- Auto-close (mantém como está).
