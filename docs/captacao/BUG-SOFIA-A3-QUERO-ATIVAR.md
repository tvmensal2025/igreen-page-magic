# BUG — Sofia Multicanal: a3 não avança com “Quero ativar”

> **Status:** aberto · evidência em produção (sandbox) · precisa de correção por outra IA  
> **Prioridade:** alta (bloqueia cadastro → portal/facial)  
> **Data:** 2026-07-17  
> **Projeto:** `zlzasfhcxcznaprrragl` · consultor Rafael Ferreira

---

## Objetivo do fluxo (o que deveria acontecer)

Fluxo **Sofia — Ativação Multicanal** (`59f53614-196c-4b6f-a029-59fadca78bd7`, **variant C**):

```
a1 pedir nome
 → a2 áudio+texto pedir valor da conta
 → a3 explicação + botões
      ├─ "Saber mais benefício" → a5b clube → Cadastrar → a6
      ├─ "Quero ativar" / activate     → a6 foto da conta (OCR)
      └─ "Falar com humano"            → handoff
 → a6 conta → a7 doc → a8 email → a9 telefone
 → a10 portal OTP/facial → a11 link facial
```

**Bug atual:** lead chega em **a3** (nome + valor OK) e **qualquer** “Quero ativar” / botão `activate` / número `2` **só reemite o a3** (áudio + botões). `conversation_step` **não muda**.

---

## Evidência (não chute)

### Ambiente de teste

| Campo | Valor |
|---|---|
| Phone sandbox | `550000021189303` |
| Customer | `915daf02-8765-4b89-a90c-6cd64c23e6d5` |
| `flow_variant` | `C` |
| `is_sandbox` | `true` |
| Step a3 | `975c4ab2-0b8c-4f10-89c3-09ed7eacc270` (`a3_explain_with_buttons`) |
| Step a6 destino | `f21b3d40-0ca5-4fdd-a5d3-534b0791cb64` (`a6_ask_bill_photo`, `capture_conta`) |
| Engine V3 | `use_engine_v3=false`, `flow_engine_v3=off` |

### Transições no DB (a3) — corretas

```json
[
  { "trigger_phrases": ["more_benefits", "Saber mais benefício"], "goto_step_id": "d09005f4-…" },
  { "trigger_phrases": ["activate", "Quero ativar"], "goto_step_id": "f21b3d40-…" },
  { "trigger_phrases": ["human", "Falar com humano"], "goto_special": "humano" }
]
```

`fallback.mode = "repeat"` ← quando `matchTransition` devolve `null`, o motor **repete a3**.

### Testes HTTP no sandbox (2026-07-17)

Todos com `whapi-webhook` + `x-bot-test-mode` + `bot_test_runs`:

| Input | HTTP | Resultado |
|---|---|---|
| texto `"Quero ativar"` | 200 `ok` | **fica em a3** · outbound = áudio a3 + botões a3 de novo |
| botão `buttons_reply` id=`activate` | 200 `ok` | **fica em a3** · mesma reemissão |
| texto `"2"` (2º botão) | 200 `ok` | **fica em a3** · mesma reemissão |
| formato ERRADO `button_reply` (singular) | 200 `msg:empty` | parse Whapi ignora (bug de **harness E2E**, não do motor) |

Trecho real de `bot_test_outbound` após “Quero ativar”:

- `kind=media:audio` → stitch `a3_explain_with_buttons`
- `kind=buttons` → texto `Perfeito, Maria! … R$ 350,00 …` (mensagem do **a3**)
- `conversation_step` no customer: ainda `flow:975c4ab2-…`

### Unitário local (Deno) — `matchTransition` FUNCIONA

```ts
matchTransition({ transitions: a3, messageText: "Quero ativar" }) // → a6
matchTransition({ transitions: a3, buttonId: "activate", buttons }) // → a6
matchTransition({ transitions: a3, messageText: "2", buttons }) // → a6
```

**Conclusão:** a regra de matching no código local está certa; **em runtime o turno cai no `fallback.repeat`** (transition efetivamente `null` no caminho que rodou, ou o avanço é desfeito / nunca persistido). Precisa achar **qual branch** do `runConversationalFlow` está vencendo antes/depois do `matchTransition`.

---

## O que JÁ foi corrigido (e deployado) — NÃO é o a3

Arquivos: `whapi-webhook` + `evolution-webhook` (handlers conversational + index).

1. **a1→a2 (nome):** `resolveLandingStep` prendia por `slot_key`; `emitCurrentBeforeGoto` reemitia pergunta; `\bnome\b` não casava `a1_ask_name`; `name_ask_sent_at` no restart.
2. **a2→a3 (valor):** mesmo padrão de skip pós-captura.
3. Validado: `oi` → `Maria` → `350` chega em **a3** com botões.

**Falta:** a3 → a6 (e seguir até a10/a11).

---

## Hipóteses para a outra IA (ordem sugerida)

### H1 — Transição nunca casa no runtime (mais provável pelo sintoma)

Investigar em `whapi-webhook/handlers/conversational/index.ts`:

- `currentStep.transitions` chega vazio/`null` no edge (JSONB parse)?
- Early return **antes** de `matchTransition` (~linha 2044) que ainda emite a3:
  - `matchQA` / FAQ
  - `cls.action === "handoff"` + `matchButtonIntent` confused/refused
  - orch `tem_duvida`
- `extractStepButtons(currentStep)` vazio → número `2` não resolve botão
- Logs: adicionar `console.log` com `buttonId`, `messageText`, `transitionsLen`, resultado de `matchTransitionShared`

### H2 — Casa a transição, mas `rewriteActivateAwayFromSimPath` / `hasBillReady` bagunça

Em `_shared/bot/flow-activate-routing.ts`:

```ts
hasBillReady(customer) // true se electricity_bill_value > 0
```

No Sofia o lead **já tem valor digitado (350)** mas **ainda não tem foto OCR**.  
`rewriteActivateAwayFromSimPath` pode reescrever `a6 capture_conta` → documento porque “já tem conta”.

**Isso sozinho NÃO explica ficar no a3** (deveria ir pra doc/`aguardando_doc_*`).  
Só importa depois de a transição passar. Ainda assim: **para Sofia, valor digitado ≠ conta pronta** — corrigir `hasBillReady` para exigir foto/`bill_data_confirmed_at` (não só valor).

### H3 — Harness E2E enganoso (parcialmente verdade)

- Whapi real usa `reply.type = "buttons_reply"` (plural), **não** `button_reply`.
- Teste antigo com `button_reply` → `msg:empty` (falso negativo).
- Sandbox (`is_sandbox` + mock sender) **não** muda `matchTransition` (só delays/outbound em `bot_test_outbound`).
- Sintoma a3-repeat reproduz **com payload correto** no sandbox → **não é só teste**.

### H4 — Deploy desatualizado / bundle

Confirmar que o edge `whapi-webhook` em produção é o commit deste PR (`supabase functions deploy whapi-webhook --no-verify-jwt`).  
Deploy com `--use-api` já quebrou bundle antes (faltou `attendance-flow.ts`).

---

## Como reproduzir (sandbox, seguro)

```python
# phone 550000021189303 · customer 915daf02-… · variant C
# 1) PATCH conversation_step = flow:975c4ab2-0b8c-4f10-89c3-09ed7eacc270
# 2) POST whapi-webhook com:

# TEXTO
{"messages":[{"id":"…","from_me":false,"type":"text",
  "chat_id":"550000021189303@s.whatsapp.net","from":"550000021189303",
  "text":{"body":"Quero ativar"}}],"event":{"type":"messages"}}

# BOTÃO (formato Whapi correto)
{"messages":[{"id":"…","from_me":false,"type":"reply",
  "chat_id":"550000021189303@s.whatsapp.net","from":"550000021189303",
  "reply":{"type":"buttons_reply",
           "buttons_reply":{"id":"activate","title":"Quero ativar"}}}],
 "event":{"type":"messages"}}

# Headers: Authorization anon, x-bot-test-run-id, x-bot-test-mode:1
# Esperado: conversation_step → a6 UUID ou aguardando_conta
# Atual: continua flow:975c4ab2-… e reemite a3
```

---

## Critério de aceite

1. Em a3, texto `"Quero ativar"` **ou** botão `activate` **ou** `"2"` → avança para **a6** (`capture_conta` / `aguardando_conta`), **sem** reemitir a3.
2. Valor digitado (ex. 350) **não** pula a foto da conta (`hasBillReady` exige evidência de conta real).
3. E2E Python no sandbox: `oi` → nome → valor → ativar → (inject conta/doc/email/tel se OCR falhar) → chega em **a10** ou `aguardando_otp` / facial.
4. Mesma correção espelhada em `evolution-webhook`.
5. **Não** reativar envio automático em massa; só sandbox / dryRun.

---

## Arquivos-chave

| Arquivo | Por quê |
|---|---|
| `supabase/functions/whapi-webhook/handlers/conversational/index.ts` | `matchTransition`, fallback.repeat, handoff, emitStep |
| `supabase/functions/evolution-webhook/handlers/conversational/index.ts` | paridade |
| `supabase/functions/_shared/flow-router.ts` | `matchTransition`, `_phraseMatchesText` |
| `supabase/functions/_shared/bot/flow-activate-routing.ts` | `hasBillReady`, `rewriteActivateAwayFromSimPath` |
| `supabase/functions/_shared/whapi-api.ts` | `parseWhapiMessage` → `buttons_reply` |
| `supabase/functions/whapi-webhook/index.ts` | roteamento flow vs sys, testMode |

---

## IDs dos passos Sofia (variant C)

| key | id |
|---|---|
| a1_ask_name | `98287e05-a9e9-4490-bbcd-b87faf2956c9` |
| a2_text_ask_bill_value | `d247403b-81fd-4a2a-89f3-b8bc6f1bc9ca` |
| a3_explain_with_buttons | `975c4ab2-0b8c-4f10-89c3-09ed7eacc270` |
| a5b_after_club_buttons | `d09005f4-b8ab-471b-af47-d3618fadc275` |
| a6_ask_bill_photo | `f21b3d40-0ca5-4fdd-a5d3-534b0791cb64` |
| a7_ask_document | `803064fa-c34a-42ab-bc55-7c90e062abf2` |
| a8_ask_email | `95cbb03b-c342-4953-848f-500fce201f8b` |
| a9_confirm_phone | `6593cfe3-16b9-4bab-a889-fa1cc6e795a6` |
| a10_portal_otp_facial | `d3f9b3c8-a527-4fdb-871f-af29593d1f23` |
| a11_facial_link | `61683988-21ca-41d4-bdfb-b9dc6da7cde5` |

---

## Pedido explícito à próxima IA

1. **Auditar** o turno a3 com log mínimo (sem chute).  
2. **Corrigir** para a transição `activate` / `Quero ativar` avançar.  
3. **Ajustar** `hasBillReady` para Sofia (valor ≠ foto).  
4. **Validar** E2E sandbox até portal/facial.  
5. **Não apagar** código/migrations; mudança incremental.  
6. Responder em **PT-BR**.
