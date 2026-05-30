# Aba "Planilha" no Fluxo + Revisão IA (GPT-5.5)

Adicionar uma terceira visão no `/admin/fluxos` (FluxoBuilder), ao lado de **Lista** e **Diagrama**, chamada **Planilha** — uma tabela densa só-leitura com tudo do fluxo em texto, exportável em CSV, e com revisão por IA usando GPT-5.5.

## 1. Aba Planilha (read-only, 12+ colunas, scroll horizontal)

Novo componente `src/components/admin/flow-builder/FlowSpreadsheet.tsx` carregando o mesmo `bot_flow_steps` do canal **whapi** (já que a conta `rafael.ids@icloud.com` é whapi) + tabelas relacionadas (`bot_flow_media`, `bot_flow_transitions`, `ai_media_library`).

Colunas (ordem fixa, scroll horizontal, header sticky, primeira coluna sticky):

| # | Coluna | Fonte |
|---|---|---|
| 1 | Pos | `position` |
| 2 | Step key | `step_key` |
| 3 | Título | `title` |
| 4 | Tipo | `step_type` |
| 5 | Variante | `variant` (A/B/C/D) |
| 6 | Mensagem | `message_text` (texto completo, wrap) |
| 7 | Botões | `buttons[]` → `id: título` (um por linha) |
| 8 | Mídias ativas | `bot_flow_media` join `ai_media_library` filtrando `active=true` (tipo + nome) |
| 9 | Transições | `transitions[]` → `condição → próximo_passo` |
| 10 | Retry rules | `retry_rules` / `custom_step_retries_*` (texto) |
| 11 | Timeout | `timeout_seconds` se existir |
| 12 | Status | `is_active` + flags (`requires_*`, `optional`) |
| 13 | Problemas | erros detectados localmente: sem mensagem, sem transição, mídia inativa órfã, step_key duplicado, variante sem par, botão sem destino |

Recursos:
- Toggle de visão no topo: **Lista | Diagrama | Planilha** (preserva o padrão existente em localStorage `flow-view-mode`)
- Filtro por variante (A/B/C/D/Todas) e por tipo (já existe em Lista, reutilizar)
- Busca textual em todas as células
- Botão **Exportar CSV** (gera arquivo `.csv` UTF-8 com BOM, separador `;` para Excel BR)
- Click numa linha → abre o `StepCard` lateral (mesma dialog da Lista) para editar — a planilha em si é read-only, edição continua na Lista/Card

## 2. Revisão IA (GPT-5.5) — global + por linha

### 2.1 Edge function `flow-spreadsheet-review`
Nova edge function em `supabase/functions/flow-spreadsheet-review/index.ts`:
- Modelo: `openai/gpt-5.5` via Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1/chat/completions`)
- `reasoning: { effort: "high" }` para a revisão global; `"medium"` para a por-linha
- Tool-calling com schema estruturado (sem JSON solto):

```ts
tools: [{ type: "function", function: {
  name: "report_flow_issues",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string" },          // resumo executivo
      issues: { type: "array", items: {
        type: "object",
        properties: {
          step_id: { type: "string", nullable: true },  // null = problema global
          step_key: { type: "string", nullable: true },
          severity: { type: "string", enum: ["critical","warning","info"] },
          category: { type: "string", enum: ["copy","logic","media","transition","retry","variant","ux"] },
          problem: { type: "string" },
          suggestion: { type: "string" },
          patch: { type: "object", nullable: true }  // campos a alterar: { message_text?, buttons?, ... }
        },
        required: ["severity","category","problem","suggestion"]
      }}
    },
    required: ["summary","issues"]
  }
}}]
```

- Recebe `{ mode: "global" | "step", flowId, stepId? }`, monta payload com o fluxo inteiro (mesmas colunas da planilha) + contexto: variante D, canal whapi, regras de iGreen Energy
- Trata 429 e 402 retornando mensagens claras

### 2.2 UI da revisão
- Botão **Revisar fluxo (IA)** no topo da Planilha → chama modo `global` → abre painel lateral `FlowReviewPanel` listando issues agrupadas por severidade, com:
  - Linha clicável que rola a planilha até o passo
  - Bloco `problem` + `suggestion` + diff do `patch` (atual vs sugerido)
  - Botão **Editar sugestão** (textarea abre o `patch` em JSON/texto para você ajustar)
  - Botões **Aprovar e salvar** / **Rejeitar**
- Botão **Sugerir melhoria** em cada linha → modo `step` → mesmo painel mas com 1 issue
- Loading com skeleton; erros (429/402) mostram toast com instrução

### 2.3 Fluxo de aprovação (confirmação obrigatória antes de salvar)
1. IA gera issues + patches
2. Você pode **editar o patch** inline
3. Ao clicar **Aprovar e salvar**, abre `AlertDialog` "Confirmar alteração no passo X?" mostrando o diff final
4. Só depois do confirm é que faz `UPDATE bot_flow_steps` (via edge `manual-step-update` existente ou novo) e registra em `bot_flow_audit_log` (criar tabela se não existir, com `step_id, before, after, source='ai_review', user_id, created_at`)
5. Toast de sucesso + recarrega a planilha

## 3. Banco

Migração nova (só se a tabela de auditoria não existir):
- `bot_flow_audit_log` (id, flow_id, step_id, action, source, before jsonb, after jsonb, user_id, created_at) + GRANTs + RLS (admin/consultor dono lê; service_role escreve)

Sem outras mudanças de schema — a planilha lê dados existentes.

## 4. Detalhes técnicos

- **Canal whapi confirmado**: a query lê apenas fluxos cujo `consultant_id` pertence ao usuário logado (`rafael.ids@icloud.com`) e cujo canal está whapi; ignora evolution
- Reutiliza `useFlowSteps` / queries existentes do `FluxoBuilder` (sem refetch duplicado)
- Performance: `react-window` ou virtual scroll se >100 passos (provavelmente não precisa)
- Export CSV feito no client (sem edge function)
- LOVABLE_API_KEY já configurado (Lovable Cloud ativo) — sem secret novo
- Toggle de visão atualiza `flow-view-mode` em localStorage; valores: `lista | diagrama | planilha`

## 5. Arquivos criados/editados

**Criados:**
- `src/components/admin/flow-builder/FlowSpreadsheet.tsx`
- `src/components/admin/flow-builder/FlowReviewPanel.tsx`
- `src/components/admin/flow-builder/hooks/useFlowReview.ts`
- `src/lib/flowSpreadsheetExport.ts` (CSV)
- `supabase/functions/flow-spreadsheet-review/index.ts`
- Migração `bot_flow_audit_log` (se não existir)

**Editados:**
- `src/pages/FluxoBuilder.tsx` — adicionar terceira opção no toggle de visão
- `supabase/config.toml` — registrar nova edge function

## Saída esperada
1. Em `/admin/fluxos` aparece o botão **Planilha** ao lado de Lista/Diagrama
2. Planilha mostra tudo do fluxo D do whapi em formato tabular, exportável
3. **Revisar fluxo (IA)** abre painel com sugestões do GPT-5.5
4. **Sugerir** por linha gera sugestão pontual
5. Você edita o patch, confirma no dialog, salva no banco com auditoria
