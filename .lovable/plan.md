## Mostrar automações ativas em todos os lugares (fácil de ver e desligar)

**Objetivo:** quando o consultor liga um toggle em "Automações iGreen" (boleto no WhatsApp, aniversário, cross-sell), isso precisa ficar visível na tela inicial, no topo do WhatsApp/Mensagens e ao lado de cada conversa. Clicar em qualquer indicador abre um mini-painel flutuante com os mesmos toggles pra ligar/desligar sem sair da tela.

Só camada visual — nada de banco, edge function ou lógica de envio.

### 1. Componente novo: `AutomacoesAtivasBadge`
Arquivo: `src/features/produtos/acompanhamento/AutomacoesAtivasBadge.tsx`

- Lê `useAutomationSettings(consultantId)` e conta quantos dos 3 toggles proativos estão ligados: `auto_wa_boleto_vencendo`, `auto_wa_aniversariante`, `cross_sell_bot`.
- Se **0** ativos → renderiza nada (fica invisível, não polui).
- Se **≥1** → renderiza um chip/pílula compacto:
  - Ícone raio + texto: "**N automações ligadas**" (ou nome curto quando `variant="chips"`, ex: `Boleto WA · Aniversário`).
  - Cor de alerta suave (amber/warning) pra sinalizar "isso está agindo sozinho".
- Ao clicar → abre `AutomacoesAtivasPopover` (mini-painel flutuante).
- Props: `consultantId`, `variant?: "chip" | "chips" | "dot"`, `className?`.
  - `chip` = pílula única com contador (usada no topo/home).
  - `chips` = lista horizontal de nomes curtos (topo do WhatsApp).
  - `dot` = pontinho colorido pequeno (ao lado de cada conversa).

### 2. Componente novo: `AutomacoesAtivasPopover`
Mesmo arquivo. Usa `Popover` do shadcn.

- Título: "Automações ligadas para este consultor"
- Lista os 3 toggles proativos com Switch (reaproveita `useUpdateAutomationSetting`) e labels em português claro (iguais aos do card grande).
- Rodapé com link "Ver todas as automações" que rola até o card completo no `AgendamentosHub`.
- Toast de confirmação ao ligar/desligar (mesmo padrão do card).

### 3. Pontos onde vai aparecer

**a) Home / Dashboard inicial** — `src/pages/Index.tsx` (ou o painel inicial equivalente já existente)
- Adicionar `<AutomacoesAtivasBadge consultantId={...} variant="chip" />` no topo, ao lado do saudação/header do consultor.

**b) Topo da tela do WhatsApp/Mensagens** — no cabeçalho do `AgendamentosHub.tsx` e da lista de conversas (`WhatsAppClientsPage.tsx` ou componente equivalente)
- `variant="chips"` mostrando pílulas curtas ("Boleto WA", "Aniversário", "Cross-sell") só das que estão ligadas.

**c) Ao lado de cada conversa na lista**
- Localizar o item de lista de conversa (dentro de `WhatsAppClientsPage`/lista de leads) e adicionar `variant="dot"` — um pontinho amber pequeno com tooltip "Este cliente pode receber mensagens automáticas". Só aparece se pelo menos 1 automação proativa estiver ligada para o consultor dono da conversa.

### 4. Fora do escopo
- Não muda `automationSettings.ts` nem os defaults.
- Não muda envio/edge functions.
- Não muda o card `AutomacaoIgreenCard` em si (continua sendo a fonte primária).
- Não filtra por cliente individual — o toggle é por consultor, então o indicador é global do consultor. O "dot" na conversa só reflete "consultor tem automação ligada", não status por cliente.

### Arquivos afetados
- **Novo:** `src/features/produtos/acompanhamento/AutomacoesAtivasBadge.tsx` (badge + popover)
- **Editar:** `src/pages/Index.tsx` (ou home equivalente) — inserir badge chip
- **Editar:** `src/components/whatsapp/AgendamentosHub.tsx` — inserir chips no header
- **Editar:** componente de lista de conversas do WhatsApp — inserir dot por item

### Detalhes técnicos
- Cor amber vem de token semântico (`bg-amber-500/10 text-amber-700 dark:text-amber-400` via classes utilitárias já usadas no projeto; se houver token `warning` no design system, prefere ele).
- Popover reusa `@/components/ui/popover` já disponível (shadcn).
- Query `useAutomationSettings` já tem cache do React Query — múltiplas instâncias do badge compartilham a mesma request.
- O badge não renderiza nada se `consultantId` estiver ausente ou se query ainda estiver carregando (evita flicker).
