## Causa do flicker

A prévia de etapa em **Captação** (`CaptureStepPreview`) é um Dialog cuja `useEffect` depende do prop `step` inteiro:

```ts
useEffect(() => { ...setLoading(true); fetchCustomer+Medias...; setLoading(false) }, [open, step, customerId, consultantId]);
```

Os dois pais passam **um objeto novo a cada render**, então toda re-renderização do pai (e há várias por segundo via realtime/timers da listagem de captação) invalida a dependência e dispara de novo o `setLoading(true)` → fetch → `setLoading(false)`. Isso é exatamente o ciclo "mensagem aparece → Carregando… → mensagem aparece" que aparece no replay.

- `src/components/captacao/CaptureStepsList.tsx:331` → `step={confirmStep ? { ...confirmStep.row } : null}` (spread cria novo objeto).
- `src/components/captacao/CaptureStepsGrid.tsx:288` → `step={{ id, title, step_key, message_text, media_order, variant }}` (literal inline).

## Correção (mínima, só presentation)

### 1. `src/components/captacao/CaptureStepPreview.tsx`
Trocar a dependência do efeito de `step` (objeto) para chaves estáveis. Assim, mesmo que o pai recrie o objeto a cada render, só recarrega quando algo realmente muda:

```ts
}, [open, step?.id, step?.variant, step?.message_text, customerId, consultantId]);
```

E não chamar `setLoading(true)` quando os dados já vieram para o mesmo `step.id` (guarda com `useRef` do último id carregado, para o caso de o pai trocar `customerId` sem trocar passo).

### 2. `src/components/captacao/CaptureStepsList.tsx`
Memoizar o objeto passado para o preview, sem `...spread`:

```tsx
const previewStep = useMemo(() => confirmStep?.row ?? null, [confirmStep?.row]);
const previewVariants = useMemo(() => confirmStep?.group.variants, [confirmStep?.group]);
...
<CaptureStepPreview step={previewStep} variants={previewVariants} ... />
```

### 3. `src/components/captacao/CaptureStepsGrid.tsx`
Mesmo tratamento — `useMemo` para o objeto montado a partir de `previewStep + variant`, dependências `[previewStep?.id, previewStep?.message_text, previewStep?.media_order, variant]`. Sem isso o literal `{{...}}` continua sendo identidade nova a cada render do grid.

## Validação

- `bun run typecheck`
- Abrir `/admin` → aba Captação → clicar para enviar uma etapa de um lead: o popup abre uma vez, carrega uma vez, e não pode mais alternar entre conteúdo e "Carregando…" enquanto o pai re-renderiza.
- Conferir que mudar de variante A/B/C dentro do mesmo passo continua disparando o reload (porque `step.variant` muda) — comportamento correto.

Nenhuma mudança em lógica de envio, fluxo do bot ou regras de negócio. Só estabilização de props/dependências.