# Plano — Reorganizar Clientes iGreen com sidebar

Manter **tokens/cores atuais da plataforma** (nada de nova paleta, nada de dark novo) e **fontes atuais**. A mudança é só de estrutura: sair do "empilhão" vertical atual e dar uma navegação lateral entre seções.

Sem botões duplicados no header: **remover "Abrir CRM Pós-Venda"** (já existe em Admin) e **remover "Sincronizar agora"** deste card (já existe no Início / topo do admin). O sync continua acontecendo em background quando disparado dos outros locais — este painel só consome os dados.

## Novo layout — sidebar de seções

Dentro do card "Carteira iGreen" da aba Clientes iGreen (`WhatsAppClientsPage.tsx`), substituir o empilhamento por um shell de duas colunas:

```text
┌──────────── Carteira iGreen ─────────────────────────────────────┐
│ [aside 200px]  │ [conteúdo da seção ativa]                       │
│ • Resumo       │                                                 │
│ • Financeiro   │   Só a seção selecionada renderiza aqui,        │
│ • Produtos     │   com título e subtítulo próprios.              │
│ • Rede         │                                                 │
│ • Diagnóstico  │                                                 │
└──────────────────────────────────────────────────────────────────┘
```

- Sidebar em `aside` fixa à esquerda, largura `w-56`, colapsável para `w-14` (só ícones) em telas `< md`.
- Estado da seção ativa em `useState` + `?sec=` na URL (para deep-link).
- Item ativo usa tokens semânticos (`bg-accent text-accent-foreground` + `border-l-2 border-primary`).
- Contadores discretos ao lado do rótulo (ex: "Financeiro · 21", "Produtos · 14"), badge outline padrão.
- Header do card mantém só título + subtítulo + indicador "Última sync: …" — nenhum botão de ação.

## Seções e conteúdo

1. **Resumo** — `ConsultantMetricsCard` + `StatusCards` + `PaymentIntent` + banner de "N clientes sincronizados".
2. **Financeiro** — `BoletosList` (col-span-3) + `DevolutivasList` (col-span-2). Empty-state próprio quando 0.
3. **Produtos** — grid 2 col: `TelecomClientesList` + `SegurosClientesList`.
4. **Rede** — `RedeDashboardCard` + `RotinasPanel`.
5. **Diagnóstico** — `EndpointDiscoveryCard` (recolhido, para uso pontual).

O bloco de progresso do sync (chips de passos) permanece na `CarteiraGreenPanel` — aparece automaticamente enquanto uma sincronização estiver rodando em background (state `syncing` detectado por polling do `synced_at`), mas sem o botão para dispará-lo daqui.

## Padronização visual (sem mudar paleta)

- Todos os sub-cards herdam `border-border/60 bg-card` (tokens do tema), removendo variações locais `bg-emerald-500/[0.03]` inseridas antes. Cabeçalho de cada sub-card: ícone lucide em `text-muted-foreground`, título `text-sm font-semibold`, badge de contagem `variant="outline"`.
- Divisor entre "linhas" de conteúdo dentro da seção: `border-border/40`.
- Espaçamento uniforme: `space-y-6` dentro da seção; `gap-6` nos grids.
- Nenhum gradiente novo. Nenhuma cor hardcoded (`text-emerald-*`, `text-amber-*` só onde já representam status semântico).

## Arquivos alterados

- `src/features/produtos/carteira-green/CarteiraGreenPanel.tsx` — reescrita do JSX para o layout com sidebar; extrai um `<SectionNav />` e renderiza só a seção ativa. Remove `handleSync` UI (mantém o efeito de polling que atualiza a lista quando o `synced_at` avança).
- `src/features/produtos/carteira-green/TelecomClientesList.tsx`, `SegurosClientesList.tsx` — reverter o esquema emerald aplicado antes; voltar aos tokens da plataforma. Manter a lógica de busca/contagem corrigida.
- `src/pages/WhatsAppClientsPage.tsx` — remover o gradiente emerald do wrapper e o botão "Abrir CRM Pós-Venda" adicionado antes; usar `premium-card` padrão sem botões no header.

## Não faz parte

- Não instalar novas fontes (usuário pediu "igual às outras páginas").
- Não alterar o `SidebarProvider` global do admin. O sidebar do painel é local.
- Não mexer em rotas, hooks, queries ou lógica de sync.
- Nenhuma outra aba da página é redesenhada.
