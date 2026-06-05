# Redesign do "Envio em Massa" (Disparo PRO)

Aplica a direção escolhida (Split-screen + preview WhatsApp) com paleta Emerald Prestige e tipografia Outfit/Figtree, e resolve os 3 pedidos: clareza visual, botão de expandir e templates pré-criados.

## O que muda

### 1. Layout split-screen no `BulkProPanel`
- Header verde-escuro (`#064e3b`) com título "Disparo PRO" (acento dourado em "Disparo") e botão **Expandir Tela** (ícone Maximize2) à direita.
- Stepper horizontal de 4 etapas (Contatos / Mensagem / Envio / Acompanhar) com bolinhas, conector linear, ativo em dourado (`#c9a84c`), inativos translúcidos.
- Corpo dividido em duas colunas: esquerda 1/3 (seleção de contatos), direita 2/3 (conteúdo da etapa). Em mobile vira coluna única.
- Footer fixo com "Voltar" e "Próxima Etapa" (botão verde com seta dourada).

### 2. Modo Expandir
- Estado `expanded` no `BulkProPanel`. Quando ativo, o painel sai do fluxo normal e vira `fixed inset-2 z-50` (overlay quase fullscreen) com `Esc` para fechar.
- Ícone alterna entre Maximize2 ↔ Minimize2. Transição 200ms.
- Aplica-se em qualquer etapa, mas é mais útil na etapa 1 (lista) e 4 (acompanhar).

### 3. Lista de contatos espaçada (etapa 1)
- Reorganizar `ContactImporter` ou criar wrapper que renderize:
  - Busca grande (h-11) no topo com ícone Search.
  - Tabs de fonte (Base / Extrair / Colar / Importar) menores e como segmented control.
  - Chips de filtro (Todos / Aprovado / Reprovado / Pendente / Últimas 48h / DDD).
  - Linhas de contato com 56px mín., avatar com iniciais, nome + telefone empilhados, badge de status à direita, checkbox visível à esquerda. Linha selecionada com `bg-primary/5` + borda esquerda dourada.
- Painel direito da etapa 1 mostra os 3 cards de resumo (Selecionados / Duplicados / Inválidos) maiores, com ícones, e o histórico de disparos abaixo (já existente).

### 4. Templates pré-criados (etapa 2)
- A prop `templates: MessageTemplate[]` já chega no `BulkProPanel`. Repassar para `MessageEditor`.
- Adicionar no topo do `MessageEditor`:
  - Botão/Popover **"Usar template existente"** que abre um `Command`/`Dialog` listando templates do consultor com nome, prévia (2 linhas) e indicador se tem mídia.
  - Ao escolher: preenche `text` (e `media` se o template tiver `image_url`/etc.). Pergunta de confirmação se o textarea já tem conteúdo.
  - Botão "Salvar como template" abre dialog simples (nome) e usa a tabela existente de `message_templates` para persistir.

### 5. Tokens de design
- Em `src/index.css` (e `tailwind.config.ts`), adicionar/ajustar tokens HSL para a paleta Emerald Prestige só no escopo do Disparo PRO via classe wrapper (`.disparo-pro`) para não impactar o resto do app:
  - `--dp-bg: 45 56% 92%` (cream)
  - `--dp-surface: 0 0% 100%`
  - `--dp-primary: 160 80% 26%` (deep emerald)
  - `--dp-primary-strong: 160 87% 16%`
  - `--dp-accent: 44 53% 54%` (dourado)
- Tipografia: carregar Outfit + Figtree via `<link>` no `index.html` e mapear `font-heading` → Outfit, `font-body` → Figtree dentro do wrapper.

## Arquivos afetados
- `src/components/whatsapp/bulk-pro/BulkProPanel.tsx` — header, stepper, layout split, botão expandir, passagem de `templates` ao editor.
- `src/components/whatsapp/bulk-pro/MessageEditor.tsx` — botão "Usar template" + dialog + "Salvar como template".
- `src/components/whatsapp/ContactImporter.tsx` — ajustes de espaçamento/busca grande/linhas 56px (mudanças visuais, não altera lógica de seleção).
- `src/index.css`, `tailwind.config.ts` — tokens `--dp-*` e fontes.
- `index.html` — `<link>` Google Fonts (Outfit, Figtree).

## Fora de escopo
- Não mexer em backend, edge functions, lógica de envio, persistência, agendamento, anti-bloqueio, retomada de campanha, healthcheck de instância.
- Não alterar as abas vizinhas (Dashboard / Conversas / Atendente IA / Templates / Agendamentos / Histórico) — só o painel "Envio em Massa".
- Não adicionar IA, analytics ou novos campos no banco.
