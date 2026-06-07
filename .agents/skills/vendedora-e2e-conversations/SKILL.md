---
name: vendedora-e2e-conversations
description: Roda 20 conversas simuladas (10 scripts determinísticos + 10 personas LLM) do "oi" até portal_submitting/handoff contra a vendedora Fluxo B V2 via edge function fluxo-b-ai em dryRun, e gera transcrições .md + REPORT.md com diagnóstico (loops, repetições, foto pedida cedo, latência). Usar antes/depois de mexer em supabase/functions/_shared/vendedora/, fluxo-b-ai, templates, state-machine, extractors ou orchestrator para validar comportamento end-to-end sem persistir no banco.
---

# vendedora-e2e-conversations

Simulador end-to-end da Vendedora V2 do Fluxo B. Não persiste nada (`dryRun: true`).

## Quando usar

- Acabei de mexer em `vendedora/orchestrator.ts`, `templates.ts`, `state-machine.ts`, `extractors.ts`, `critico.ts` ou `closer.ts`.
- Acabei de mudar `fluxo-b-ai.ts` ou a edge function `fluxo-b-ai/index.ts`.
- Quero ver como a IA se comporta com leads "reais" sem mandar WhatsApp.
- O usuário pediu "rode 20 conversas", "simula uns leads", "testa a vendedora end-to-end".

## Como invocar

```bash
code--copy knowledge://skill/vendedora-e2e-conversations/scripts/run.ts /tmp/run.ts
bun /tmp/run.ts                              # 20 conversas, default
bun /tmp/run.ts --only scripted              # só os 10 roteiros fixos (rápido, ~6 min)
bun /tmp/run.ts --only persona --max-turns 15
bun /tmp/run.ts --consultant-id <uuid> --out /mnt/documents/vendedora-runs/teste-X
```

Args (todos opcionais):

| flag | default | descrição |
|------|---------|-----------|
| `--consultant-id` | `81fe673d-253e-46bc-993a-85c286ae54b5` | consultor com `ai_persona_fluxo_b` preenchida |
| `--out` | `/mnt/documents/vendedora-runs/<timestamp>/` | diretório de saída |
| `--only` | `all` | `scripted` \| `persona` \| `all` |
| `--max-turns` | `25` | corta a conversa se passar disso |
| `--concurrency` | `3` | quantas conversas rodam em paralelo |

## Pré-requisitos (já no sandbox)

- `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` no env (lidos do `.env`).
- `LOVABLE_API_KEY` no env (auto-provisionado) — usado pelos personas LLM.
- `bun` disponível.

## Saída

```
/mnt/documents/vendedora-runs/<ts>/
├── REPORT.md                 # tabela + diagnóstico agregado
├── conv-01-happy-path.md     # uma por conversa
├── conv-02-cetico-golpe.md
└── ...
```

Cada `conv-NN.md` tem a transcrição como markdown + um `<details>` com o JSON
completo dos turnos (etapa antes/depois, modelo usado, latência, state após).

`REPORT.md` resume:
- Tabela: id, perfil, turnos, etapa final, handoff?, latência total, modelos.
- Contagem de problemas: loops, repetições, foto pedida antes de `interesse_confirmado`, HTTP errors.
- Top 5 turnos com maior latência.
- Conversas que **não** chegaram a `portal_submitting`.

## Detalhes

- 10 roteiros determinísticos: ver `references/scripted-scenarios.md`.
- 10 personas LLM (Gemini 3 Flash via `https://ai.gateway.lovable.dev`): ver `references/personas.md`.
- Estado entre turnos: a edge `fluxo-b-ai` em dryRun aceita `customerState` + `history` no body (não persiste). O script lê o `dryRunLog` retornado, mescla updates de `customers.*` no próximo `customerState`, e mantém `history` localmente.
- Critério de fim: `conversationStepUpdate === "portal_submitting"`, `shouldHandoff === true`, ou `turn >= max-turns`.

## Limitações

- Não testa nudge (continua no caminho legacy).
- Não persiste — não confere triggers, RLS, ou efeitos colaterais no banco.
- Latência inclui round-trip HTTP, então não compara 1:1 com produção (whapi-webhook).
- Personas LLM são estocásticos — re-run pode mudar duração da conversa.

## Quando NÃO usar

- Bug específico já reproduzido com 1 mensagem → debug direto na edge function.
- Quer testar nudge / reaquecimento → fora de escopo.
- Quer medir custo USD → use `ai_costs` no banco, não este script.
