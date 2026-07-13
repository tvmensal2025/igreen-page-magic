## Problema

Hoje, na lista de Captação, um lead entra em **"Em atendimento"** assim que `welcome_sent_at` é preenchido — e nunca mais sai, mesmo depois de o consultor clicar em **"Finalizar atendimento"**. Como o cliente raramente responde à pesquisa 1–5, dezenas de leads ficam presos em "Em atendimento", impedindo o consultor de selecioná-los novamente para disparar um novo atendimento em lote.

## Regra desejada

Um lead deve aparecer em **"Em espera"** quando:
- ainda não recebeu boas-vindas (`welcome_sent_at IS NULL`), **OU**
- já teve o atendimento **finalizado** pelo consultor (`attendance_rating_requested_at IS NOT NULL`), independente do cliente ter respondido a pesquisa.

Assim, ao clicar em "Finalizar", o lead volta para "Em espera" e pode ser incluído em uma nova seleção em massa para iniciar outro atendimento.

Continua em **"Em atendimento"** apenas quem tem `welcome_sent_at` preenchido **e** `attendance_rating_requested_at IS NULL` (atendimento em curso, ainda não encerrado).

## Mudanças

### 1. `src/components/captacao/CaptureLeadList.tsx`
- Adicionar `attendance_rating_requested_at: string | null` na interface `CaptureBatchLead`.
- Incluir a coluna no `select` do `load()` e no mapeamento das linhas.
- Ajustar o agrupamento (linhas 370–371):
  ```ts
  const emAtendimento = filtered.filter(l => !!l.welcome_sent_at && !l.attendance_rating_requested_at);
  const emEspera      = filtered.filter(l => !l.welcome_sent_at ||  !!l.attendance_rating_requested_at);
  ```
- Ajustar `unreadByTab` (linha 388) e `selectWithoutAttendance` (linha 478) com a mesma condição, para que "Só sem atendimento" também inclua os finalizados.

### 2. `src/hooks/useCustomerAttendance.ts` (leitura já existente)
Sem mudanças — o hook já lê `attendance_rating_requested_at`. A lista faz sua própria query e realtime, então basta atualizar `CaptureLeadList`.

### 3. Realtime
O canal atual já recarrega em `UPDATE` de `customers`. Como `end-customer-attendance` grava `attendance_rating_requested_at`, o lead migra automaticamente de aba assim que o botão "Finalizar" é clicado.

## Fora de escopo

- Não mexer em `start-customer-attendance` / `end-customer-attendance` — o comportamento server-side (protocolo, envio, kill-switch) continua igual.
- Não alterar `CloseCaptureButton` / `CloseCaptureDialog` (Ganho/Perdido continua removendo o lead da lista via `capture_closed_at`).
- Sem migração de banco — a coluna `attendance_rating_requested_at` já existe.

## Como validar

1. Abrir Captação, escolher um lead em "Em atendimento", clicar **Finalizar atendimento**.
2. Confirmar que o lead sai de "Em atendimento" e aparece em "Em espera" em segundos (via realtime).
3. Ativar seleção múltipla, usar **"Só sem atendimento"** — o lead finalizado deve ser selecionado junto.
4. Disparar batch: o modal reabre atendimento normalmente para esses leads.
