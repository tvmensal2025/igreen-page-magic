---
inclusion: fileMatch
name: cerebro-fluxo-b
description: Cérebro produção vs simulador Fluxo B.
fileMatchPattern:
  - "supabase/functions/_shared/cerebro/**"
  - "supabase/functions/_shared/fluxo-b-ia/**"
  - "supabase/functions/fluxo-b-ai/**"
  - ".kiro/specs/cerebro-ia/**"
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
- Flags alinhadas ao motor V3: consultor `flow_engine_v3` em `canary`/`on` → Cérebro pode responder; `off`/`dark` → não responde (sombra/legado)
- **Não** toca dedupe / rate-limit / anti-ban — só decide conteúdo; envio via `enviarTexto` injetado
- Cadastro: `despacho-cadastro.ts` (repassador existente)
- Sombra: `cerebro/sombra-hook.ts` (observa sem mandar)

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
```

## Relação com outros motores
- **bot-flow.ts** (legado grande) e **engine V3** (`_shared/engine/`) coexistem — ver `#flow-engine-v3`
- Variante canônica Grupo A / Sofia desde 2026-07-20 (`assign_flow_variant`)

## NÃO FAÇA
- Restaurar / importar `_shared/vendedora/` em produção
- Usar `fluxo-b-ai` como envio real sem `dryRun:false` **e** pedido explícito
- Confundir “Cérebro conversa” com “Cérebro MG” Ads (`#cerebro-mg-e-rodizio`)
- Ligar canário/on global sem pedido do usuário
