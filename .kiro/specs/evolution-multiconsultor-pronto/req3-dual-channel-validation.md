# Task 2.4 — Validação dual-channel da mudança de webhook (REQ 3)

> Documento de validação da **Tarefa 2.4** do spec `evolution-multiconsultor-pronto`.
> **REQ 3 — Resolução de fluxo ativo robusta** (seleção determinística por variante).
> _Validates: Requirements 3.4, 6.2, 6.3, 6.5, 6.6_
>
> Anexar ao PR como evidência da validação dual-channel (Evolution + não-regressão Whapi).

## Escopo desta tarefa (honestidade sobre o que foi feito)

Esta é uma tarefa de **validação + checklist dual-channel**, não de implementação.
A mudança de código do REQ 3 já foi aplicada na tarefa 2.1.

- ✅ **Verificado automaticamente** (nesta tarefa): paridade estrutural 1:1 do
  seletor, não-regressão estrutural do Whapi via `git`, e a evidência de teste
  (Property 2 PBT + exemplo 2.3 da etapa de abertura).
- ⏳ **Permanece como gate humano manual** (NÃO executável aqui): o teste
  end-to-end ao vivo contra uma instância Evolution de teste **real** e o
  baseline A/B/D ao vivo no canal Whapi do Rafael. Isso exige funções
  **deployadas** + **aprovação humana explícita** e a mudança **NÃO foi
  deployada**. Ver a seção [Checklist manual pré-rollout](#checklist-manual-pré-rollout-gate-humano).

> ⚠️ **A mudança do REQ 3 permanece não auto-aplicável.** Nenhum redeploy de
> webhook foi feito. O rollout aguarda aprovação humana (Requisitos 6.3).

---

## 1. Prova de paridade estática — seletor Evolution ≡ seletor Whapi (1:1)

O seletor determinístico inlinado no `evolution-webhook` (tarefa 2.1) **espelha
byte-a-byte** o seletor de referência já usado em produção no `whapi-webhook`.
Isso é o cerne do REQ 3.4 ("resolver o fluxo ativo de forma equivalente à já
adotada pelo whapi-webhook") e a base estrutural da não-regressão (REQ 6.5/6.6):
como o algoritmo é idêntico ao que o Rafael já roda, não há divergência de
comportamento a introduzir no Whapi.

### Seletor de REFERÊNCIA — `whapi-webhook/index.ts` (~linha 1443–1452)

```ts
const variant = (customer as any)?.flow_variant || "A";
const { data: activeFlows } = await supabase
  .from("bot_flows")
  .select("id")
  .eq("consultant_id", superAdminConsultantId)
  .eq("is_active", true)
  .eq("variant", variant)
  .order("created_at", { ascending: true })
  .limit(1);
const activeFlow = activeFlows?.[0] || null;
```

### Seletor inlinado — `evolution-webhook/index.ts` Site A (`isOpeningTurn`, ~1075–1084)

```ts
const variant = (customer as any)?.flow_variant || "A";
const { data: activeFlows } = await supabase
  .from("bot_flows")
  .select("id")
  .eq("consultant_id", instanceData.consultant_id)
  .eq("is_active", true)
  .eq("variant", variant)
  .order("created_at", { ascending: true })
  .limit(1);
const activeFlow = activeFlows?.[0] || null;
const flowId = (activeFlow as any)?.id ?? null;
```

### Seletor inlinado — `evolution-webhook/index.ts` Site B (`FONTE ÚNICA DE VERDADE`, ~1331–1340)

```ts
const variant = (customer as any)?.flow_variant || "A";
const { data: activeFlows } = await supabase
  .from("bot_flows")
  .select("id")
  .eq("consultant_id", instanceData.consultant_id)
  .eq("is_active", true)
  .eq("variant", variant)
  .order("created_at", { ascending: true })
  .limit(1);
const activeFlow = activeFlows?.[0] || null;
```

### Tabela de paridade

| Elemento do seletor | Whapi (referência) | Evolution Site A | Evolution Site B |
|---|---|---|---|
| `variant` default | `(customer)?.flow_variant \|\| "A"` | idêntico | idêntico |
| `.eq("is_active", true)` | sim | sim | sim |
| `.eq("variant", variant)` | sim | sim | sim |
| `.order("created_at", { ascending: true })` | sim | sim | sim |
| `.limit(1)` | sim | sim | sim |
| pegar resultado | `activeFlows?.[0] \|\| null` | idêntico | idêntico |
| diferença | — | `consultant_id` é o da instância Evolution (multi-tenant) vs. `superAdminConsultantId` fixo no Whapi (single-tenant Rafael) | idem |

**Única diferença**, esperada e correta: o `consultant_id` filtrado. O Whapi usa
o `superAdminConsultantId` (Rafael, single-tenant); o Evolution usa
`instanceData.consultant_id` (o consultor dono da instância que recebeu o
evento). A lógica de seleção (variante → ordenação → limite 1) é **idêntica**.

**Conclusão:** seletor determinístico, retorna no máximo 1 fluxo e nunca lança
"multiple rows" para 0/1/N fluxos ativos — paridade 1:1 com o Whapi confirmada.

---

## 2. Não-regressão estrutural no Whapi — prova via `git`

Confirmado que **nenhum arquivo** sob `supabase/functions/whapi-webhook/` foi
modificado, adicionado ou removido por este spec.

| Comando | Resultado | Interpretação |
|---|---|---|
| `git diff --stat -- supabase/functions/whapi-webhook/` | *(saída vazia)* | nenhuma alteração rastreada |
| `git status --short -- supabase/functions/whapi-webhook/` | *(saída vazia)* | nenhuma alteração na árvore de trabalho |
| `git ls-files --others --exclude-standard -- supabase/functions/whapi-webhook/` | *(saída vazia)* | nenhum arquivo novo não-rastreado |

Os arquivos modificados pelo spec (do `git status`) são **somente** das edge
functions do REQ 1/3/5, helpers `_shared`, migrações, testes e `.env.example`.
**Zero** entradas sob `whapi-webhook/`.

```
 M supabase/functions/.env.example
 M supabase/functions/ai-agent-router/index.ts
 M supabase/functions/ai-sales-agent/index.ts
 M supabase/functions/capture-extract/index.ts
 M supabase/functions/evolution-webhook/index.ts
 M supabase/functions/facebook-capi/index.ts
 M supabase/functions/upload-documents-minio/index.ts
 M vitest.config.ts
 ?? src/lib/flow-selectors/ , src/lib/whatsapp/flow-selector*.ts
 ?? src/test/* , supabase/functions/_shared/* , supabase/migrations/*
```

**Conclusão (REQ 6.6):** o canal Whapi do Rafael é byte-idêntico ao baseline. A
não-regressão estrutural está provada. A confirmação *comportamental* ao vivo
permanece como gate manual (seção 4).

---

## 3. Evidência automatizada — testes verdes

### 3.1 Property 2 — seletor determinístico, único e total (PBT)

- **Arquivo:** `src/lib/whatsapp/flow-selector.property.test.ts`
- **Sob teste (módulo puro):** `src/lib/whatsapp/flow-selector.ts` →
  `selectActiveFlow` (algoritmo single-pass) vs. `referenceSelectActiveFlow`
  (oráculo independente filter+sort+head, modelo do whapi).
- **Tag:** `// Feature: evolution-multiconsultor-pronto, Property 2`
- **Validates:** Requirements 3.1, 3.2, 3.4
- **Iterações:** 300 por propriedade (`numRuns: 300`, ≥100 exigido).

Propriedades verificadas:
1. retorna ≤1 fluxo (ou null) e nunca lança para 0/1/N fluxos;
2. só retorna fluxo ativo da variante do cliente (ou null);
3. seleciona o de menor `created_at` dentre os da variante;
4. **invariante à permutação** da ordem de entrada;
5. **coincide com o seletor de referência do whapi** (model-based).

### 3.2 Exemplo 2.3 — detecção da etapa de abertura + não-regressão de 1 fluxo

- **Arquivo:** `src/lib/flow-selectors/openingStep.test.ts`
- **Validates:** Requirement 3.3
- Cobre: opening step = primeiro step ativo por `position`; ignora inativos;
  degrada sem lançar; **consultor com 1 único fluxo ativo na variante do cliente
  resolve normalmente** (não cai no welcome legado); default de variante "A".

### 3.3 Resultado da execução

Comando (a partir da raiz do repo):

```bash
npx vitest run src/lib/whatsapp/flow-selector.property.test.ts src/lib/flow-selectors/openingStep.test.ts
```

Saída:

```
 ✓ src/lib/flow-selectors/openingStep.test.ts (6 tests) 5ms
 ✓ src/lib/whatsapp/flow-selector.property.test.ts (5 tests) 222ms

 Test Files  2 passed (2)
      Tests  11 passed (11)
```

**Resultado: 11/11 testes passando** (5 propriedades + 6 exemplos). ✅

---

## 4. Checklist manual pré-rollout (gate humano)

> Os itens abaixo **NÃO** foram executados automaticamente. Exigem funções
> **deployadas** numa instância Evolution de teste e o canal Whapi ao vivo, mais
> **aprovação humana explícita** (Requisitos 6.2, 6.3, 6.5). A mudança **não foi
> deployada**. Um operador deve executar e marcar cada item antes do rollout em
> produção.

### 4.1 Canal Evolution (instância de teste) — REQ 3.1/3.2/3.3

- [ ] **Consultor com 1 fluxo ativo** na variante do cliente → o lead resolve
      esse fluxo e detecta a etapa de abertura (não cai no welcome legado).
- [ ] **Consultor com N fluxos ativos** (variantes distintas, ex. A/B/D) → o lead
      resolve **1 único** fluxo determinístico pela variante do cliente; nenhum
      erro "multiple rows"; **não** cai no welcome legado.
- [ ] **Variante do cliente sem fluxo correspondente** → comportamento consistente
      com o Whapi (resolve pela variante do cliente; degrada para `sys`/welcome
      sem crash quando não há match).
- [ ] Confirmar nos logs que **nenhuma** exceção "JSON object requested, multiple
      (or no) rows returned" ocorre (o bug que o REQ 3 corrige).

### 4.2 Não-regressão no Whapi (baseline A/B/D do Rafael) — REQ 6.5/6.6

- [ ] Rodar o **baseline A/B/D** do Rafael no canal Whapi e capturar as respostas.
- [ ] Confirmar **paridade** com o baseline pré-mudança (respostas idênticas).
- [ ] Reconfirmar (já provado estaticamente na seção 2) que nenhum artefato do
      `whapi-webhook` foi redeployado/alterado.

### 4.3 Backup, rollback e aprovação — REQ 6.2/6.3

- [ ] **Backup:** artefato anterior da função `evolution-webhook` arquivado antes
      do deploy (para redeploy de rollback).
- [ ] **Rollback documentado:** reverter o REQ 3 = **redeploy do artefato
      anterior** do `evolution-webhook` (sem mudança de DB — REQ 3 é só código).
- [ ] **Aprovação humana explícita** registrada antes do rollout (não
      auto-aplicável).

---

## 5. Mapeamento de requisitos

| Req | Como é coberto | Status |
|---|---|---|
| **3.4** — resolução equivalente ao whapi | Paridade estática 1:1 (seção 1) + Property 2 model-based contra oráculo whapi (seção 3.1) | ✅ verificado automaticamente |
| **6.2** — backup + plano de rollback antes da mudança | Rollback = redeploy do artefato anterior (seção 4.3); backup do artefato é ação do operador no deploy | ⏳ gate humano |
| **6.3** — aprovação humana explícita, não auto-aplicável | Nenhum redeploy feito; aguarda aprovação (seção 4.3) | ⏳ gate humano |
| **6.5** — validar no Evolution + confirmar não-regressão no Whapi | Não-regressão estrutural provada via git (seção 2); validação E2E ao vivo no checklist (seção 4.1/4.2) | ✅ estrutural / ⏳ E2E manual |
| **6.6** — preservar comportamento do Rafael (Whapi A/B/D) | `whapi-webhook` byte-untouched (seção 2); seletor idêntico ao já usado lá (seção 1) | ✅ estrutural / ⏳ baseline ao vivo manual |

---

## 6. Resumo

- **Automaticamente verificado e aprovado:** (a) paridade 1:1 do seletor
  Evolution ↔ Whapi nos dois sites; (b) `whapi-webhook` byte-untouched por `git`;
  (c) Property 2 PBT (5 props × 300 runs) + exemplo 2.3 da etapa de abertura —
  **11/11 testes verdes**.
- **Permanece como gate humano (não executável aqui):** teste end-to-end ao vivo
  numa instância Evolution de teste, baseline A/B/D ao vivo no Whapi, backup do
  artefato, e aprovação humana explícita — porque a mudança **não foi deployada**
  e o rollout é não auto-aplicável.
