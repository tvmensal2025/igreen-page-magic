## Problema

No `FluxoBuilder` (`/admin/fluxos`) o header do Fluxo B mostra os botões **Persona** e **Conhecimento** (`FluxoBHeaderStats`). Hoje:

- **Conhecimento** → `navigate("/admin?tab=conhecimento")`. O initializer de `Admin.tsx` (linhas 81-91) **não reconhece** `conhecimento` nem `persona` na whitelist, então cai no fallback `return "dashboard"`. O usuário acaba no painel inicial.
- **Persona** → apenas chama `scrollIntoView` num elemento `[data-fluxo-b-editor]`. Fora do contexto certo, não faz nada visível — passa a sensação de "voltou pro dashboard".

`Conhecimento` é uma sub-aba dentro de `AIAgentTab` (aba WhatsApp do Admin). `Persona` mora no `AdminFluxoB` (`/admin/fluxo-b`) como aba padrão, e também no editor de passos do Fluxo B dentro do `FluxoBuilder`.

## O que vou fazer

### 1. `src/pages/Admin.tsx` — reconhecer `tab=conhecimento`
- Adicionar à whitelist do `useState` inicial: se `tab === "conhecimento" || "agente" || "atendimentos" || "decisoes" || "desempenho"`, retornar `"whatsapp"` (já mapeia hoje só `whatsapp|agente|historico`; ampliar para as sub-abas reais de `AIAgentTab`).
- Guardar a sub-aba pretendida em um `useState<string|null>` (`pendingAiSubTab`) lido do mesmo `URLSearchParams`, e limpar o `?tab=` da URL via `history.replaceState` (igual já é feito pro `phone`).
- Passar `initialSubTab={pendingAiSubTab}` para o componente `AIAgentTab`.

### 2. `src/components/admin/AIAgentTab/index.tsx` — aceitar sub-aba inicial
- Adicionar prop opcional `initialSubTab?: SubTab`.
- No `useState<SubTab>` inicial, usar `initialSubTab ?? "atendimentos"`.
- `useEffect` para atualizar quando a prop mudar (deep-link tardio).

### 3. `src/components/admin/flow-builder/FluxoBHeaderStats.tsx` — Persona deve abrir algo real
- Manter o callback `onEditPersona` (já scrolla para o editor inline quando há `[data-fluxo-b-editor]` na página).
- **Fallback de navegação**: se `onEditPersona` não estiver definido ou não houver alvo na página, navegar para `/admin/fluxo-b?tab=persona` (rota existente que já tem aba Persona como default).
- O botão Persona em `FluxoBuilder.tsx` continua scroll-into-view (comportamento atual ok ali); só garantir que o elemento de destino realmente exista — adicionar `data-fluxo-b-editor` no wrapper do `PersonaEditor` se estiver faltando.

### 4. `src/pages/AdminFluxoB.tsx` — respeitar `?tab=`
- Inicializar o `useState` do `tab` a partir de `URLSearchParams` (`persona|knowledge|simulator|consultor`), para que o deep-link de Persona funcione.

## Diagrama do fluxo após o fix

```text
[FluxoBuilder] --click Conhecimento--> /admin?tab=conhecimento
                                              |
                                  Admin lê tab → activeTab=whatsapp
                                  pendingAiSubTab="conhecimento"
                                              |
                                  AIAgentTab abre sub="conhecimento" ✅

[FluxoBuilder] --click Persona--> scrollIntoView(PersonaEditor) ✅
                                  (sem alvo) → /admin/fluxo-b?tab=persona ✅
```

## Fora do escopo
- Não vou mexer no conteúdo das telas de Conhecimento/Persona, só na navegação/renderização.
- Sem mudanças de design ou de backend.
