# Campo "Próximo passo" no Editor de Fluxo

## Problema
No drawer "Editar passo #N" → aba **Básico**, hoje não há um seletor explícito que mostre/configure o próximo passo da conversa. O usuário precisa abrir a aba **Regras** ou **Botões** para entender pra onde o bot vai. Quando o passo não tem botão nem regra, fica invisível que ele segue pelo `position` (sequência).

## Solução
Adicionar um seletor **"Próximo passo (padrão)"** no fim da aba Básico, logo após "Passo ativo", para todos os passos do tipo `message`, `capture_*` e `finalizar_cadastro`. O seletor controla o `fallback` do passo (que já existe no schema — `Fallback.mode = "goto" | "repeat"`), e o runtime já respeita esse fallback como destino padrão quando nenhuma regra/botão casa.

### Comportamento do seletor

Opções (Select):
- **➡ Seguir a ordem da lista (#N+1)** — `fallback = { mode: "repeat" }` + nenhum override; runtime cai no próximo `position` (comportamento atual default, agora explícito visualmente). Mostra hint: *"Vai para #6 Sem título"*.
- **Passo específico** — listagem de todos os passos ativos (`#3 Resultado`, `#5 Pedir documento…`), grava `fallback = { mode: "goto", goto_step_id: <id> }`.
- **🔁 Repetir este passo** — `fallback = { mode: "repeat" }` explícito (já existe).
- **👤 Encerrar / falar com humano** — grava transição default com `goto_special: "humano"`.

A escolha default exibida deve ser inferida do estado atual:
1. Se há `fallback.mode === "goto"` → mostra esse passo.
2. Se há transição com `trigger_intent === "default"` → mostra esse destino.
3. Caso contrário → "Seguir a ordem da lista".

### Garantia de ordem
O runtime (`whapi-webhook/handlers/bot-flow.ts` e `evolution-webhook/handlers/bot-flow.ts`) já segue `position` quando não há goto explícito (linha ~1034: `find((s) => s.position > current.position)`). **Nenhuma alteração de engine é necessária** — só estamos expondo no UI o que já existe.

Validação adicional em `useFlowValidation.ts`: se o passo tem `fallback.goto_step_id` apontando para passo removido/inativo, vira warning (já coberto pelo padrão atual de "destino removido").

## Arquivos a editar
- `src/components/admin/flow-builder/StepInspector.tsx` — adicionar bloco "Próximo passo" no `TabsContent value="basico"` após o card "Passo ativo" (linha ~240). Componente `<Select>` com as 4 opções acima, handler aplica `onPatch` em `fallback` + `transitions` conforme escolha.
- `src/components/admin/flow-builder/StepCard.tsx` — opcional: adicionar badge "→ #6" no card quando o fallback é explícito, para reforçar a ordem visual.

## Fora de escopo
- Não mexer no engine de runtime.
- Não alterar schema de banco (campo `fallback` já é jsonb e suporta `goto`).
- Não tocar nos templates de fluxo.
