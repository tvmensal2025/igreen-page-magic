## Problemas identificados

**1. Passo 1 dispara o Passo 2 (e segue) automaticamente — `manual-step-send`**

No `CaptureStepsList` (usado dentro da ficha de captação), o handler de envio passa `continueFlow !== false` → na prática manda `continueFlow: true` quando o consultor clica no avião do Passo 1:

```ts
// src/components/captacao/CaptureStepsList.tsx:335
onSend={(opts) => confirmStep && doSend(..., opts?.continueFlow !== false)}
```

Com `continueFlow=true`, a edge `manual-step-send` entra em `buildContinuationPatch` e tenta encadear até achar uma "pergunta" para parar. A regra usada é:

```ts
// supabase/functions/manual-step-send/index.ts:1088-1090
const _normEnd = (s) => String(s?.message_text || "").trim().replace(/[\s\u200B-\u200D\uFEFF]+$/g, "");
const _looksLikeQuestion = (s) => _normEnd(s).endsWith("?");
```

Mas o Passo 1 termina com `Como posso te chamar? 😊` — o emoji no fim faz `endsWith("?")` retornar **false**, o chain não para, e o bot manda o Passo 2 (`Prazer, **! 🙌 ... valor médio...`) junto. Por isso o card mostrou "PASSOS · 2/10 ENVIADOS" e o nome saiu como `**` (variável `{{nome}}` vazia, porque o lead ainda não tinha nome).

**2. Lista "Em captação" fora de ordem cronológica**

`CaptureLeadList` ordena por `capture_started_at desc nullslast`. Quando o consultor reabre/reentra captação de um lead antigo, esse `capture_started_at` é atualizado e o lead salta pro topo, fazendo parecer que está fora de ordem em relação aos cadastros recentes. Você confirmou que quer **mais recente primeiro por `created_at`**.

---

## Plano

### Fix 1 — Não encadear automaticamente no clique do Passo (frontend)

Em `src/components/captacao/CaptureStepsList.tsx:335`, trocar o default do `continueFlow` para **false** quando o consultor clica no avião de um passo individual:

```ts
onSend={(opts) => confirmStep && doSend(confirmStep.row, confirmStep.group.step_key, opts?.continueFlow === true)}
```

Assim só encadeia se o componente de confirmação pedir explicitamente (`Enviar e continuar fluxo`). Clique simples no Passo 1 → manda só o Passo 1.

### Fix 2 — Detector de pergunta robusto a emoji/pontuação (defesa em profundidade, edge)

Em `supabase/functions/manual-step-send/index.ts:1088-1090`, ajustar `_normEnd` para remover emojis, espaços e pontuação decorativa antes de checar `endsWith("?")`. Assim, mesmo se algum outro caminho usar `continueFlow=true`, "Como posso te chamar? 😊" é reconhecido como pergunta e o chain para.

```ts
const _stripTrailingDecor = (s: string) =>
  s.replace(/[\s\u200B-\u200D\uFEFF\p{Extended_Pictographic}\p{Emoji_Component}]+$/gu, "");
const _normEnd = (s: any) => _stripTrailingDecor(String(s?.message_text || "").trim());
const _looksLikeQuestion = (s: any) => _normEnd(s).endsWith("?");
```

### Fix 3 — Ordenar lista por `created_at` desc (mais recente primeiro)

Em `src/components/captacao/CaptureLeadList.tsx:38`, trocar:

```ts
.order("capture_started_at", { ascending: false, nullsFirst: false })
```

por:

```ts
.order("created_at", { ascending: false })
```

E no display (`fmtTime`, linha 127), priorizar `created_at` em vez de `capture_started_at` para o tempo exibido bater com a ordem da lista.

---

## Validação

1. Abrir captação com um lead novo, clicar no avião do **Passo 1** → conferir que **apenas** a mensagem do Passo 1 chegou no WhatsApp (badge "1/10 ENVIADOS", não "2/10").
2. Recarregar a aba Captação → o lead mais recém-criado aparece no topo da lista.
3. Rodar `npx vitest run` para garantir que nada relacionado a flow-selector quebrou.

## Arquivos afetados

- `src/components/captacao/CaptureStepsList.tsx` (1 linha)
- `src/components/captacao/CaptureLeadList.tsx` (2 linhas)
- `supabase/functions/manual-step-send/index.ts` (3 linhas)