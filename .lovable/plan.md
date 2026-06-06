# Corrigir aba "Conversão" — render dentro do shell do Admin + legibilidade

## Problema observado
1. **Sai do painel**: ao clicar em "Conversão" no menu lateral, o app navega para `/admin/conversao` (página `AdminConversao` standalone, com `AppHeader` próprio e sem `AppSidebar`). Todas as outras abas (CRM, Clientes, Captação, etc.) renderizam dentro do mesmo shell `Admin.tsx` via `setActiveTab(...)` mantendo a sidebar, header e largura padrão.
2. **Muito escura**: no card hero "X leads aguardando classificação", o texto está com `text-black` sobre fundo gradiente âmbar translúcido em tema dark — fica praticamente invisível. Outros pontos do AdminConversao usam paleta consistente, só esse bloco está fora do padrão.

## O que vou fazer

### 1. Transformar `AdminConversao` em um componente de aba reaproveitável
- Criar `src/components/admin/ConversaoTab.tsx` exportando `ConversaoTab` com **todo o conteúdo atual** de `AdminConversao` **a partir do `<div className="container ...">`** (ou seja, sem `AppHeader`, sem `min-h-screen`, sem o botão "Voltar" — esses elementos passam a ser fornecidos pelo shell do Admin igual às demais abas).
- Manter o uso de `useSearchParams` para o filtro `?partner=` (continua funcionando dentro do Admin pois o Admin já vive em rota com query string).
- Manter `Sheet` de detalhes do lead, classificadores, KPIs etc. — só remover o wrapper de página.

### 2. Plugar a aba no shell `Admin.tsx`
- Em `src/pages/Admin.tsx`:
  - Importar `ConversaoTab` via `lazy`.
  - Adicionar o bloco `{userId && activeTab === "conversao" && <ConversaoTab consultantId={userId} />}` junto às outras abas (~linha 355).
  - `TAB_META.conversao` já existe (linha 216), nada a fazer ali.

### 3. Remover a navegação que tirava o usuário do shell
- Em `src/components/layout/AppSidebar.tsx` linha 50: remover `href: "/admin/conversao"` do item `conversao`. Sem `href`, o `handleItemClick` cai no `onTabChange("conversao")` — mesmo comportamento das outras abas.
- Em `src/components/admin/parceiros/PartnerQuickCard.tsx`: trocar `navigate("/admin/conversao?partner=...")` por algo que ative a aba interna. Como esse card vive dentro do Admin, vou disparar `navigate("/admin?tab=conversao&partner=...")` (o `Admin.tsx` já lê `tab` da URL na inicialização — linhas 72-79; vou estender o whitelist para incluir `"conversao"`).
- Manter a rota `/admin/conversao` em `App.tsx` apontando para `AdminConversao` como fallback (deep-link continua funcionando para quem tiver link antigo) — `AdminConversao.tsx` vira um wrapper fininho que apenas renderiza `<ConversaoTab>` dentro de um shell mínimo, ou redireciona para `/admin?tab=conversao`. Prefiro **redirect** para garantir consistência visual.

### 4. Corrigir contraste do card hero "aguardando classificação"
- Em `ConversaoTab.tsx` (linhas ~336-340 do original): trocar `text-black` por `text-foreground` no título e por `text-muted-foreground` no subtítulo, mantendo o gradiente âmbar de fundo. Fica legível em dark e light.

## Arquivos alterados
- **novo**: `src/components/admin/ConversaoTab.tsx` (extrai conteúdo)
- **edit**: `src/pages/AdminConversao.tsx` (vira redirect → `/admin?tab=conversao`, preservando query `partner`)
- **edit**: `src/pages/Admin.tsx` (lazy import + render da aba + aceitar `tab=conversao` no init)
- **edit**: `src/components/layout/AppSidebar.tsx` (remover `href`)
- **edit**: `src/components/admin/parceiros/PartnerQuickCard.tsx` (rota nova)

## Fora de escopo
- Lógica de classificação por IA, edge functions, RLS, mensagens — nada disso muda.
- Outras abas, worker-igreen-sync, edge functions de webhook.
