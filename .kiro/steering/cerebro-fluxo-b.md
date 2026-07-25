---
inclusion: always
name: cerebro-fluxo-b
description: Cérebro produção vs simulador Fluxo B + relação com Grupo A (sempre carregado).
---

# Cérebro (produção) × Fluxo B (simulador)

## Duas coisas diferentes — nunca misturar

| | Produção | Simulador |
|---|---|---|
| Path | `_shared/cerebro/resposta-hook.ts` → `responderComCerebro` | `fluxo-b-ai` + `_shared/fluxo-b-ia/` |
| Quem chama | `whapi-webhook` / `evolution-webhook` | UI / skill E2E / dryRun |
| Persistência | Sim (turno real) | **default `dryRun=true`** — não persiste / não envia |
| Fail posture | Fail-open: erro → `respondeu=false`, caminho legado segue | Isolado |

Evidência dryRun: `fluxo-b-ai/index.ts:47` — `const dryRun = body?.dryRun !== false` (default TRUE).  
Sender capturado no simulador: `:68–83`. Side-effects reais só fora de dryRun: `_shared/fluxo-b-ia/agent.ts:111–121`, `:303–329`.  
Handoff: `agent.ts:313–315` (pausa bot com razão handoff).  
Portal só via `dispatchPortalWorker` — `cerebro/despacho-cadastro.ts:20–26` (não reinventar OCR/OTP).  
No webhook: V3 sombra ~`:3163–3174` → Cérebro/Fluxo B resposta ~`:3272–3307` → fallback legado `runEngine()` ~`:3438–3440` (comentário em `:3221` descreve a intenção; a execução está nas linhas acima).

## Cérebro — ativação
- Flag dedicada: `consultants.cerebro_ativo` (`on`/`off`). **Default `off`** — opt-in no modal **Mensagens automáticas** (`ConsultantAutomationPrefsModal` + `CEREBRO_OPT_IN`).
- Também responde se número ∈ `rollout_config.cerebro_numeros_teste` (teste) ou se `flow_engine_v3` ∈ `canary`/`on`.
- **Não** é pack A/B/C de **disparo**: só responde inbound; cadência pausa 72h no `lead_responded`.
- **Não** toca dedupe / rate-limit / anti-ban — só decide conteúdo; envio via `enviarTexto` injetado
- Cadastro: `despacho-cadastro.ts` (repassador existente)
- Sombra: `cerebro/sombra-hook.ts` (observa sem mandar)

## Como DEVE funcionar com o Grupo A (canônico)

**Grupo A manda no funil de cadastro. Cérebro não substitui a trilha.**

| Situação no webhook | Quem responde | Evidência |
|---|---|---|
| Variante **A** + lead **em cadastro** (`CADASTRO_STEPS` / capture) | **Determinístico** (bot-flow) — Cérebro **pulado** | `fluxo-a-bypass` em `whapi-webhook/index.ts` ~`:3352–3353` |
| Em cadastro + input **esperado** (foto, valor, botão do passo) | **Determinístico** — Cérebro **não** interpreta | ~`:3377–3382` |
| Em cadastro + pergunta **livre** / off-topic | Cérebro responde **sem mexer no step** | ~`:3384–3396` |
| **Fora** do cadastro (ainda conversando) | Cérebro pode assumir o turno | ~`:3367–3376` |
| Cliente carteira (`igreen_sync` / `igreen_extension`) | Cérebro dúvidas (read-only) — **sem** OCR/Portal 2 | ~`:3354–3366` |
| Lead **parou de falar** | Cadência Grupo A (nudge/SMS/call) — **não** é Cérebro | `cadence-tick` + `lead_cadence_state` |

Resumo de produto:
- **Grupo A organizado** = passos do cadastro + cadência quando silencia.
- **Cérebro** = voz nas laterais (dúvida / abertura fora do passo), **sem furar a ordem**.

## Arquivos âncora
```
_shared/cerebro/
  resposta-hook.ts   # produção
  sombra-hook.ts
  guarda.ts
  estado.ts
  escritor.ts
  cross-sell.ts      # sugestão; sombra por padrão
  despacho-cadastro.ts
fluxo-b-ai/index.ts  # simulador
_shared/fluxo-b-ia/  # agent do simulador
whapi-webhook/index.ts  # gates fluxo-a-bypass / cadastro expected vs freeform
```

## Relação com outros motores
- **bot-flow.ts** (legado grande) e **engine V3** (`_shared/engine/`) coexistem — ver `#flow-engine-v3`
- Variante canônica Grupo A / Sofia desde 2026-07-20 (`assign_flow_variant`)
- Cadência A/B/C = disparo; Cérebro = resposta inbound (ver tabela acima)

## NÃO FAÇA
- Restaurar / importar `_shared/vendedora/` em produção
- Usar `fluxo-b-ai` como envio real sem `dryRun:false` **e** pedido explícito
- Confundir “Cérebro conversa” com “Cérebro MG” Ads (`#cerebro-mg-e-rodizio`)
- Ligar canário/on global sem pedido do usuário
- Fazer o Cérebro **substituir** o funil determinístico do Grupo A no cadastro (OCR/portal)
- Assumir que `cerebro_ativo=on` = Cérebro conduz todo o Grupo A
