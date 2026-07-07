## Botão de pré-visualizar e personalizar a mensagem antes de enviar

**Objetivo:** no card do dashboard (`RetentionCard`), o consultor precisa poder **clicar, ver exatamente o texto que vai pro WhatsApp e editar antes de enviar**. Hoje o popover de aniversário dispara direto e a lista de "Reativar parados" não tem botão nenhum.

Só UI. Sem mexer em banco, envio automático, edge functions ou templates existentes.

### 1. Popover de aniversário — passar de "clicou = envia" para "clicou = pré-visualiza e edita"

Arquivo: `src/components/admin/RetentionCard.tsx` (componente `BirthdayMessageButton`).

Fluxo novo dentro do mesmo Popover:
- **Tela 1 (lista de templates)** — igual está hoje: "Enviar aleatória" + 10 mensagens.
  - Clicar em qualquer template **não envia mais**. Pré-carrega o texto (com nome já preenchido via `fillBirthdayMessage`) num campo editável e vai pra Tela 2.
  - "Enviar aleatória" também vai pra Tela 2 com uma mensagem sorteada.
- **Tela 2 (pré-visualização editável)**:
  - `Textarea` grande com o texto final (asteriscos do WhatsApp preservados, o consultor vê exatamente o que vai chegar).
  - Contador de caracteres.
  - Botão "← Trocar mensagem" (volta pra Tela 1).
  - Botão "Sortear outra" (recarrega o textarea com um template aleatório).
  - Botão principal "📱 Abrir WhatsApp" — chama `openBirthdayWhatsApp(phone, textoAtualDoTextarea)`.
- O estado `open` do popover continua igual. Reset da tela para "lista" quando o popover fecha.

### 2. Botão "Mandar oi" para cada cliente parado

No card **"Reativar clientes parados"**, cada `<li>` ganha um botão à direita (mesmo estilo compacto do botão de aniversário, ícone `MessageCircle`).

Novo componente **`ReactivationMessageButton`** no mesmo arquivo, com mesma estrutura do popover de aniversário:
- Se cliente não tem WhatsApp válido (`isValidWhatsAppPhone`) → mostra `sem zap` no lugar do botão.
- Popover com 5–6 templates curtos de reativação (definidos localmente no arquivo — não precisa lib nova). Exemplos:
  - "Oi *{{firstName}}*! Tudo bem? Faz um tempinho que a gente não conversa. Passei pra saber se posso te ajudar com algo. 🌱"
  - "Oi *{{firstName}}*, aqui é da iGreen. Vi que seu cadastro ficou pendente — quer que eu te ajude a finalizar? Leva 2 minutos."
  - "*{{firstName}}*, tudo certo? Notei que ficamos um tempão sem falar. Se preferir, posso te mandar de novo as informações da economia na conta de luz."
  - "Oi *{{firstName}}*! Já já a gente fecha as vagas do mês. Se quiser garantir o desconto, me chama aqui. 👋"
  - "*{{firstName}}*, tudo joia? Só passando pra lembrar que sua economia com a iGreen ainda está te esperando. Bora conversar?"
- Mesmo fluxo em duas telas do aniversário: lista → pré-visualização editável → botão "Abrir WhatsApp".
- Usa a mesma helper `openBirthdayWhatsApp` (é genérica — abre `wa.me/<phone>?text=<msg>` — só o nome sugere aniversário). Se preferir clareza, envolver numa helper `openWhatsAppWithText(phone, text)` que delega para a existente, para não misturar semântica.

### 3. Extração de helpers pra evitar duplicação

Como o fluxo "lista → edita → envia" fica igual pros dois cards, extrair um sub-componente **`MessagePreviewEditor`** interno ao arquivo com props:
- `initialText: string`
- `firstName?: string`
- `templates: string[]` (para o botão "Sortear outra")
- `phone: string`
- `onSent?: () => void`

Ele renderiza o Textarea + contador + botões "← Trocar", "Sortear", "Abrir WhatsApp". Assim `BirthdayMessageButton` e `ReactivationMessageButton` reusam a mesma tela 2.

### 4. Fora do escopo
- Não altera `src/lib/birthdayMessages.ts` (só usa).
- Não muda envio automático (`auto_wa_aniversariante`, `auto_wa_boleto_vencendo`) nem edge functions — este botão é envio manual assistido.
- Não persiste o texto editado; é one-shot pra abrir o WhatsApp.
- Não mexe no restante do `DashboardTab` — só no `RetentionCard`.

### Arquivo afetado
- `src/components/admin/RetentionCard.tsx` (única mudança).
