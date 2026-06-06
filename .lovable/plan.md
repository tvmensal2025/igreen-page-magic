
# Vendedora v2 — Reescrita Corrigida pela Auditoria

Reescrita em state machine pura, incorporando todas as 5 correções obrigatórias do relatório de auditoria (sub_kwbf57pz). Mantém o ganho de aderência em etapas mecânicas e elimina os 2 bloqueadores hard.

## Correções obrigatórias incorporadas

1. `gateway.ts` passa a aceitar `toolChoice` (string ou objeto) — viabiliza extractor com tool forçada.
2. `DEFAULT_STATE` ganha campos novos com inferência retroativa em `readState()` — conversas em andamento não regridem.
3. `templates.ts` NÃO é criado — usa `fallbackPorEtapa()` existente (movido pra `templates.ts` enxuto que só re-exporta).
4. Sem coluna nova em `consultants`. Rollout via env var `VENDEDORA_V2_ENABLED` em `fluxo-b-ai.ts`, **sobrescrevendo** `variantId === "b.v1"` (não coexiste).
5. Crítico catch retorna `aprovado: false` (não silencia mais). Mantido em etapas ricas; pulado em etapas mecânicas (handlers já garantem por construção).
6. `closer.ts/checklistMinimo` continua sendo a autoridade única de finalização — handler `finalizando` apenas chama essa função, não duplica regras.
7. RAG mantido em `valor`, `simulacao`, `confirmacao`, `doc` (onde FAQ pode aparecer espontaneamente). Removido só em `interesse`, `nome`, `foto_conta`, `email`, `pos_cadastro`.
8. Paralelização: perfilador + RAG embed rodam em `Promise.all` (-400ms).
9. Perfilador roda **só** em etapas ricas (simulação, confirmação, objeção). Pulado em mecânicas (-400ms + tokens).

## Arquitetura final

```text
inbound
 → carregaContexto (customer, consultant, history, state, memory)
 → detectaMidiaNova (mantém lógica de index.ts:117-132)
 → etapa = decideEtapa(customer, state)             // determinística, por código
 → if (etapa rica) await Promise.all([perfilar, embed])  // paralelo
 → tryExtract(etapa) → updates de campo            // tool forçada via gateway.chatForced
 → etapa = decideEtapa({...customer, ...updates}, state)  // re-decide se extraiu
 → handler = HANDLERS[etapa]
 → result = await handler(ctx)                     // 1 LLM call mínimo OU template
 → validate(result.reply) → retry → templatePorEtapa()  // 3 níveis de fallback
 → if (etapa rica) crítico (apenas regras absolutas)
 → aplica updates, persiste state
 → if (finalizando) tentarFechar(closer.ts existente)
 → log ai_decisions com source: "vendedora_v2"
```

## Arquivos — versão final corrigida

```text
supabase/functions/_shared/vendedora-v1/
├── index.ts                    # EDITADO: roteia v1 vs v2 por env, mantém pipeline v1 intacto
├── state-machine.ts            # NOVO: decideEtapa() determinística
├── handlers/                   # NOVO: 1 handler por etapa COM lógica
│   ├── interesse.ts            # template puro (sem LLM)
│   ├── nome.ts                 # writer micro
│   ├── valor.ts                # writer micro
│   ├── simulacao.ts            # writer com RAG + perfil
│   ├── confirmacao.ts          # writer com RAG + perfil
│   ├── foto-conta.ts           # template puro
│   ├── doc.ts                  # writer micro + RAG
│   ├── email.ts                # writer micro
│   ├── finalizando.ts          # delega a closer.ts/tentarFechar
│   └── pos-cadastro.ts         # template puro
├── extractors.ts               # NOVO: extractName/Valor/Email/Interesse via chatForced
├── templates.ts                # NOVO MAGRO: re-exporta fallbackPorEtapa de index.ts
├── critico.ts                  # EDITADO: catch → aprovado:false; chamado só em etapas ricas
├── gateway.ts                  # EDITADO: + chatForced(toolName, toolSchema)
├── tools.ts                    # EDITADO: + 4 tools de extractor (extrair_nome, _valor, _email, _interesse)
├── types.ts                    # EDITADO: + 3 campos em FluxoBState com inferência retroativa
├── perfilador.ts               # MANTÉM, mas chamado só por handlers ricos
├── playbook.ts                 # MANTÉM como dicionário de tom (lookup nos handlers ricos)
├── planner.ts                  # MANTÉM (não removido ainda — usado por v1 enquanto v2 não estabilizar)
├── writer.ts                   # MANTÉM (idem)
├── closer.ts, memory.ts, rag.ts, state.ts, variant-picker.ts  # INTACTOS
```

## Detalhes técnicos das 5 correções

### C1 — `gateway.ts` aceita `toolChoice` flexível

```ts
export async function chat(opts: {
  model: string;
  messages: ChatMsg[];
  tools?: any[];
  toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  temperature?: number;
  json?: boolean;
}): Promise<ChatResult>
// body.tool_choice = opts.toolChoice ?? "auto"
```

Adicional: `chatForced(opts: { model, messages, tool: ToolDef })` wrapper conveniente que seta `tool_choice` para `{type:"function", function:{name: tool.function.name}}` e retorna `{args, modelUsed}`. Em runtime, se o gateway Lovable rejeitar o formato objeto (HTTP 400), fallback automático para `tool_choice: "required"` + checagem de qual tool foi chamada (segurança contra incompatibilidade do proxy).

### C2 — Migração retroativa em `types.ts` + `state.ts`

```ts
// types.ts
export interface FluxoBState {
  ...campos_atuais,
  simulacao_apresentada?: boolean;
  interesse_confirmado?: boolean;
  cadastro_finalizado?: boolean;
}
export const DEFAULT_STATE: FluxoBState = {
  ...campos_atuais,
  simulacao_apresentada: false,
  interesse_confirmado: false,
  cadastro_finalizado: false,
};

// state.ts — readState() ganha inferência
const ETAPAS_ORDER = ["interesse","nome","valor","simulacao","foto_conta","doc","email","finalizando","pos_cadastro"];
const idxEtapa = ETAPAS_ORDER.indexOf(raw.etapa || "interesse");
return {
  ...DEFAULT_STATE,
  ...raw,
  simulacao_apresentada: raw.simulacao_apresentada ?? idxEtapa >= ETAPAS_ORDER.indexOf("foto_conta"),
  interesse_confirmado:  raw.interesse_confirmado  ?? idxEtapa >= ETAPAS_ORDER.indexOf("foto_conta"),
  cadastro_finalizado:   raw.cadastro_finalizado   ?? idxEtapa === "pos_cadastro",
  ...
};
```

Zero migração SQL. Zero regressão em leads ativos.

### C3 — `state-machine.ts`

```ts
export function decideEtapa(c: Customer, s: FluxoBState): Etapa {
  if (!c.name && !s.info?.nome) return "nome";
  if (!c.electricity_bill_value) return "valor";
  if (!s.simulacao_apresentada) return "simulacao";
  if (!s.interesse_confirmado) return "confirmacao";
  if (!s.midia_recebida?.conta) return "foto_conta";
  if (!s.midia_recebida?.doc_frente) return "doc";
  if (!c.email) return "email";
  if (!s.cadastro_finalizado) return "finalizando";
  return "pos_cadastro";
}
```

Sem `inbound` no parâmetro (auditoria mostrou que era ruído). Avanço por mídia continua via `detectarMidiaNova()` antes do `decideEtapa`.

### C4 — Rollout sem coluna nova

```ts
// supabase/functions/_shared/fluxo-b-ai.ts
const v2On = Deno.env.get("VENDEDORA_V2_ENABLED") === "true";
const v1Forced = Deno.env.get("VENDEDORA_V1_FORCE_OFF") === "true";

if (v2On && !v1Forced) {
  return await runVendedoraV2(args);  // novo
}
if (variantId === "b.v1" && !v1Forced) {
  return await runVendedoraV1(args);  // mantém
}
return await runFluxoBAILegacy(args);
```

Um pipeline de cada vez. Kill-switch instantâneo.

### C5 — Crítico endurecido + escopo reduzido

```ts
// critico.ts
} catch {
  return { aprovado: false, problemas: ["crítico indisponível"] };
}
```

E chamado apenas dos handlers ricos (`simulacao`, `confirmacao`, `doc`). Handlers mecânicos pulam — validação estrutural já garante por código.

## Contrato dos handlers

```ts
export interface HandlerCtx {
  supabase: SupabaseClient;
  customerId: string;
  customer: any;
  consultant: any;
  state: FluxoBState;
  perfil: PerfilOutput | null;  // null em etapas mecânicas
  inboundText: string;
  historyMsgs: ChatMsg[];
  historyText: string;
  memoryText: string;
  ragText: string;              // "" em etapas mecânicas
  representante: string;
  nomeLead: string | null;
}

export interface HandlerResult {
  reply: string;
  updates: Record<string, any>;
  stateUpdates: Partial<FluxoBState>;  // ex: { simulacao_apresentada: true }
  nextEtapa?: Etapa;
  toolsApplied: string[];
  handoff?: { reason: string };
  closerHint?: boolean;
}

export type Handler = (ctx: HandlerCtx) => Promise<HandlerResult>;
```

## Validação estrutural (3 níveis de fallback)

```ts
1. writer micro → texto
2. if (!validate(texto)) → retry com prompt mais agressivo (1x)
3. if (ainda !validate) → templatePorEtapa(etapa, ctx) // reusa fallbackPorEtapa()
```

`validate()` por etapa:
- `valor`: regex `/\?$/` && `/valor|conta|luz|R\$/i`
- `simulacao`: `/8\s*[%a]/` && `/20\s*%/` && `/\?/`
- `foto_conta`: `/foto|📷/i` && `/conta|luz/i`
- `email`: `/e-?mail|📧/i` && `/\?$/`

## Extractors (chatForced)

`extractors.ts` exporta 4 funções:
```ts
extractName(ctx): Promise<{ nome: string | null; confianca: "alta"|"media"|"baixa" }>
extractValor(ctx): Promise<{ valor: number | null; confianca: ... }>
extractEmail(ctx): Promise<{ email: string | null; confianca: ... }>
extractInteresse(ctx): Promise<{ interessado: boolean | null; confianca: ... }>
```

Aceita apenas `confianca === "alta"` para escrever no banco (mitiga falso positivo "vou ver o valor amanhã").

## Custo / Latência (números honestos do auditor)

| Cenário | Atual (v1) | v2 corrigido |
|---|---|---|
| Turno mecânico (~70%) | ~5100 tok / 3600ms | ~1550 tok / 1900ms |
| Turno rico (~30%) | ~5100 tok / 3600ms | ~3500 tok / 2900ms |
| **Média ponderada** | **5100 tok / 3600ms** | **~2135 tok / 2200ms** |

Economia real: ~58% tokens, ~39% latência. Paralelização de perfilador+embed e remoção de perfilador em etapas mecânicas são responsáveis por boa parte do ganho.

## Plano de execução em 4 passos

**Passo 1 — Fundação (sem mudança de comportamento)**
- Editar `types.ts` (campos novos opcionais), `state.ts` (inferência retroativa), `gateway.ts` (toolChoice flexível + chatForced wrapper + fallback "required"), `critico.ts` (catch fix).
- Validar com `deno test` se houver, ou deploy + observar logs.

**Passo 2 — State machine + extractors**
- Criar `state-machine.ts`, `extractors.ts`, `templates.ts` (re-exporta fallbackPorEtapa).
- Adicionar 4 tools de extractor em `tools.ts`.

**Passo 3 — Handlers + orquestrador v2**
- Criar 10 handlers em `handlers/`.
- Criar `runVendedoraV2` em `index.ts` ao lado de `runVendedoraV1` (não substitui).

**Passo 4 — Rollout**
- Editar `fluxo-b-ai.ts` com check de env var.
- Adicionar secret `VENDEDORA_V2_ENABLED` (não setar ainda).
- Testar via test-lead-real.mjs com env var local.
- Quando estável, setar `VENDEDORA_V2_ENABLED=true` em produção.
- Após 1 semana sem regressão: remover `planner.ts`, `writer.ts` e código v1 morto.

## Escopo fora

- UI `/admin/whatsapp` (visual atual mantido).
- Worker portal, OCR, integração igreen-sync.
- Schema do banco (zero migração SQL).
- `whapi-webhook` (assinatura de `runVendedoraV1`/`runVendedoraV2` igual).

## Riscos residuais

- **Tool_choice objeto incompatível com proxy Lovable**: mitigado pelo fallback automático para `"required"` em C1.
- **Extractor falso positivo**: mitigado pelo filtro `confianca === "alta"`.
- **Handler novo com bug**: mitigado pelos 3 níveis de validação (writer → retry → template).
- **Drift entre v1 e v2 enquanto coexistem**: mitigado pelo rollout via env var single-switch (não A/B coexistente).

## Arquivos finais

**Novos (12)**: `state-machine.ts`, `extractors.ts`, `templates.ts`, `handlers/{interesse,nome,valor,simulacao,confirmacao,foto-conta,doc,email,finalizando,pos-cadastro}.ts`.

**Editados (6)**: `index.ts` (adiciona runVendedoraV2), `gateway.ts`, `tools.ts`, `types.ts`, `state.ts`, `critico.ts`, `_shared/fluxo-b-ai.ts`.

**Mantidos intactos**: `closer.ts`, `memory.ts`, `rag.ts`, `playbook.ts`, `perfilador.ts`, `variant-picker.ts`, `planner.ts`, `writer.ts`.

**Removidos no Passo 4 final (pós-validação)**: `planner.ts`, `writer.ts`.

**Migração SQL**: nenhuma.
**Secrets**: `VENDEDORA_V2_ENABLED` (adicionar via tool de secrets, ainda não setar `true`).
