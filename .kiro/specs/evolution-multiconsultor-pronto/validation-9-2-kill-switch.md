# Validação 9.2 — Kill switch off → zero outbound no Evolution

_Requirements: 1.1, 1.2_

## Conclusão

Confirmado: com `bot_global_enabled=false`, o `evolution-webhook` retorna sucesso
neutro (`{ ok: true, msg: "bot_globally_disabled" }`, HTTP 200) e produz **zero**
envios outbound; com `true`, segue o fluxo normal. Fail-open preservado (erro de
leitura / linha ausente → habilitado).

## Fiação confirmada no handler

`supabase/functions/evolution-webhook/index.ts` (~linha 87), dentro de `Deno.serve`:

- A guarda roda **após** criar o client `service_role` (`createClient`) e **antes**
  de `await req.json()` (~linha 94) e **antes** da guarda por-consultor
  `isConsultantAIDisabled` — ou seja, antes de qualquer parsing/efeito/outbound.
- `if (!(await isBotGloballyEnabled(supabase as any))) { return 200 { ok: true,
  msg: "bot_globally_disabled" } }` com `corsHeaders` → early-return, zero outbound.
- `isBotGloballyEnabled` (`_shared/bot/global-flag.ts`) é fail-open (try/catch →
  `true`; linha ausente → `true`), espelhando o `whapi-webhook`.

## O que é pure-logic vs. full-handler (honestidade de escopo)

- **Pure-logic (Property 1):** `_shared/bot/kill-switch-gate.ts` isola a decisão
  de gating; coberto por `src/test/evolution-kill-switch-gate.property.test.ts`
  (fast-check, ≥200 iterações).
- **Smoke estático:** `src/test/evolution-kill-switch-guard.test.ts` confirma a
  presença/posição literal da guarda no fonte e a paridade com o `whapi-webhook`.
- **Integração-leve (esta task):** `src/test/evolution-kill-switch-e2e.test.ts`
  exercita o **helper real** `isBotGloballyEnabled` (o mesmo invocado pelo handler)
  contra um client Supabase mockado, replicando a guarda do handler ao redor de um
  **sender outbound mockado** → afirma 0 envios quando desabilitado, shape neutro
  200, e fluxo normal (1 envio) quando habilitado / fail-open.
- **Não coberto aqui:** não há subida da edge function Deno completa (sem servidor
  HTTP real / sem provedor Evolution real). A validação dual-channel end-to-end
  contra uma instância Evolution de teste e o baseline A/B/D do Whapi do Rafael
  permanece como passo manual gated por aprovação humana (tarefas 1.4 / 9.5).

## Comando e resultado

```
npx vitest run \
  src/test/evolution-kill-switch-e2e.test.ts \
  src/test/evolution-kill-switch-gate.property.test.ts \
  src/test/evolution-kill-switch-guard.test.ts
```

Resultado: **3 arquivos, 18 testes, todos passando** (Property 1 + exemplo/smoke +
integração-leve 9.2).
