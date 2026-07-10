## O que muda na lista de captação

Dois ajustes cirúrgicos na coluna esquerda de **Captação**, inspirados em Intercom Inbox / HubSpot Conversations / Front:

### 1. Arrastar livremente a largura da lista

Hoje o `DragResizer` limita entre **180px e 360px**. Vamos ampliar para acompanhar padrão do mercado:

- **Mínimo:** 220px (não some do útil)
- **Máximo:** 560px (dá pra ver mensagem/telefone inteiros)
- **Duplo clique no divisor:** reseta pro default (260px)
- **Cursor `col-resize`** já existe, mantemos
- Handle fica visualmente mais evidente no hover (linha de 2px vira 4px em accent color)

Estado persiste em `localStorage` como já é hoje (`captacao-list`).

### 2. Cabeçalhos "Em atendimento" / "Em espera" fixos no topo

Hoje cada header é `sticky top-0` isolado — quando você rola, o de "Em espera" **empurra** o de "Em atendimento" pra cima em vez de empilhar. Padrão do Intercom/Front é:

- **"Em atendimento"** gruda no topo enquanto seus leads passam
- Quando chega o fim do grupo, **"Em espera"** desliza por cima e assume o topo
- Contadores (`16` / `1`) sempre visíveis à direita
- Cores tonais mantidas (verde/âmbar), mas com **fundo sólido** (`bg-card`) em vez de `bg-muted/30` translúcido — evita o texto atrás vazar durante scroll
- Adicionar sombra sutil (`shadow-sm`) só quando grudado no topo (via `[&.is-stuck]` ou `top-0` + backdrop)
- Micro-badge de status: pontinho verde pulsando em "Em atendimento" quando há leads ativos (padrão Intercom)

### 3. Refinos visuais que acompanham (pequenos)

- Header da coluna ("Conversas · 17") também ganha `bg-card` sólido para não misturar com a área rolável
- Contadores dos grupos ficam com tipografia tabular mais firme (`font-semibold tabular-nums`)
- Divisor entre grupos vira uma linha de 1px mais discreta

## Arquivos afetados

- `src/components/captacao/CaptacaoPanel.tsx` — só ajustar `minPx`/`maxPx`/`defaultPx` do `<DragResizer>` (linha 275) e `--cap-list-w` inicial
- `src/components/captacao/CaptureLeadList.tsx` — cabeçalho `<section>` do `LeadSection` (linha ~600): trocar `bg-muted/30` por `bg-card`, garantir empilhamento correto do sticky, adicionar dot animado no "Em atendimento"
- (Se necessário) `src/components/common/DragResizer.tsx` — suporte a duplo-clique = reset

## O que **não** muda

- Lógica de agrupamento (`welcome_sent_at != null` → atendimento)
- Filtros de período, seleção em lote, botão "Novo cliente", "Abrir atendimento"
- Painel direito (details) e seu colapso `»` continuam iguais
- Nenhuma mudança em backend, edge functions ou dados

Confirma que é isso? Se sim, aprovo e implemento.