# 17 — Unificação parcial dos webhooks Whapi ↔ Evolution

> **Última atualização:** 18/06/2026 (revisão de precisão: contagens `git HEAD`, exceção `hasAudio`, diff 6240)  
> **Status:** **ENCERRADA na Etapa 3a** (decisão consciente — ver §2)  
> **Escopo:** apenas a consolidação de código duplicado entre `whapi-webhook` e `evolution-webhook`.

---

## ⚠️ Não confundir com outras auditorias / fases

Este documento é **exclusivo** da iniciativa *“unificar espelhos Whapi/Evolution em `_shared/bot/`”*.  
Outros trabalhos feitos no mesmo período têm **objetivo, arquivos e critério de sucesso diferentes**:

| Trabalho | O que foi | Onde está documentado |
|----------|-----------|------------------------|
| **Auditoria geral do portal** (estrutura, perfis, fluxos, checklist) | Somente leitura | `docs/auditoria/01`–`16` (série original, jun/2026) |
| **Fase 1 — Segurança** (LGPD logs, `webhook-auth`, RPCs, `get_platform_pnl`) | Aplicada + deploy | Código: `_shared/log-redact.ts`, `_shared/webhook-auth.ts`; migrações Supabase |
| **Fase 2 — Buckets** (listagem anônima fechada) | Parcial | Decisão registrada na conversa de implementação |
| **Fase 3 — Portal 2** (`portal_kind`, OTP → worker correto) | Aplicada + deploy | `submit-otp`, `otp-intercept.ts`, `_shared/portal-worker.ts` |
| **Fase 4 — Frontend** (“Esqueci minha senha”) | Aplicada no código | `src/pages/Auth.tsx` |
| **Este doc (17)** | Unificação webhook **parcial** | Aqui |

Mudanças colaterais mínimas em arquivos grandes **fora** desta unificação (mas no mesmo branch):

- `bot-flow.ts` (ambos): mascaramento de e-mail em log `[ask_phone]` — **Fase 1 LGPD**, não unificação.
- `otp-intercept.ts`: roteamento OTP por `portal_kind` — **Fase 3 Portal 2**, não unificação.

---

## 1. Objetivo desta iniciativa

Reduzir **cópias idênticas ou quase idênticas** entre:

- `supabase/functions/whapi-webhook/`
- `supabase/functions/evolution-webhook/`

**Padrão adotado:**

1. Criar **fonte única** em `supabase/functions/_shared/bot/<nome>.ts`
2. Transformar o arquivo local em **shim** (re-export nomeado — sem `export *`)
3. **Não alterar** importadores dos módulos unificados (paths `./state-machine.ts`, `./templates.ts`, etc.). **Exceção documentada:** `hasAudio` passado em `index.ts` (ambos webhooks) e guarda `!ctx.hasAudio` em `whapi-webhook/handlers/conversational/index.ts` (1 linha) — ver §6. `bot-flow.ts` não foi alterado por esta iniciativa.
4. Fornecer **script de reversão** por etapa
5. Validar: `deno test` + `deno check` + deploy + smoke OPTIONS 200

**Regra de canal preservada:** Whapi = botões nativos; Evolution = lista numerada no texto (paridade funcional, implementação distinta).

---

## 2. Decisão: PARAR na Etapa 3a

**Data da decisão:** 18/06/2026  

**Motivo:** Etapas 3b–3d (`conversational/index.ts`, `bot-flow.ts`, `index.ts`, `_helpers.ts`) somam **~6.240 linhas de diff real** (medido jun/2026) e alto risco de regressão em OCR, portal e UX botão vs número. O **melhor custo/benefício** já foi obtido nas Etapas 1–2–3a + correção `hasAudio`.

**O que permanece duplicado (aceito):**

| Arquivo | Linhas diff (Whapi vs Evolution) | Mantido assim até nova iniciativa |
|---------|----------------------------------|-----------------------------------|
| `handlers/conversational/index.ts` | ~977 | Sim |
| `handlers/bot-flow.ts` | ~1624 | Sim |
| `index.ts` | ~3554 | Sim |
| `_helpers.ts` | ~85 | Sim |

**Retomar somente se:** refatoração grande no fluxo conversacional/OCR, bug de divergência entre canais, ou projeto dedicado com E2E antes/depois.

---

## 3. Mapa resumido — como estava × como ficou

### 3.1 Arquivos unificados (ANTES → DEPOIS)

| Arquivo local (×2 webhooks) | ANTES | DEPOIS |
|-----------------------------|-------|--------|
| `handlers/conversational/state-machine.ts` | **116 linhas** duplicadas idênticas em cada webhook (`git HEAD`) | Shim ~5 linhas → `_shared/bot/conversational-state-machine.ts` (121 linhas) |
| `handlers/step-namespace.ts` | **62 linhas** duplicadas idênticas (`git HEAD`) | Shim ~5 linhas → `_shared/bot/step-namespace.ts` (67 linhas) |
| `handlers/types.ts` | ~57–60 linhas **quase iguais** (Evolution tinha `hasAudio?`) | Shim ~9 linhas → `_shared/bot/handler-types.ts` (superset) |
| `handlers/conversational/intent-classifier.ts` | ~224 linhas **quase iguais** (regex e `channel` diferiam) | Shim ~24 linhas injeta `channel` → `_shared/bot/intent-classifier.ts` |
| `handlers/conversational/templates.ts` | ~127 linhas **53 linhas de diff** | Shim ~7 linhas → `_shared/bot/conversational-templates.ts` (superset) |

### 3.2 Fontes únicas criadas em `_shared/bot/`

```
_shared/bot/
  conversational-state-machine.ts   ← Etapa 1
  step-namespace.ts                 ← Etapa 1
  handler-types.ts                  ← Etapa 2
  intent-classifier.ts              ← Etapa 2
  conversational-templates.ts       ← Etapa 3a
```

*(Outros arquivos em `_shared/bot/` — `dedupe.ts`, `cadastro-intent.ts`, etc. — **já existiam antes** desta iniciativa.)*

### 3.3 Arquivos **não** unificados (estrutura duplicada mantida)

| Arquivo | Whapi (linhas) | Evolution (linhas) | Diff | Nota |
|---------|---------------:|-------------------:|-----:|------|
| `handlers/conversational/index.ts` | 2780 | 2527 | 977 | Whapi: **+1 linha** `!ctx.hasAudio` (§6); Evolution já tinha a guarda |
| `handlers/bot-flow.ts` | 6054 | 5596 | 1624 | Sem mudança estrutural desta iniciativa |
| `index.ts` | 2060 | 2526 | 3554 | **+propagação `hasAudio`** em `runConversationalFlow`/`runBotFlow` (§6) |
| `_helpers.ts` | 63 | 136 | 85 | Não tocado |

---

## 4. Etapa 1 — `state-machine` + `step-namespace`

**Quando:** jun/2026 (primeira fatia da unificação)  
**Critério:** `diff = 0` entre os dois webhooks.

### Antes

- Dois arquivos físicos com **conteúdo idêntico** em:
  - `whapi-webhook/handlers/conversational/state-machine.ts`
  - `evolution-webhook/handlers/conversational/state-machine.ts`
  - `whapi-webhook/handlers/step-namespace.ts`
  - `evolution-webhook/handlers/step-namespace.ts`
- Qualquer correção exigia editar **4 paths** (ou 2 pares em sincronia manual).

### Depois

- Fonte única:
  - `_shared/bot/conversational-state-machine.ts` — `decideTransition`, intents, steps conversacionais
  - `_shared/bot/step-namespace.ts` — `isFlowStep`, `stripPrefix`, `routeEngine`, `normalizeOutgoing`
- Shims re-exportam tipos e funções; imports em `conversational/index.ts` **inalterados** (`./state-machine.ts`, `../step-namespace.ts`).

### Validação Etapa 1

- `deno test`: state-machine + step-namespace (ambos webhooks) — **102 testes** OK
- `deno check` webhooks OK
- Deploy `whapi-webhook` + `evolution-webhook` OK
- Smoke OPTIONS **200** em ambos

---

## 5. Etapa 2 — `types` + `intent-classifier`

**Quando:** jun/2026  
**Critério:** quase idênticos; unificar com **superset** + parâmetro de canal.

### 5.1 `handler-types.ts` (ex-`types.ts`)

#### Antes

| Campo / aspecto | Whapi | Evolution |
|-----------------|-------|-----------|
| `BotContext` base | Igual | Igual + `hasAudio?: boolean` |
| `EvolutionSender` | `any` | `any` |
| Comentário `instanceName` | “Whapi” | “Evolution” |

#### Depois

- `_shared/bot/handler-types.ts`:
  - `BotContext` com **`hasAudio?` opcional** (superset)
  - `ChannelSender` + alias `EvolutionSender` nos shims (API legada preservada)
  - Comentário neutro em `instanceName`
- Shims: `handlers/types.ts` (9 linhas cada)

### 5.2 `intent-classifier.ts`

#### Antes

| Aspecto | Whapi | Evolution |
|---------|-------|-----------|
| Regex `afirmacao` | `^sim`, `^1$`, emoji no início simples | `isso`, `aceito`, flag `iu`, emoji com espaço |
| Regex `negacao` | mais simples | mais robusta |
| `logAiDecision.channel` | `"whapi"` hardcoded | `"evolution"` hardcoded |
| Comentário simulador | 2 linhas extras | ausente |

#### Depois

- `_shared/bot/intent-classifier.ts`:
  - Regex canônica = **versão Evolution** (mais robusta)
  - `classifyIntent(..., ctx: ClassifyContext)` com **`channel` obrigatório** na fonte única
- Shims injetam `channel: "whapi"` ou `"evolution"` **sem mudar** `conversational/index.ts`

**Mudança comportamental intencional no Whapi:**

| Entrada | Whapi antigo | Unificado |
|---------|--------------|-----------|
| `"isso"` | não regex → LLM | `afirmacao` (0.95) |
| `" 👍"` | não regex | `afirmacao` |
| `"aceito"` | `quer_cadastrar` | `quer_cadastrar` (inalterado — prioridade da regex) |

### Validação Etapa 2

- `deno test` intent-classifier ×2 + etapa 1 — **140 testes** OK (somente módulos unificados)
- Opcional na mesma sessão: +12 testes Fase 1 Segurança (`log-redact`, `webhook-auth`) → **152** no total — **não** fazem parte desta iniciativa
- `deno check` OK
- Deploy OK

---

## 6. Correção `hasAudio` (pós-Etapa 2, antes de encerrar)

**Problema mapeado:** `hasAudio?` existia no tipo (Evolution) e era usado em código, mas **`index.ts` de ambos os webhooks não passava `hasAudio`** ao montar `BotContext`. A guarda `!ctx.hasAudio` em `evolution-webhook/handlers/conversational/index.ts` (OCR) estava **inerte**.

### Antes

```ts
// index.ts (ambos) — runConversationalFlow / runBotFlow
hasImage, hasDocument, imageMessage, ...  // hasAudio ausente
```

Whapi `conversational/index.ts`: redirecionamento foto→OCR **sem** `!ctx.hasAudio`.

### Depois

| Arquivo | Mudança |
|---------|---------|
| `whapi-webhook/index.ts` | `hasAudio` passado em `runConversationalFlow` e `runBotFlow` |
| `evolution-webhook/index.ts` | idem |
| `whapi-webhook/handlers/conversational/index.ts` | `!ctx.hasAudio` na guarda de OCR (paridade Evolution) |

**Nota:** `evolution-webhook/handlers/bot-flow.ts` já usava `hasAudio` no bloco PHOTO_REDIRECT; Whapi `bot-flow.ts` ainda **não** tem esse bloco — divergência pré-existente, **fora do escopo** desta parada.

---

## 7. Etapa 3a — `conversational/templates.ts`

**Quando:** jun/2026  
**Última fatia aplicada antes do encerramento.**

### Antes

~127 linhas cada webhook, **53 linhas de diff**:

| Aspecto | Whapi | Evolution |
|---------|-------|-----------|
| `parseValor` / helpers | função dedicada `parseValor` | `parseValorNum` separado |
| `representante` vazio | `trim()` + fallback `"iGreen Energy"` | `vars.representante \|\| "iGreen Energy"` |
| Anti-vazamento `{{var}}` | ausente | `if (/\{\{...\}\}/.test(out)) return ""` |
| Limpeza markdown órfão | sim | sim |

### Depois

- `_shared/bot/conversational-templates.ts` — **superset**:
  - `parseValor` + trim robusto do representante (Whapi)
  - guard anti-placeholder `{{var}}` (Evolution)
- Shims: 7 linhas cada; `diff = 0` entre shims
- Imports inalterados: `from "./templates.ts"` em `conversational/index.ts`; Evolution `bot-flow.ts` importa `getTemplate` do mesmo path relativo

### Validação Etapa 3a

- `deno check` webhooks + conversational + bot-flow OK
- Deploy OK

---

## 8. Scripts de reversão

| Script | Reverte |
|--------|---------|
| `scripts/revert-webhook-unify.sh` | **Tudo:** Etapas 1 + 2 + 3a (10 shims + 5 fontes `_shared/bot/`) |
| `scripts/revert-webhook-unify-stage2.sh` | Só Etapa 2 (`types` + `intent-classifier`) |
| `scripts/revert-webhook-unify-stage3a.sh` | Só Etapa 3a (`templates`) |

*Não há script “só Etapa 1”; para reverter apenas state-machine/step-namespace, usar `git checkout HEAD` nos 4 shims correspondentes e remover os 2 arquivos em `_shared/bot/`.*

**Premissa:** `git checkout HEAD -- <shims>` restaura conteúdo **pré-unificação** enquanto as mudanças não forem commitadas. Após commit, usar `git revert` do commit da unificação.

Cada script termina com `deno check whapi-webhook/index.ts evolution-webhook/index.ts`.

---

## 9. Deploy e smoke test

| Função | Project ref | Status |
|--------|-------------|--------|
| `whapi-webhook` | `zlzasfhcxcznaprrragl` | Deployado após Etapas 1, 2, 3a e `hasAudio` |
| `evolution-webhook` | idem | idem |

Smoke: `OPTIONS` nos endpoints das functions → **HTTP 200**.

---

## 10. Estado do repositório (pendência)

**Ao encerrar (18/06/2026), alterações da unificação ainda não commitadas** — recomendado um commit dedicado, por exemplo:

```
refactor(webhooks): unificar espelhos whapi/evolution em _shared/bot (etapas 1–3a)

Consolida state-machine, step-namespace, types, intent-classifier e templates
com shims reversíveis. Corrige passagem de hasAudio no BotContext.
Etapas 3b–3d (conversational/index, bot-flow, index) adiadas.
```

Arquivos novos principais:

- `supabase/functions/_shared/bot/conversational-state-machine.ts`
- `supabase/functions/_shared/bot/step-namespace.ts`
- `supabase/functions/_shared/bot/handler-types.ts`
- `supabase/functions/_shared/bot/intent-classifier.ts`
- `supabase/functions/_shared/bot/conversational-templates.ts`
- `scripts/revert-webhook-unify*.sh`

---

## 11. Roadmap **não** executado (referência futura)

| Etapa | Alvo | Diff | Risco | Notas |
|-------|------|-----:|-------|-------|
| **3b** | `handlers/conversational/index.ts` | ~977 | Médio-alto | Exige adaptador envio: Whapi `sendButtons` vs Evolution texto numerado |
| **3c** | `handlers/bot-flow.ts` | ~1624 | Alto | OCR, portal, steps UUID |
| **3d** | `index.ts` | ~3554 | Muito alto | **Não** fundir num arquivo — extrair shared + entrypoints finos |
| — | `_helpers.ts` | ~85 | Baixo | Pode ser 3b-lite |

---

## 12. Checklist de verificação pós-encerramento

- [x] Fontes únicas Etapas 1, 2, 3a em `_shared/bot/`
- [x] Shims preservam paths de import
- [x] `hasAudio` propagado nos `index.ts`
- [x] Scripts de reversão por etapa
- [x] `deno test` + `deno check` verdes nas fatias unificadas
- [x] Deploy produção nos dois webhooks
- [x] Decisão de parar documentada
- [ ] **Commit** dedicado (recomendado)
- [x] Etapas 3b–3d explicitamente **fora de escopo** até nova aprovação (encerramento na 3a)

---

## 13. Referências cruzadas

- Paridade Whapi/Evolution (visão geral): `mem/whatsapp/evolution-parity.md`
- Motor `bot-flow` e contrato `bot_flow_steps`: `DOCUMENTATION.md`
- Mapeamento frontend WhatsApp (hook `useWhatsApp`): `docs/auditoria/15-mapeamento-whatsapp.md`
- Plano de correção por fases (série 11 — **numeração diferente**): `docs/auditoria/11-plano-de-correcao.md`
