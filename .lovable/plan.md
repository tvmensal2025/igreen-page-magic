# Redesign — Central de Agendamentos

Objetivo: tornar a página mais bonita e fácil de entender, sem mudar comportamento nem estrutura de navegação. Cores da plataforma, sidebar e submenu de abas ficam exatamente como estão hoje.

## Escopo (o que muda)
Arquivo único: `src/components/whatsapp/AgendamentosHub.tsx` — apenas as áreas de **cabeçalho, KPIs, "Próximos envios", "O que está ligado" e "Dispara na hora"**. As 8 abas (`Visão geral`, `Agenda manual`, `Pós-venda`, `Reaquecimento`, `Campanhas`, `Rodízios`, `Automações iGreen`, `Histórico`) e o menu lateral do /admin permanecem intocados.

## Fora de escopo
- Menu lateral do /admin (mantido).
- Estrutura/ordem das abas (mantida).
- Lógica de dados (hooks, edge functions, toggles).
- Paleta: continua usando `--primary`, `--warning`, `--accent`, `--info`, `--background`, `--muted` etc. Nada de hex novo.

## Tokens visuais
- **Tipografia**: adicionar carregamento das Google Fonts `Sora` (títulos) e `Manrope` (corpo) em `index.html` e mapear no `tailwind.config.ts` como `font-display` (Sora) e `font-sans` (Manrope). Aplicar `font-display` nos títulos da Central; corpo herda Manrope global.
- **Cores**: mantidas — só reorganiza uso (mais respiro, gradientes suaves usando `--primary/5` → `--primary/15`).
- **Raio/sombra**: usar `rounded-2xl` nos blocos principais e sombra sutil `shadow-[0_1px_0_hsl(var(--border))]` para dar hierarquia sem peso.

## Redesign por seção

### 1. Cabeçalho
- Título com Sora, tamanho maior (`text-xl md:text-2xl`), com um pequeno "eyebrow" acima ("Central de Agendamentos") e subtítulo em Manrope mais claro.
- Ícone circular decorativo à esquerda com `bg-primary/10`.
- Botão "Atualizar" ganha rótulo visível em desktop; ícone-only em mobile.

### 2. Avisos (regra da carteira + validação pendente)
- Regra da carteira: converter em faixa com barra vertical de cor `--primary`, ícone destacado num quadrado `--primary/10`, texto mais respirado.
- "N clientes aguardando validação": elevar para cartão-CTA com número gigante à esquerda (Sora 32px), descrição à direita e chevron animado no hover.

### 3. KPIs (4 números)
- Trocar os 4 mini-cards por um **strip de KPIs** em grid `2×2` (mobile) / `4×1` (desktop) com:
  - Número grande (Sora tabular),
  - Rótulo em uppercase micro (Manrope 500),
  - Ícone à direita com fundo tonal (`primary/warning/accent/info` — cores atuais),
  - Divisórias verticais sutis entre eles em desktop.
- Cada KPI vira botão que rola até a seção correspondente ("Próximos envios" → âncora da lista).

### 4. "Próximos envios"
- Cabeçalho da seção com contador ("30 próximos") e filtro rápido por tipo (chips: Todos · Manual · Pós-venda · Campanha · Rodízio) — só filtro visual client-side sobre `timeline`.
- Itens da lista redesenhados:
  - Coluna de horário fixa à esquerda ("07 out · 18:22" em duas linhas, Sora tabular),
  - Timeline vertical com bolinha colorida por tipo,
  - Título em Manrope 600, badge de tipo mais discreta,
  - Preview de mensagem em itálico leve,
  - Hover mostra o CTA "configurar →" à direita (some o texto atual "clique para configurar" no estado padrão para reduzir ruído).
- Empty state ganha ilustração simples (ícone `CalendarCheck` grande em `text-muted-foreground/30`) + frase amigável.

### 5. "O que está ligado"
- Grid vira **bento leve** 2 colunas em desktop, cada card com:
  - Ícone grande no topo esquerdo dentro de quadrado tonal,
  - Toggle-status pill no canto superior direito (Ligado/Desligado/Configurável) usando cores atuais,
  - Contador em Sora 24px,
  - Descrição em Manrope,
  - Botão "Abrir e configurar" como link com seta em vez de outline pesado.

### 6. "Dispara na hora"
- Vira uma faixa horizontal de mini-cards com fundo `--muted/20` e borda tracejada sutil, deixando claro que é categoria diferente ("sem fila").

## Diagrama estrutural

```text
┌─────────────────────────────────────────────────────┐
│  Central de Agendamentos              [Atualizar ↻] │  ← header Sora
│  Tudo que sai sozinho, em um lugar só               │
├─────────────────────────────────────────────────────┤
│  ▍ Regra de ouro da carteira iGreen                 │
│  ▍ 713 clientes aguardando validação          [ → ] │
├─────────────────────────────────────────────────────┤
│  3           0            0            3            │  ← KPI strip
│  Próximos    Manual       Pós-venda    Campanhas    │
├─────────────────────────────────────────────────────┤
│  [Visão geral][Manual][Pós-venda]…                  │  ← tabs (iguais)
├─────────────────────────────────────────────────────┤
│  Próximos envios · 30    [Todos][Manual][Campanha]  │
│  ● 07 out 18:22 │ Áudio WhatsApp · Campanha  →      │
│  ● 07 out 18:22 │ Áudio WhatsApp · Campanha  →      │
│  …                                                  │
├─────────────────────────────────────────────────────┤
│  O que está ligado                                  │
│  ┌────────────┐ ┌────────────┐                      │
│  │ Manual   0 │ │ Pós-venda 0│                      │
│  └────────────┘ └────────────┘                      │
└─────────────────────────────────────────────────────┘
```

## Detalhes técnicos
- `index.html`: adicionar `<link>` para `Sora:wght@500;600;700` e `Manrope:wght@400;500;600;700`.
- `tailwind.config.ts`: `fontFamily.display = ["Sora", ...]`, `fontFamily.sans = ["Manrope", ...]`.
- `AgendamentosHub.tsx`: refatorar apenas o JSX dessas 5 áreas; nada de mudança de estado, hooks ou props. Chips de filtro adicionam um `useState<string>("all")` local que filtra `timeline` antes do `.slice(0, 30)`.
- Sem novos arquivos, sem novas dependências.

## Verificação
- Build passa (typecheck do Vite).
- Página `/admin` → aba Agendamentos abre sem quebrar.
- Todas as 8 sub-abas continuam navegáveis; contadores e ações preservados.
- Responsivo: 375px, 768px, 1280px.
