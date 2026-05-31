# Task 1.4 — Validação dual-channel da mudança de webhook (REQ 1, kill switch)

> Documento de validação da **Tarefa 1.4** do spec `evolution-multiconsultor-pronto`.
> **REQ 1 — Kill switch global no Evolution.**
> _Validates: Requirements 1.4, 6.2, 6.3, 6.5, 6.6_
>
> Anexar ao PR da mudança de webhook do REQ 1 como evidência da validação
> dual-channel (Evolution + não-regressão Whapi) e do gate de aprovação humana.

## Provenance da captura

- **Timestamp (UTC):** 2026-05-31T17:12:34Z
- **Commit base (HEAD):** `426d5e63` (`main`, `origin/main`)
- **Working tree:** mudança do REQ 1 **aplicada localmente, NÃO commitada, NÃO
  deployada** (`supabase/functions/evolution-webhook/index.ts` aparece como
  modificado em `git status`).
- **Comandos rodados a partir da raiz do repo** (`/home/dev/Documents/Igreen-oficial/igreen-official-portal`).

---

## 0. TL;DR — o que foi verificado automaticamente vs. o que é gate manual

| Item | Tipo | Status |
|------|------|--------|
| Property 1 (kill switch off → zero outbound; erro → fail-open) | Automático (PBT) | ✅ PASSA |
| Exemplo 1.2 (flag=true → handler prossegue) | Automático (Vitest) | ✅ PASSA |
| Smoke estático 1.4 (guarda no topo + paridade Whapi) | Automático (Vitest) | ✅ PASSA |
| Não-regressão estática Whapi (nenhum arquivo tocado) | Automático (git) | ✅ PROVADO |
| **Canal Evolution end-to-end (instância de teste)** | **Manual** | ⛔ PENDENTE (gate humano) |
| **Baseline Whapi A/B/D do Rafael end-to-end** | **Manual** | ⛔ PENDENTE (gate humano) |
| **Aprovação humana + redeploy** | **Processo** | ⛔ PENDENTE (gate humano) |

> **Honestidade de escopo:** um teste ao vivo contra uma instância Evolution
> real e contra o canal Whapi real exige funções **deployadas** + aprovação
> humana, o que está **fora do escopo da execução automatizada**. A mudança do
> REQ 1 **não é auto-aplicável** e **não foi deployada**. Este documento
> registra a evidência automatizada já produzida e define o **checklist manual
> de pré-rollout** que uma pessoa deve executar antes de produção.

---

## 1. A mudança validada (REQ 1)

Guarda do kill switch inserida no topo do handler de
`supabase/functions/evolution-webhook/index.ts`, espelhando
`whapi-webhook/index.ts` (~linha 62). Diff relevante (vs. `HEAD`):

```diff
+import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";
...
+    // Kill switch global (Fase 0 auditoria). Fail-open: erros = habilitado.
+    // Espelha whapi-webhook/index.ts (~linha 62): silencia globalmente todas as
+    // respostas automáticas quando bot_global_enabled=false, com zero outbound e
+    // resposta neutra 200 (nunca 5xx, para o provedor não reenviar o evento).
+    if (!(await isBotGloballyEnabled(supabase as any))) {
+      console.log("[evolution-webhook] bot_global_enabled=false → silenciado");
+      return new Response(JSON.stringify({ ok: true, msg: "bot_globally_disabled" }), {
+        headers: { ...corsHeaders, "Content-Type": "application/json" },
+      });
+    }
```

- A guarda fica **antes** de `await req.json()` e **antes** da guarda
  por-consultor `isConsultantAIDisabled` (kill switch global precede o
  per-consultor).
- Fail-open garantido pelo próprio helper `isBotGloballyEnabled`
  (`_shared/bot/global-flag.ts`): em qualquer erro de leitura ou linha ausente,
  retorna `true` (bot habilitado). Reusa o helper existente — **nenhum helper
  novo**.
- Sem mudança de DB; sem segredo novo. Rollback = redeploy do artefato anterior.

---

## 2. Evidência automatizada (canal Evolution, lógica pura)

### 2.1 Property 1 — Kill switch desliga todo outbound no Evolution

A decisão de gating foi extraída para um módulo **puro**
`supabase/functions/_shared/bot/kill-switch-gate.ts`
(`evaluateKillSwitchGate`), com semântica byte-equivalente à de
`isBotGloballyEnabled` (fail-open no erro e na linha ausente). O property test
exercita ≥200 iterações por propriedade.

`// Feature: evolution-multiconsultor-pronto, Property 1: Kill switch desliga todo outbound no Evolution`
**Validates: Requirements 1.1, 1.3.**

Asserções verificadas pelo PBT
(`src/test/evolution-kill-switch-gate.property.test.ts`):

- `bot_global_enabled` falsy → `enabled=false`, **zero outbound** (contador do
  sender mockado = 0) e resposta neutra `{ ok: true, msg: "bot_globally_disabled" }`, status 200.
- Erro de leitura da flag → **fail-open** (`enabled=true`), processa normalmente
  (1 outbound), status 200.
- Linha da flag ausente → fail-open (`enabled=true`).
- `bot_global_enabled` truthy → processa normalmente, outbound permitido.
- Invariante geral: outbound ocorre **se e somente se** `enabled === true`.

### 2.2 Exemplo (1.2) + Smoke estático (1.4)

`src/test/evolution-kill-switch-guard.test.ts`:

- **Exemplo (Critério 1.2):** com `bot_global_enabled=true`, o gate resolve como
  habilitado e o handler **segue além da guarda** — verificado para 2 eventos
  representativos (`messages.upsert`, `connection.update`).
- **Smoke estático (Critério 1.4):** lendo o fonte de `evolution-webhook/index.ts`:
  importa e aplica `isBotGloballyEnabled`; retorna a resposta neutra
  `{ ok: true, msg: "bot_globally_disabled" }`; a guarda está **dentro** do
  `Deno.serve`, **antes** de `req.json()` e **antes** de `isConsultantAIDisabled`.
- **Paridade de semântica com o Whapi:** confirma que `whapi-webhook/index.ts`
  aplica **a MESMA guarda** (`if (!(await isBotGloballyEnabled(supabase as any)))`)
  e **a MESMA resposta neutra**, no mesmo ponto de decisão (antes do `req.json()`).

### 2.3 Resultado da execução (reproduzível)

Comando (rodado da raiz do repo):

```bash
npx vitest run \
  src/test/evolution-kill-switch-gate.property.test.ts \
  src/test/evolution-kill-switch-guard.test.ts
```

Saída (verbatim resumido):

```
 ✓ src/test/evolution-kill-switch-guard.test.ts (8 tests) 15ms
 ✓ src/test/evolution-kill-switch-gate.property.test.ts (5 tests) 461ms

 Test Files  2 passed (2)
      Tests  13 passed (13)
```

**13/13 testes passam, exit code 0.**

---

## 3. Não-regressão no Whapi — prova estática (Req 6.5, 6.6)

A premissa do spec é que o Rafael (super-admin, id
`0c2711ad-4836-41e6-afba-edd94f698ae3`) opera as variantes A/B/D no **Whapi** e
**não pode ser perturbado**. A mudança do REQ 1 toca **somente** o
`evolution-webhook`. Prova por git, a partir da raiz do repo:

### 3.1 Nenhum arquivo de `whapi-webhook` foi modificado

```bash
git status --short -- supabase/functions/whapi-webhook/      # → vazio (0 mudanças rastreadas)
git ls-files --others --exclude-standard -- supabase/functions/whapi-webhook/   # → vazio (0 arquivos novos)
git diff --stat HEAD -- supabase/functions/whapi-webhook/    # → vazio (diffstat zerado)
```

Os três comandos retornam **saída vazia** → nenhum arquivo sob
`supabase/functions/whapi-webhook/` (`index.ts`, `_helpers.ts`,
`handlers/**`) foi tocado, criado ou removido por este spec.

### 3.2 O `whapi-webhook` não aparece em nenhuma mudança do changeset

`git diff --stat HEAD` lista os **8** arquivos alterados pelo spec inteiro:

```
 supabase/functions/.env.example                    |  8 ++++++
 supabase/functions/ai-agent-router/index.ts        | 10 +++++++
 supabase/functions/ai-sales-agent/index.ts         | 11 +++++++
 supabase/functions/capture-extract/index.ts        | 17 +++++++++--
 supabase/functions/evolution-webhook/index.ts      | 43 +++++++++++++++++++++++++---
 supabase/functions/facebook-capi/index.ts          | 14 +++++++++
 supabase/functions/upload-documents-minio/index.ts | 11 +++++--
 vitest.config.ts                                   |  9 +++++-
```

Entre os webhooks, **apenas** `evolution-webhook/index.ts` foi alterado.
`whapi-webhook` está ausente da lista (tracked e untracked).

### 3.3 Paridade semântica da guarda (byte-equivalente)

A guarda inserida no Evolution é semanticamente idêntica à já existente no
Whapi (mesmo helper `isBotGloballyEnabled`, mesma negação, mesma resposta neutra,
mesma posição relativa antes do `req.json()`). Como o Whapi **continua usando o
mesmo helper sem qualquer alteração**, a mudança do REQ 1 não pode regredir o
comportamento do Whapi por construção. A paridade é verificada automaticamente
pelo bloco "Paridade de semântica com whapi-webhook" em
`src/test/evolution-kill-switch-guard.test.ts` (ver §2.2).

> **Conclusão estática:** o canal Whapi do Rafael é **byte-inalterado** por esta
> mudança. A validação manual end-to-end (§4.2) confirma a paridade comportamental
> e é obrigatória antes do rollout, conforme Req 6.5.

---

## 4. Checklist manual de pré-rollout (gate humano — OBRIGATÓRIO)

> Os passos abaixo **não** foram executados automaticamente (exigem funções
> deployadas + instância Evolution de teste + observação do canal Whapi real).
> Uma pessoa deve executá-los e marcar cada caixa **antes** da aprovação de
> rollout em produção. Nada aqui é auto-aplicável (Req 6.3).

### 4.1 Canal Evolution — instância de teste

Pré-requisito: deploy do `evolution-webhook` (artefato com a guarda) em
ambiente de teste, com uma instância Evolution de teste pareada por QR code.

- [ ] **Kill switch OFF (`bot_global_enabled=true`) → fluxo normal**
  - Enviar um lead representativo para a instância de teste.
  - Confirmar que o bot **responde normalmente** (caminho-feliz preservado;
    abertura/roteamento de fluxo inalterados).
- [ ] **Kill switch ON (`bot_global_enabled=false`) → zero outbound + 200 neutro**
  - Setar `app_settings.bot_global_enabled=false` (id `global`).
  - Aguardar > 5s (TTL do cache do helper) e reenviar o mesmo lead.
  - Confirmar **zero** envios outbound (nenhuma mensagem chega ao WhatsApp do lead).
  - Confirmar resposta HTTP **200** com corpo `{ ok: true, msg: "bot_globally_disabled" }`.
  - Confirmar que **não** há 5xx (o provedor não deve reenviar o evento).
- [ ] **Fail-open (degradação segura)**
  - Simular falha de leitura da flag (ex.: indisponibilidade momentânea de
    `app_settings`) e confirmar que o webhook **processa normalmente**
    (bot tratado como habilitado), sem 5xx.
- [ ] **Restaurar `bot_global_enabled=true`** ao fim do teste.

### 4.2 Canal Whapi — baseline A/B/D do Rafael (não-regressão)

- [ ] Rodar o **baseline A/B/D** do Rafael no Whapi (um lead por variante A, B e D).
- [ ] Confirmar que cada variante **resolve o fluxo** e **responde idêntico ao
      baseline** anterior à mudança (sem diferença de conteúdo, ordem ou timing
      relevante).
- [ ] Confirmar que o canal Whapi **não foi tocado** pelo deploy do Evolution
      (deploy escopado só à função `evolution-webhook`).

### 4.3 Backup / Rollback (Req 6.2)

- [ ] **Backup:** preservar o artefato anterior da função `evolution-webhook`
      (versão deployada atual, **sem** a guarda) como ponto de rollback.
      Para webhook, o backup = artefato/versão anterior da Edge Function (não há
      migração de banco neste REQ).
- [ ] **Rollback documentado:** em caso de regressão, **redeploy do artefato
      anterior** do `evolution-webhook` remove a guarda e restaura o
      comportamento. Procedimento: reverter
      `supabase/functions/evolution-webhook/index.ts` ao estado de `HEAD`
      (`426d5e63`) — i.e. remover o import `isBotGloballyEnabled` e o bloco da
      guarda — e redeployar a função. Nenhuma mudança de banco/segredo a reverter.

### 4.4 Gate de aprovação humana (Req 6.3)

- [ ] Revisar a evidência automatizada (§2, §3) e o resultado do checklist
      manual (§4.1, §4.2).
- [ ] **Aprovação humana explícita** registrada (nome/data) **antes** do deploy
      em produção. Sem aprovação, **não** aplicar (não auto-aplicável).
- [ ] Deploy em produção **apenas** após todos os itens acima marcados.

---

## 5. Mapeamento de requisitos

- **1.4** — Guarda do kill switch espelha o Whapi (mesmo ponto de decisão,
  mesma semântica de fail-open). ✅ Provado por smoke estático + paridade (§2.2)
  e diff (§1).
- **6.2** — Backup do estado anterior + rollback documentado (redeploy do
  artefato anterior). ✅ Definido em §4.3.
- **6.3** — Aprovação humana explícita, não auto-aplicável. ⛔ Gate em §4.4
  (pendente de pessoa); a mudança **não** foi deployada.
- **6.5** — Mudança de webhook validada no canal Evolution + ausência de
  regressão confirmada no Whapi antes do rollout. ✅ Evolution (automático §2) +
  estático Whapi (§3); ⛔ end-to-end manual obrigatório em §4.1/§4.2.
- **6.6** — Comportamento atual do Rafael (A/B/D no Whapi) preservado. ✅ Prova
  estática (nenhum arquivo Whapi tocado, §3); ⛔ confirmação end-to-end em §4.2.

## 6. Arquivos de evidência

- Módulo puro de gating: `supabase/functions/_shared/bot/kill-switch-gate.ts`
- Property test (Property 1): `src/test/evolution-kill-switch-gate.property.test.ts`
- Exemplo + smoke estático: `src/test/evolution-kill-switch-guard.test.ts`
- Guarda no webhook: `supabase/functions/evolution-webhook/index.ts` (topo do `Deno.serve`)
- Referência de paridade (inalterada): `supabase/functions/whapi-webhook/index.ts` (~linha 62)
