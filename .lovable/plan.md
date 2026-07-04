# Clonar Fluxo D → "Fluxo MG" (independente, sem erro)

## Descoberta importante (por que não pode ser literal "MG")

O banco só aceita variant de **1 letra** (`CHECK (variant ~ '^[A-Z]$')` em `bot_flows`, e `IN ('A','B','C','D','E')` em `customers.flow_variant`). Além disso, ~20 pontos de código fazem `variant === "D"` ou usam whitelists `["A","B","C","D","E"]`. Um valor `"MG"` (2 chars) **falha no INSERT** e é ignorado silenciosamente por todos os guards de webhook, watchdog, health cron e UI.

**Solução segura:** usar a letra livre **`"M"`** como valor técnico e **"Fluxo MG"** como `name` (rótulo visível em `bot_flows.name` e em toda a UI). Fica 100% independente do D, sem risco.

---

## O que será feito

### 1. Migration — expandir constraints e clonar linhas

Arquivo novo: `supabase/migrations/<ts>_clone_flow_d_as_m.sql`

- Expandir `customers.flow_variant` CHECK para incluir `'M'` (mantém `A,B,C,D,E`).
- Expandir `clone_bot_flow_as()` para aceitar `'M'` como alvo.
- **Clonar o Fluxo D "público" (consultant_id NULL, variant='D', is_active=true)** em uma nova linha `variant='M', name='Fluxo MG', is_active=true`, copiando **todos os `bot_flow_steps`** (mesmo `step_key`, `step_type`, `position`, `message_text`, `slot_key`, `wait_for`, `captures`, `transitions`, `fallback`, `text_delay_ms`) com **novos UUIDs**.
- Reescrever `transitions[].goto_step_id` e `fallback.goto_step_id` para apontarem aos IDs novos (via mapa `old_id → new_id`), preservando a topologia exata do D.
- GRANTs herdados de `bot_flows`/`bot_flow_steps` (já existentes).
- Sem tocar em nenhuma linha do D — clone é aditivo.

### 2. Backend — tratar "M" idêntico a "D" em todos os guards

Substituir toda condição `variant === "D"` por `(variant === "D" || variant === "M")` e whitelists `["A","B","C","D","E"]` por `["A","B","C","D","E","M"]` nos arquivos:

- `supabase/functions/whapi-webhook/index.ts` (linhas 1447, 1459, 1761, 1772, 2464)
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts` (linhas 2349, 3197)
- `supabase/functions/evolution-webhook/index.ts` (linhas 2269, 2275)
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (linha 3043)
- `supabase/functions/manual-step-send/index.ts` (linhas 49, 311, 476)
- `supabase/functions/flow-d-stuck-watchdog/index.ts` (linha 66): `.in("flow_variant", ["D","M"])`
- `supabase/functions/flow-d-health-cron/index.ts` (linhas 46, 87): idem
- `supabase/functions/_shared/captation/flow-d-alerts.ts` (linhas 47-48): aceitar D e M
- `supabase/functions/_shared/pick-flow-variant.ts`: adicionar `"M"` ao union type (não altera lógica de sorteio — MG será atribuído manualmente por consultor via `active_variants`)
- `supabase/functions/_shared/engine/helpers.ts` (linhas 318, 337): `case "M": return variantD` (reusa estratégia — MG é clone lógico do D)
- `supabase/functions/_shared/engine/loader.ts` (linha 90): expandir cast
- `supabase/functions/_shared/engine/types.ts`: expandir union
- `supabase/functions/_shared/flow-templates/types.ts`: expandir union

### 3. Frontend — chip MG na UI

- `src/components/whatsapp/FlowQuickBar.tsx`, `src/components/admin/AIAgentTab/ManualStepDialog.tsx`, `.../LiveConversationsPanel.tsx`, `src/components/admin/saude/BotHealthIntel.tsx`, `src/pages/SaudeProducao.tsx`, `src/components/admin/fluxo-b-ia/ConsultantVariantsCard.tsx`: adicionar `"M"` às arrays e unions.
- Label do chip: exibir `"MG"` (2 chars) quando `variant === "M"` — ajustar largura mínima do badge para caber.
- `VariantDistributionBar.tsx` linha 134: manter proteção contra rename do D **e** do M ("Fluxo MG não pode ser renomeado").
- Linha 254: desabilitar delete de M também (é fluxo oficial).

### 4. Independência

- MG **não** é ativado automaticamente para nenhum consultor — só entra na distribuição quando o admin adiciona `"M"` ao `active_variants` do consultor via `VariantDistributionBar`.
- Nenhuma alteração em Fluxo D, seus steps, `assign_flow_variant`, `flow_ab_mode`, ou clientes existentes.
- Watchdog, health cron, engine e webhooks tratam D e M em paralelo (queries `.in(...)`, guards `||`), sem interferência cruzada.

### 5. Validação pós-deploy

- `supabase read_query`: contar steps do D vs M — devem bater; validar que todo `goto_step_id` do M aponta para step do M (nenhum órfão para D).
- Deploy das edges tocadas e chamada de teste (`manual-step-send` com `variant:"M"`) para garantir 200.
- Build TS deve passar sem erros de union type.

---

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| INSERT falhar por CHECK antigo em `customers.flow_variant` | Migration expande a CHECK antes de qualquer código atribuir "M" |
| Chip "MG" quebrar layout single-char | Ajustar `min-w` do badge (mudança CSS pontual) |
| Guard esquecido → MG silenciosamente ignorado | Lista completa de call-sites já mapeada acima (18 pontos); revisão dupla |
| Rollback | Migration inclui `DOWN` opcional: `DELETE FROM bot_flows WHERE variant='M' AND name='Fluxo MG'` (cascata remove steps) |

---

## Fora de escopo (não faremos agora)

- Criar estratégia própria `variants/m.ts` — MG reusa `variantD` (é clone lógico).
- Alterar `pick-flow-variant.ts` para incluir MG no split aleatório — atribuição fica manual.
- Novo `flow-mg-stuck-watchdog` — o watchdog do D passa a cobrir D e M via `.in([...])`.
