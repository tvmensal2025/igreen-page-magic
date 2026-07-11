
## Objetivo

Deixar o "Iniciar atendimento" **sempre visível no topo** do Chat (WhatsApp) e do Captação, com comportamento profissional e único:

- **1 lead selecionado / lead aberto** → dispara direto `start-customer-attendance` (sem modal, com toast de progresso).
- **2+ leads selecionados** → abre o modal `OpenAttendanceBatchDialog` (áudio, imagem, texto, timer, intervalo).
- **Já iniciado** → botão vira o pill do protocolo (comportamento atual do `AttendanceStatusBar`), sem mostrar "Iniciar" de novo.

## Pontos que já achei que precisam arrumar (evitar erro)

1. **Chat (`ChatView.tsx` ~L628)** — hoje o `onStart` do `AttendanceStatusBar` chama `setStartBatchOpen(true)`, ou seja, sempre abre modal, mesmo para 1 cliente. Vai ficar direto.
2. **Captação cockpit (`CaptacaoPanel.tsx` ~L375)** — mesmo problema: o topo do cockpit monta um "batch de 1" e abre o modal. Vai virar chamada direta à edge.
3. **Lista de Captação (`CaptureLeadList.tsx` ~L685-702)** — o CTA só aparece **no rodapé** e apenas quando `selectMode` está ligado. Para o consultor é lento (precisa entrar em "Selecionar" → marcar → rolar). Vou:
   - Manter a barra fixa no rodapé (padrão de multi-seleção).
   - Adicionar **barra flutuante no topo da lista** quando `selectedIds.size >= 1` (com contador + CTA "Iniciar" ou "Abrir (N)").
4. **Guarda "já iniciado"** — hoje o fast-path em `CaptacaoPanel` já checa `welcome_sent_at`, mas o chat não. Vai passar a checar `attendance.uiState !== "not_started"` antes de invocar.
5. **Sem debounce** — clicar 2x dispara 2 chamadas. Vou desabilitar o botão enquanto `attendance.starting` estiver ligado (já existe no `AttendanceStatusBar`, só preciso propagar no fast-path do Chat/Cockpit também).
6. **Erros silenciosos** — a edge devolve `{ok:false, fallback:true}` em vários casos (canal off, sem telefone). Vou padronizar o handler em um util só (`runFastStartAttendance`) usado por Chat, Cockpit e Lista, com toasts consistentes (`loading` → `success | warning fallback | error`).

## Mudanças

### 1) Novo util compartilhado
`src/components/captacao/runFastStartAttendance.ts`
- Recebe `{ customerId, consultantId }`.
- Emite toast de loading, chama `supabase.functions.invoke("start-customer-attendance", …)`.
- Trata `ok:false + fallback` como warning, resto como error, sucesso mostra protocolo.
- Retorna `{ ok, protocol?, fallback? }` para o caller decidir foco/estado.

### 2) Chat (`src/components/whatsapp/ChatView.tsx`)
- `AttendanceStatusBar.onStart` → chama `runFastStartAttendance` direto (sem `setStartBatchOpen`).
- Remove/oculta o caminho antigo `startBatchOpen` para 1 lead (mantém `OpenAttendanceBatchDialog` só para caso de seleção em lote futuro, se houver).
- Após sucesso, faz `attendance.refresh()` (se existir) ou dispara evento que o hook já escuta.

### 3) Captação cockpit (`src/components/captacao/CaptacaoPanel.tsx`)
- Substitui o `onStart` do `AttendanceStatusBar` do topo do cockpit (L375-394) pela chamada direta a `runFastStartAttendance` com o `selectedId`.
- Fast-path da lista (`onOpenBatch` com 1 lead) passa a reusar o mesmo util (dedup do código atual L280-315).

### 4) Lista de Captação (`src/components/captacao/CaptureLeadList.tsx`)
- Adiciona **barra sticky no topo da lista** (logo abaixo das abas "Em atendimento / Em espera") quando `selectedIds.size >= 1`:
  - `1 selecionado` → botão primário "Iniciar atendimento" (fast-path).
  - `2+ selecionados` → botão primário "Abrir atendimento (N)" (abre modal atual).
  - Botão secundário "Limpar".
- Mantém a barra do rodapé como está (redundância proposital em listas longas).
- Bloqueio visual quando `!whatsappConnected` (badge "WhatsApp desconectado" no lugar do CTA).

### 5) `AttendanceStatusBar`
- Sem mudança de API. Só passa a receber `onStart` que já dispara a ação real (não abre mais modal).

## Fora de escopo

- Não mexo em `start-customer-attendance` (edge), `close-attendance-scheduled`, template de saudação, `OpenAttendanceBatchDialog` (só passa a ser chamado só quando N≥2).
- Nada de refactor no `useCustomerAttendance` além de expor `refresh()` se ainda não estiver exposto.

## Riscos

- Baixo: as chamadas já existem e estão testadas via lista. Ganho principal é consistência (mesmo caminho em 3 lugares) e velocidade (sem modal para 1 lead).
