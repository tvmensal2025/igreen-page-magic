
# Recriação do Painel de Fluxos (`/admin/fluxos`)

## Diagnóstico do que está ruim hoje
- `FlowDiagram.tsx` tem **2.250 linhas** num único arquivo — virou monolito difícil de evoluir, nós não expandem inline, zoom/pan engasga.
- `StepInspector.tsx` (705 linhas) mistura Básico/Mídias/Botões/Regras/Avançado num drawer estreito — regras e botões ficam escondidos em abas.
- IA (`flow-step-suggest`) existe mas só aparece como botão isolado em `StepSuggestions.tsx`. Sem copiloto, sem inline, sem auto-fix.
- Conexões entre passos não são editáveis arrastando — só via select no inspector.

## Visão da nova UX

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Header: nome fluxo | toggle ativo | warnings | [✨ IA Copiloto] [+] │
├──────────────┬──────────────────────────────────────┬───────────────┤
│              │                                      │               │
│  Mini-mapa   │         CANVAS React Flow            │  Inspector    │
│  + Lista     │  (zoom/pan/auto-layout/expand)       │  do passo     │
│  filtro      │                                      │  selecionado  │
│  passos      │  • Nós expansíveis (colapsado vs    │               │
│  (220px)     │    expandido com preview + botões)   │  Tabs claras: │
│              │  • Arrastar handle → cria regra      │  Conteúdo     │
│              │  • Edge clicável edita transição     │  Regras+IA    │
│              │  • Atalho ✨ em cada nó              │  Mídia        │
│              │                                      │  Avançado     │
│              │                                      │  (480px)      │
└──────────────┴──────────────────────────────────────┴───────────────┘
                                                       Painel IA flutuante
                                                       (drawer direita,
                                                        sobrepõe inspector)
```

## Escopo da reconstrução

### 1. Canvas (React Flow v12 já instalado)
- **Quebrar `FlowDiagram.tsx`** em módulos por responsabilidade: `useFlowGraph` (estado nodes/edges), `useAutoLayout` (dagre/elk), `useNodeInteractions` (drag/connect/expand), `CanvasShell` (Provider + Controls + MiniMap + Background).
- **Nó expansível**: dois modos — *colapsado* (título + tipo + badges) e *expandido* (preview da mensagem + botões + regras inline + ✨). Toggle por clique no header.
- **Auto-layout** com `dagre`: botão "Organizar" no toolbar + ao adicionar passo. Vertical top-down por `position`.
- **Conectar arrastando**: handle inferior do nó → handle superior de outro nó cria transition (`trigger_intent: "default"` ou pergunta intent).
- **Editar edge**: clique na seta abre popover compacto (intent, condição, label) — já existe `TransitionPopover`, integrar melhor.
- **Controls customizados**: zoom in/out, fit-view, organizar, exportar PNG, toggle mini-mapa.
- **Performance**: virtualizar nós fora do viewport via React Flow nativo (`onlyRenderVisibleElements`).

### 2. Inspector lateral (reorganizado)
Reduzir abas de 5 para **4 com hierarquia mais clara**:
- **Conteúdo** — mensagem, tipo de passo, capture target, próximo passo (já adicionado).
- **Regras + Botões** — unificado: botão presets no topo (✅/❌/📸/👤) cria botão + regra atômica; lista de regras abaixo com edição inline; cada regra tem ✨ "sugerir resposta da IA".
- **Mídia** — reusa `StepMediaPanel`.
- **Avançado** — fallback, delay, condições, captures custom, JSON raw.

Drawer aumenta para **480px** (hoje aperta tudo num sheet padrão), com toggle "expandir tela cheia" para edição pesada.

### 3. IA integrada (3 superfícies)
- **Inline ✨ em campos** (Textarea de mensagem, título de botão, label de regra): popover com "reescrever / encurtar / mais formal / traduzir / gerar do zero". Edge function nova: `flow-ai-rewrite` chamando Lovable AI Gateway (`google/gemini-3-flash-preview`).
- **✨ por nó no canvas**: usa `flow-step-suggest` existente (já retorna 3 próximos passos). Botão flutuante no canto do nó expandido.
- **Copiloto lateral** (novo drawer à direita, toggle no header): chat com contexto do fluxo inteiro. Capaz de:
  - "Onde tem regra quebrada?" → lista warnings com botão "corrigir".
  - "Adiciona um passo de objeção depois do #5" → propõe diff (criar passo + regra) com preview antes de aplicar.
  - "Resume o que esse fluxo faz" → walkthrough textual.
  - Edge function nova: `flow-copilot` (streaming SSE, tool-calling pra `create_step`, `update_step`, `add_rule`, `fix_warning`).

### 4. Não muda
- Schema do banco (`bot_flow_steps`, `transitions`, `captures`, `fallback`).
- Runtime (`whapi-webhook`, `evolution-webhook`) — segue lendo o mesmo JSON.
- `WhatsAppPreview`, `FlowSimulator`, templates.
- Legacy `/admin/fluxos-legado` continua disponível pra rollback.

## Plano de execução (4 PRs sequenciais)

### PR 1 — Canvas novo
- Criar `src/components/admin/flow-builder/diagram-v2/` com `useFlowGraph.ts`, `useAutoLayout.ts`, `CanvasShell.tsx`, `ExpandableNode.tsx`, `EditableEdge.tsx`, `CanvasToolbar.tsx`.
- Instalar `dagre` (`bun add dagre @types/dagre`).
- Feature flag: toggle "Diagrama v2" no header do `FluxoBuilder` que troca `FlowDiagram` → `FlowDiagramV2`.
- Manter `FlowDiagram.tsx` legado intacto.

### PR 2 — Inspector reorganizado
- Refatorar `StepInspector.tsx` em sub-componentes por aba (`tabs/ContentTab.tsx`, `tabs/RulesButtonsTab.tsx`, `tabs/MediaTab.tsx`, `tabs/AdvancedTab.tsx`).
- Aumentar largura do Sheet para 480px com modo fullscreen.
- Unificar regras+botões com presets no topo.

### PR 3 — IA copiloto
- Edge function `flow-ai-rewrite` (inline ✨).
- Edge function `flow-copilot` (chat streaming + tool-calling).
- Componente `<AiCopilotDrawer />` no `FluxoBuilder`.
- Componente `<InlineAiButton />` reusável em todos os Textarea/Input do inspector.
- Botão ✨ flutuante no `ExpandableNode` (canvas).

### PR 4 — Polimento e remoção do legado
- Validar com fluxos reais (Fluxo D, Fluxo Camila).
- Promover Diagrama v2 como default; remover flag.
- Arquivar `FlowDiagram.tsx` antigo.
- Atualizar `mem/features/flow-editor-redesign.md`.

## Detalhes técnicos

**Stack adicionada:**
- `dagre` (auto-layout grafo).
- Nada de novo pesado — React Flow v12 já está no projeto.

**Edge functions novas:**
- `supabase/functions/flow-ai-rewrite/index.ts` — POST `{text, action: "rewrite"|"shorten"|"formal"|"generate", context?}` → texto reescrito.
- `supabase/functions/flow-copilot/index.ts` — SSE streaming, recebe `{flowId, messages, userId}`, tem tools `propose_step`, `propose_rule_fix`, `explain_flow`. Aplicação de mudanças passa por confirmação visual no drawer (diff preview), nunca escreve direto.

**Compatibilidade:** todas as escritas seguem o schema atual (`bot_flow_steps`, `transitions` jsonb, etc.). Nenhuma migração de banco necessária.

**Fora de escopo:**
- Mudar engine de runtime.
- Mudar schema do banco.
- Reescrever templates de fluxo.
- Mexer no `FlowSimulator`.
