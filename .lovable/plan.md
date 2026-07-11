
# Modal "Iniciar atendimento" — unificar e destravar

Nota: `.lovable/` está no `.gitignore` — este plano não persiste no repo. Se quiser mantê-lo, me diga para remover a entrada.

## O que muda

### 1. Um único modal para 1 lead ou vários

Hoje:
- `Selecionar` + `Abrir atendimento` → abre `OpenAttendanceBatchDialog` (com template editável).
- Botão ▶ `Iniciar` no cabeçalho do chat (`AttendanceStatusBar` via `attendance.startAttendance()`) → dispara direto a frase padrão, **sem** modal.

Vai passar a:
- `onStart` do `AttendanceStatusBar` (linha 346 de `CaptacaoPanel.tsx`) abre o **mesmo** `OpenAttendanceBatchDialog`, pré-carregado com **1 lead** (o cliente selecionado).
- No cabeçalho do WhatsApp Tab (mesmo componente `AttendanceStatusBar`) idem: `onStart` abre o modal em vez de disparar direto.

Assim, sempre que o consultor clicar "Iniciar", ele vê o modal editável.

### 2. Protocolo padrão + mensagem própria juntos

Regra confirmada pelo usuário: **envia os dois**.

Em `runAttendanceBatch.ts`, o `startAttendance: startAttendance && !customText` atual **anula** o protocolo quando há texto próprio. Vai virar apenas `startAttendance` (respeitando o toggle). Ordem por lead: protocolo → áudio → imagem → texto próprio, com o mesmo `delayMs` de 5s entre leads.

No `OpenAttendanceBatchDialog.tsx`:
- Toggle "Registrar protocolo interno" fica com label mais clara: **"Enviar saudação + protocolo padrão"** e descrição "Envia a frase de abertura do sistema antes da sua mensagem". Default **ligado**, e **não** desliga sozinho quando há texto — porque agora os dois convivem.
- Remover a linha `startAttendance: startAttendance && !customText` — passa `startAttendance` puro.

### 3. Consertar visual do modal ("não dá para editar direito")

Auditando `OpenAttendanceBatchDialog.tsx`:
- `max-h-[90dvh]` + `overflow-hidden` no container e `overflow-y-auto` no meio → em telas 742px CSS, com a lista de leads (`max-h-44 = 176px`), o textarea de 5 rows fica cortado atrás do footer sticky. Vou:
  - Baixar a lista para `max-h-32` quando ≤3 leads e `max-h-44` acima disso.
  - Textarea `rows={4}` com `min-h-[96px]` e `max-h-[160px]` para não engolir os blocos de áudio/imagem.
  - Garantir que o bloco de texto fica no topo do scroll (já está — só reforçar `scroll-mt-2`).
- O `Select` do template está com trigger `border-0` dentro de outra borda; alguns usuários não percebem que é clicável. Trocar para trigger visível (`h-9`, `border`, ícone chevron), colocando o Select como linha própria acima do textarea, sem o "cartão com ícone MessageSquare" (que confunde por parecer o campo de edição).
- Aumentar `max-w-md` para `max-w-lg` (o modal está apertado demais na largura atual).

### 4. Ajustes no hook `useCustomerAttendance`

`startAttendance()` continua existindo para uso programático (fluxo antigo/interno), mas na UI ninguém mais chama direto. O componente `CaptacaoPanel` passa um novo callback `onStart={() => openBatchWith([currentLead])}`. Mesma mudança no `WhatsAppTab` onde o `AttendanceStatusBar` renderiza.

## Arquivos tocados

- `src/components/captacao/OpenAttendanceBatchDialog.tsx` — reorganizar bloco de texto, aumentar largura, textarea com min/max-h, toggle com label nova.
- `src/components/captacao/runAttendanceBatch.ts` — na verdade **nada**; a mudança de "sempre respeitar startAttendance" é feita no dialog (parâmetro que ele passa). Se preferir, deixo só no dialog.
- `src/components/captacao/CaptacaoPanel.tsx` — trocar `onStart` para abrir o modal com o lead atual em vez de disparar direto; expor helper `openBatchWith(leads, label)`.
- `src/components/whatsapp/WhatsAppTab.tsx` (ou onde `AttendanceStatusBar` é usado no chat) — mesmo tratamento: `onStart` abre modal com o cliente atual (a definir arquivo exato ao implementar).

Sem mudanças de edge function, banco ou lógica do bot.

## Fora de escopo

- Editar visual do `Select` shadcn global.
- Mudar o `start-customer-attendance` (continua enviando saudação+protocolo como hoje).
