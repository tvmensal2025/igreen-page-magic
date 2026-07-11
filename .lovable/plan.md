
# Ajustes na Captação

Quatro problemas relatados, todos em `src/components/captacao/`.

## 1. Botão "Selecionar" está marcando todo mundo

Hoje `toggleSelectMode` já entra no modo com **todos** os leads filtrados pré-selecionados. Vai passar a entrar com **seleção vazia** — o consultor marca os que quiser (1, 2, 10…). Os atalhos "Todos do período" e "Só sem atendimento" continuam pra quem quiser marcar em massa.

Arquivo: `CaptureLeadList.tsx` (`toggleSelectMode`, ~L448).

## 2. Checkbox "branco/estranho" ao marcar

O `Checkbox` shadcn atual (`src/components/ui/checkbox.tsx`) é 16px, borda fina e sem fundo quando desmarcado — some no card. Vou:

- Aumentar pra `h-5 w-5`, borda mais visível (`border-2`), fundo `bg-background` quando desmarcado.
- Marcado: fundo `bg-primary` com check branco bem visível (já é primary-foreground, ajustar contraste do ícone pra ficar nítido).
- Estilo aplicado só no local (via `className` no uso em `LeadCard`) para não mexer no shadcn global.

## 3. Modal "Abrir atendimento" — template editável em vez de frase fixa

Hoje o toggle "Iniciar atendimento" dispara o **texto fixo do protocolo** (`start-customer-attendance`). O consultor quer escolher um **template** e **editar** o texto antes de disparar em lote.

Reorganizar o `OpenAttendanceBatchDialog.tsx`:

- Colocar o bloco **"Mensagem de texto"** no topo, aberto por padrão, com o `Select` de templates + `Textarea` sempre visível (não escondido atrás de condição).
- Chip `{{nome}}` continua, e adicionar preview do primeiro lead ("Como será enviado pra Fulano: …").
- O toggle "Iniciar atendimento (registrar protocolo)" fica em **posição secundária** e com descrição clara: "só marca protocolo interno, sem enviar frase padrão". Default: **ligado** se nenhum template escolhido, **desligado** se o consultor escolheu template próprio (evita mandar 2 mensagens).
- Botões `Áudio` e `Imagem` seguem como estão.

Envio já suporta `customText` no `runAttendanceBatch` — só é UX.

## 4. Leads novos em "Em espera" não aparecem na Captação

Causa: a query em `CaptureLeadList.tsx` (L172-181) filtra `capture_mode = 'manual'`. Lead novo que entrou por anúncio/whapi vem com `capture_mode = 'auto'` (bot cuidando), então nunca aparece na Captação — fica só no chat do WhatsApp.

Solução: relaxar o filtro para trazer também os `auto` que ainda **não têm `welcome_sent_at`** e **não estão fechados** (sem `capture_closed_at`, sem `igreen_code`, sem `assinatura_cliente`). Assim:

- Aba **Em atendimento**: leads com `welcome_sent_at != null` (como hoje).
- Aba **Em espera**: leads sem `welcome_sent_at` — tanto `manual` quanto `auto` (todos os novos, inclusive campanha).

Mudança na query:

```ts
.or('capture_mode.eq.manual,welcome_sent_at.is.null')
```

Continua respeitando: mesmo consultor, sem `capture_closed_at`, sem `igreen_code`, sem `assinatura_cliente`, e sem sale com `outcome` (já filtrado). Isso não interfere no bot — só amplia o que a UI mostra.

## Arquivos tocados

- `src/components/captacao/CaptureLeadList.tsx` — seleção vazia, filtro de query, className do checkbox.
- `src/components/captacao/OpenAttendanceBatchDialog.tsx` — reorganizar bloco de texto, default do toggle.
- `src/components/ui/checkbox.tsx` — só se o className local não bastar (evito mexer se der).

Sem mudanças de banco, edge functions ou lógica do bot.
