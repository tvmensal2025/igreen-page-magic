## Diagnóstico
Você tem razão — mapeei errado no plano anterior. O typecheck padrão do projeto (`tsc --noEmit`, sem strict) passa em 0, mas o CI roda o modo estrito e pega os 10 erros que você colou. Todos são pontuais e não afetam a lógica dos motores.

**Nenhum motor, edge function crítica, schema, RLS ou fluxo A/B/C será tocado.** As correções são só de tipagem e um import faltando.

## As 10 correções (arquivo por arquivo)

### 1. `src/components/admin/ReheatCyclePizza.tsx` — 1 erro
Import faltando. A função `isLegacyInteractiveCallScript` existe em `src/lib/cadencePreview.ts` mas nunca foi importada aqui.
**Ação:** adicionar `import { isLegacyInteractiveCallScript } from "@/lib/cadencePreview";`.

### 2. `src/components/admin/RetentionCard.tsx` — 2 erros (linhas 274, 589)
`sendRetentionViaInstance` retorna união discriminada `{ ok: true } | { ok: false; error: string }`. Sob strict, `!result.ok` não está estreitando de forma confiável nesse arquivo.
**Ação:** trocar `if (!result.ok)` por `if (result.ok !== true)` nos dois pontos. Preserva 100% do comportamento; só melhora o estreitamento.

### 3. `src/components/captacao/CaptureSheet.tsx` — 2 erros (linhas 510, 791)
`customer as Record<string, unknown>` falha porque `CaptureCustomer` não tem index signature.
**Ação:** trocar por `customer as unknown as Record<string, unknown> | null` nos dois pontos (cast em duas etapas, padrão TS quando tipos não se sobrepõem).

### 4. `src/components/captacao/CloseCaptureDialog.tsx` — 2 erros (linhas 475, 501)
Dentro do bloco `{sourceKind !== "organic" && ...}`, o TS estreita o tipo para `"partner" | "campaign"`, então `sourceKind === "organic"` fica sempre falso — mas o handler é o `onValueChange` do Select, que executa depois, quando o usuário pode ter voltado ao estado "organic". O código está correto; só a análise estática está errada.
**Ação:** `(sourceKind as string) === "organic"` nos dois `if`. Comportamento idêntico.

### 5. `src/lib/multichannelCadenceTexts.test.ts` — 2 erros (linhas 404, 405)
Falta importar `SOFIA_OPENING`.
**Ação:** adicionar `SOFIA_OPENING` à lista de imports de `./multichannelCadenceTexts`.

### 6. `supabase/functions/_shared/portal-worker.ts` — 1 erro (linha 126)
`deep.ok ? { ok: true, missing: [] } : { ok: false, missing: deep.missing }` — no ramo `false`, o TS não estreita porque foi só uma expressão ternária inline.
**Ação:** trocar por bloco explícito:
```ts
if (deep.ok) return { ok: true, missing: [] };
return { ok: false, missing: deep.missing };
```

## Validação
1. Após as edições, rodar `npx tsc --noEmit -p tsconfig.app.json --strict 2>&1 | grep -E "ReheatCyclePizza|RetentionCard|CaptureSheet|CloseCaptureDialog|multichannelCadenceTexts|portal-worker"` — meta: zero linhas dos 10 erros listados.
2. Rodar `npx tsc --noEmit` (config padrão do projeto) — meta: continuar em 0.
3. Não rodar `vitest` (ambiente do sandbox está com `canvas.node` quebrado; irrelevante para as correções).

## Sobre "listar todas as funções da plataforma"
Depois que o CI ficar verde, faço a Parte 2 que você pediu antes: análise ponta-a-ponta se cada função está funcional — Anúncio Meta → captura → rodízio → Pizza → Grupo A/B/C → Parceiro. Entrego em texto (sem mexer em código), com evidência de arquivo/linha e status ✅/⚠️/❌ por função. Isso não faz parte deste patch — evita misturar correção de CI com auditoria.

## Fora de escopo
Os outros ~15 erros de `--strict` que apareceram no meu check local (StepBudget, StepRegion, BotHealthDashboard, WhatsAppTab, TourProvider etc.) **não estão na lista que você colou do CI** — não vou tocar neles agora. Se o CI reclamar depois, aviso e faço em patch separado.
