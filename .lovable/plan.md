# Causa raiz da "confusão" entre passos iguais

Inspecionei o Fluxo D em produção e o motor de conversa. **Não há um único bug** — há quatro pontos onde dois passos com mesma palavra/título podem se atropelar. Os sintomas que você descreve ("seleciono outra rota, mas vai pra mesma", "passos somem ao editar") batem com isso.

## O que está acontecendo hoje

No Fluxo D já existem passos duplicados criados por "Duplicar":

| Posição | step_key                         | Tipo           |
| ------- | -------------------------------- | -------------- |
| 2       | `d_pedir_conta`                  | capture_conta  |
| 3       | `d_como_funciona`                | message        |
| 18      | `d_simular_pedir_conta`          | capture_conta  |
| 19      | `d_como_funciona_copy_in3s`      | message        |
| 20      | `d_como_funciona_copy_qwpu`      | message        |

Os três "Como Funciona" têm **gatilhos quase idênticos** ("2", "humano", "cadastrar"…). Os dois "Pedir Conta" também. Resultado:

1. **Editor sem aviso de conflito** — o título exibido é o mesmo ("Como funciona"), o usuário não consegue distinguir os três cards. Ao editar um, sente que "mexeu no outro".
2. **Runtime — `matchTransition` (`supabase/functions/_shared/flow-router.ts`)** — quando o input cai no fallback de texto (passo d), o primeiro `trigger_phrase` que for substring vence. "conta" casa dentro de "minha conta de luz" e dispara a primeira transition, mesmo que outra mais específica ("conta de luz 2") existisse.
3. **Runtime — `matchQA` (`supabase/functions/whapi-webhook/handlers/conversational/index.ts`)** — varre `bot_flow_qa_triggers` sem `ORDER BY`. Se duas perguntas têm o gatilho "como funciona", o Postgres devolve a que quiser; o `find()` pega a primeira.
4. **Edição via "Duplicar"** — gera `step_key` único (`_copy_xxx`) mas mantém o `title` original. Em listas longas o usuário não percebe que existem dois.

## O que será corrigido

### 1) Runtime determinístico (sem regressão funcional)

**`supabase/functions/_shared/flow-router.ts`** — em `matchTransition`:

- Pré-ordenar as `transitions` pelo tamanho da maior `trigger_phrase` (desc) e, dentro de cada transition, pelas phrases mais longas primeiro.
- Nos passos (a)/(b)/(d), preferir **igualdade exata** e **limite de palavra** antes do `includes` cego.
- Empate → escolher a transition com `goto_step_id` definido em vez de `goto_special` (mais específica).

Resultado: "conta de luz 2" sempre ganha de "conta"; "humano" sozinho não captura quando o texto é "falar com rafael".

**`supabase/functions/whapi-webhook/handlers/conversational/index.ts`** — em `matchQA`:

- Adicionar `ORDER BY created_at ASC` na query de `bot_flow_qa_triggers` (determinismo cross-deploy).
- Coletar **todos** os triggers que casam e escolher o de maior `phrase.length`. Empate → QA mais antigo (estável).

### 2) Editor com detecção de ambiguidade

**Novo `src/components/admin/flow-builder/useFlowConflicts.ts`** — hook que, dado o array `steps`, devolve:

- `duplicateTitles`: pares de steps com o mesmo `title` normalizado.
- `duplicateKeys`: pares cujo `step_key` casa após remover sufixos `_copy_*` / `_2`.
- `overlappingTriggers`: pares de steps cujas `trigger_phrases` se intersectam.

**`src/components/admin/flow-builder/StepTimelineItem.tsx`** — quando o step participa de algum conflito, mostrar badge laranja "⚠ conflito" com tooltip listando os outros steps envolvidos e botão "Renomear".

**`src/pages/FluxoBuilder.tsx`** — banner no topo da lista quando `useFlowConflicts` devolve algo: "N passos com possível ambiguidade — clique para revisar". Filtra a lista para mostrar só esses.

### 3) Duplicar passo gera título distinto

**`src/components/admin/flow-builder/useFlowStepsCrud.ts`** — ao duplicar:

- `title`: `"<original> (cópia)"` (e `" (cópia 2)"`, `" (cópia 3)"`, se já existir).
- Limpar `trigger_phrases` da cópia (deixar vazio) — o usuário precisa configurar gatilhos novos conscientemente, evitando o overlap automático.

### 4) Limpeza dos duplicados existentes do Fluxo D

Após aprovado o código acima, fazer um `UPDATE` em `bot_flow_steps` (via `supabase--insert`) para:

- Renomear `d_como_funciona_copy_in3s` → título "Como funciona (pós-simulação rápida)" e zerar suas `trigger_phrases` que duplicam o passo 3.
- Renomear `d_como_funciona_copy_qwpu` → título "Como funciona (pós-simulação completa)".
- Renomear `d_simular_pedir_conta` → título "Pedir conta de luz (refluxo simulação)".

Sem apagar nada: só rótulos e gatilhos. As rotas (`goto_step_id`) continuam.

## Detalhes técnicos

```text
matchTransition (ordem nova)
 ┌─ a) buttonId == phrase exata          (igual)
 ├─ b) buttonId == goto_special          (igual)
 ├─ c) intent match                      (igual)
 └─ d) text fallback
       │ phrases ordenadas por len desc
       │ se phrase tem 1 palavra: regex \b
       │ se phrase ≥ 2 palavras : includes
       └ desempate: goto_step_id > goto_special
```

```text
matchQA (ordem nova)
 SELECT ... ORDER BY created_at ASC
 reduce(triggers, melhor) onde
   melhor = trigger cuja phrase.length é maior
            (empate → menor created_at)
```

## Arquivos tocados

- `supabase/functions/_shared/flow-router.ts` — ordenação + word boundary.
- `supabase/functions/whapi-webhook/handlers/conversational/index.ts` — ordering em `matchQA` + escolha do mais longo.
- `supabase/functions/evolution-webhook/handlers/conversational/index.ts` — mesmo ajuste em `matchQA` se houver cópia paralela (vou confirmar e replicar).
- `src/components/admin/flow-builder/useFlowConflicts.ts` *(novo)*.
- `src/components/admin/flow-builder/StepTimelineItem.tsx` — badge + tooltip.
- `src/components/admin/flow-builder/useFlowStepsCrud.ts` — duplicar com título distinto e phrases vazias.
- `src/pages/FluxoBuilder.tsx` — banner de conflitos.
- Testes co-localizados: `flow-router_test.ts` (novos casos de longest-match) e `matchQA_test.ts` (caso de dois triggers iguais).
- Migration de dados: renomear os 3 steps duplicados no Fluxo D público.

## Fora deste plano

- Não mexer no Fluxo D atual nem em qualquer `goto_step_id` (sua estrutura está correta).
- Não bloquear o usuário de criar passos duplicados — só avisar e renomear por padrão.
- Não trocar o engine (continua determinístico, sem IA decidindo rota).
