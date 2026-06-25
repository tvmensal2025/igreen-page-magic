## Objetivo

Garantir que o aviso de ambiguidade nunca volte a aparecer por engano e que, se algum dia voltar, seja por motivo real e fácil de corrigir com 1 clique.

## Estado atual (verificado)

- Banco: os 7 fluxos D não têm título duplicado nem mesma frase com destinos diferentes no mesmo passo. Zero conflitos reais.
- Código: `useFlowConflicts.ts` já só reporta os dois casos que realmente quebram o bot.
- O aviso antigo ("identificador parecido", "compartilham palavra") não existe mais no código.

Então o trabalho agora é **blindagem** — não correção de bug.

## O que vou fazer

### 1. Botão "Re-analisar" no banner de conflitos
No `FluxoBuilder.tsx`, ao lado do botão "Revisar", adicionar um botão `Re-analisar` que força recomputar e mostra um toast com o resultado ("Nenhuma ambiguidade encontrada" ou "X conflitos reais detectados"). Útil para o super admin confirmar que a tela está atualizada e não em cache.

### 2. Estado explícito "sem conflitos"
Quando `flowConflicts.involvedCount === 0`, mostrar um indicador discreto e verde no topo da lista de passos: `Sem ambiguidades neste fluxo`. Some sozinho depois de alguns segundos. Assim o super admin tem certeza visual de que o fluxo está limpo (hoje a ausência do banner amarelo pode parecer "será que não analisou?").

### 3. Validação automática ao salvar passo
No `useFlowStepsCrud.ts`, depois de cada salvar/duplicar/criar passo, rodar o detector. Se introduzir conflito real (mesma frase no mesmo passo apontando pra destinos diferentes, ou dois títulos 100% idênticos), exibir toast de aviso com o nome do conflito e link para o passo afetado. Não bloqueia o salvar — só avisa.

### 4. Teste cobrindo os casos pedidos
Adicionar `useFlowConflicts.test.ts` com:
- 3 passos com step_key parecido (`d_como_funciona`, `d_como_funciona_copy_in3s`, `d_como_funciona_copy_qwpu`) → **0 conflitos** (step_key parecido não é conflito).
- 2 passos com palavra "como funciona" em transições de passos diferentes → **0 conflitos**.
- 2 passos com título exatamente igual → **1 conflito** (`duplicateTitle`).
- 1 passo com mesma frase em duas transitions com destinos diferentes → **1 conflito** (`sameStepPhrase`).

### 5. Cache-bust suave
Adicionar `key={flowId}` no contêiner do banner para garantir que ao trocar de fluxo o estado seja descartado e recalculado do zero, evitando qualquer chance de "ficou preso" entre fluxos.

## Detalhes técnicos

- `useFlowConflicts.ts`: sem mudança de lógica (já está correto). Exportar uma função pura `detectConflicts(steps)` reutilizável pelo hook, pelo crud e pelo teste.
- `FluxoBuilder.tsx`: adicionar botão "Re-analisar" + toast; mostrar indicador verde quando `involvedCount===0`.
- `useFlowStepsCrud.ts`: chamar `detectConflicts` após cada mutação e emitir toast quando o `count` aumentar.
- Novo arquivo: `src/components/admin/flow-builder/__tests__/useFlowConflicts.test.ts`.

## Fora de escopo

- Não vou tocar no runtime (`flow-router.ts`, `state-machine.ts`) — já está determinístico com longest-match e os dados estão limpos.
- Não vou criar/remover passos no banco — nada precisa ser apagado, todos os passos D continuam ativos.
- Não vou mudar permissão de super admin — já edita direto o fluxo público.
