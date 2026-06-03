# Bug: editar Fluxo A altera o Fluxo D

## Contexto das variantes

- **A** — fluxo roteirizado clássico (passo a passo, regras).
- **B** — IA livre (super prompt da `FluxoBEditor`), **não deve ser tocada nem usada para teste destrutivo**.
- **D** — fluxo padrão de provisionamento de novos consultores (seed da Camila).
- Variantes C/E — disponíveis para criação manual.  
CADA VARIANTE É UNICA E NAO ALTERA A OUTRA

## Causa raiz

Em `/admin/fluxos`, a função `reload` (`src/pages/FluxoBuilder.tsx` linhas 247-264) carrega o `flow_id` filtrando por `variant`. Quando o consultor não tem fluxo da variante **A** (ex.: Rafael, que nasceu em **D**), há um fallback:

```ts
if (!fid && variant === "A") {
  const { data } = await supabase.rpc("seed_default_camila_flow", ...);
  fid = data;
}
```

A função `seed_default_camila_flow` (migração `20260601030000`) reutiliza qualquer fluxo ativo, **ignorando a variante**:

```sql
SELECT id INTO v_flow_id FROM public.bot_flows
 WHERE consultant_id = _consultant_id AND is_active = true
 ORDER BY created_at ASC LIMIT 1;
```

Resultado: ao clicar em "Variante A", o builder recebe o `flow_id` da variante **D** existente. Toda edição em "A" grava nas linhas de `bot_flow_steps` do fluxo D. Daí "mexer no A altera o D".

Agravante na mesma `reload`:

```ts
const ex = new Set<Variant>(["A"]);  // força A na lista mesmo sem existir
```

Faz a barra de variantes mostrar "A" como se existisse, induzindo o clique que dispara o seed acima.

## Correções

### 1. Backend — `seed_default_camila_flow` (nova migration)

Tornar a função idempotente **por variante**:

- O `SELECT` inicial passa a filtrar `AND variant = 'D'`.
- Mantém o `INSERT` com `variant = 'D'` quando não houver fluxo D.
- Resultado: chamadas repetidas sempre devolvem o flow **D**; nunca devolvem o flow de outra variante (A, B livre, etc.).

### 2. Frontend — `src/pages/FluxoBuilder.tsx`

- **Remover o seed dentro do `if (!fid && variant === "A")**`. O seed só deve provisionar a variante D padrão, nunca fabricar A em cima de outro fluxo. Se a variante selecionada não tem fluxo, mostrar estado vazio com botão "Criar variante {X}".
- Trocar `const ex = new Set<Variant>(["A"]);` por `const ex = new Set<Variant>();` para que a barra liste **apenas** variantes que realmente existem em `bot_flows`.
- Após carregar `allFlows`, se a lista vier vazia (consultor totalmente sem fluxo), chamar `seed_default_camila_flow` **uma única vez** e recarregar — provisiona D.
- Ajustar `editingVariant` inicial: se A não existir, selecionar a primeira variante de `existingVariants` (ex.: D para Rafael) em vez de cair em A.

### 3. Proteção da variante B (IA livre)

- O fluxo B é gerenciado pela `FluxoBEditor` (super prompt), **não** pelo builder de passos. Garantir que o builder de passos:
  - Não chame `seed_default_camila_flow` quando `editingVariant === "B"`.
  - Não permita criar passos roteirizados em cima de B (já é o comportamento atual via `flowId` ausente, mas reconfirmar após a mudança do seed).
- Nenhuma migration toca em `ai_persona_fluxo_b` ou nos prompts de B.

### 4. Validação (sem mexer em B)

- Abrir `/admin/fluxos` com Rafael → barra mostra apenas **D** (e **B** se já existir como super prompt), nunca A fantasma.
- Editar um passo em D → recarregar → mudança permanece em D.
- Criar variante **C** via "Adicionar variante", editar um passo em C, voltar para D e confirmar que D continua intacta. Excluir C ao final. **Não tocar em B.**
- Consultor novo (sem nenhum fluxo) abre `/admin/fluxos` → seed roda → aparece variante **D** com os 6 passos padrão; A não é criada.

## Arquivos tocados

- `supabase/migrations/<novo>.sql` — redefine `seed_default_camila_flow` com filtro `variant = 'D'`.
- `src/pages/FluxoBuilder.tsx` — bloco `reload` (linhas ~247-265) e seleção inicial de `editingVariant`.

Nenhuma alteração em `bot_flow_steps` existentes, RLS, engine de runtime, ou em qualquer coisa da variante B (IA livre).