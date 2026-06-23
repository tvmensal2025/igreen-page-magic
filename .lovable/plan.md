## Ajuste pedido

O Cérebro **NUNCA** pode interpretar a entrada esperada do step (e-mail em `ask_email`, SIM/NÃO em `confirmando_*`, foto em `aguardando_conta`, etc.). Cada step tem um foco único; só se a mensagem for claramente **off-topic** (pergunta sobre outro assunto), o Cérebro responde — caso contrário, é sempre determinístico.

Isso muda a regra do classificador: ele passa a ser **default = expected** (vai ao determinístico) e só marca `freeform_question` quando há sinal forte de que o lead está perguntando outra coisa.

## Contexto observado no código

1. **Origem do lead já existe na base** (`customers.customer_origin`):
   - `whatsapp_lead` / `manual` / `null` → lead novo, passa por cadastro.
   - `igreen_sync` → carteira validada (XLSX / worker).
   - `igreen_extension` → cliente já cadastrado (extensão).

2. **0 guardas de origem nos webhooks** (`whapi-webhook/index.ts`, `evolution-webhook/index.ts`). Hoje cliente sincronizado que mandar mensagem cai no cadastro e pode ir ao Portal 2.

3. **Bypass do Cérebro durante cadastro é binário** (commit 291d6fe4): se `CADASTRO_STEPS.has(stepBefore)`, pula Cérebro 100%. Lead sem resposta para perguntas livres no meio do cadastro.

## Objetivo

A. Leads com `customer_origin ∈ {igreen_sync, igreen_extension}` **nunca** entram no cadastro nem no Portal 2 — vão direto ao Cérebro.

B. Durante o cadastro, Cérebro só responde quando a mensagem é claramente **off-topic** para o step atual. Qualquer coisa que possa ser a resposta esperada (mesmo malformada) vai ao determinístico, que valida/re-pergunta.

## Mudanças propostas

### 1) Guarda de origem nos dois webhooks

Local: após carregar `customer` (~linha 1745 whapi, 1749 evolution).

```ts
const _origin = String((customer as any).customer_origin || "").toLowerCase();
const _isAtivoOrigin = _origin === "igreen_sync" || _origin === "igreen_extension";
```

Quando `_isAtivoOrigin === true`:
- Forçar `engine = "cerebro"` independente do `currentStepRaw`.
- Pular o bridge UUID→sys (capture_*).
- Não redirecionar mídia para OCR de conta/doc.
- Nunca chamar `finalize-capture` / Portal 2.
- `conversation_step` permanece como está (provavelmente `'ativo'`).

### 2) Classificador conservador (default = determinístico)

Novo arquivo: `supabase/functions/_shared/cadastro-input-classifier.ts`.

Regra **único caminho freeform_question** — todos os outros casos são `expected`:

```ts
export type CadastroInputKind = "expected" | "freeform_question";

// Cada step tem um "objetivo" — qualquer input plausível para esse objetivo
// é ENTREGUE AO DETERMINÍSTICO. Cérebro só entra quando a mensagem é
// inequivocamente off-topic (pergunta sobre outro assunto).
export function classifyCadastroInput(args: {
  stepBefore: string;
  text: string | null;
  isButton: boolean;
  hasImage: boolean;
  hasDocument: boolean;
  hasAudio: boolean;
}): CadastroInputKind {
  // 1) Mídia, botão e áudio nunca são pergunta livre — vão ao determinístico.
  if (args.isButton || args.hasImage || args.hasDocument || args.hasAudio) return "expected";

  const text = (args.text || "").trim();
  if (!text) return "expected";

  // 2) Texto curto (≤ 3 palavras) dentro do cadastro = quase sempre tentativa
  //    de responder (sim, nao, ok, meu email, cpf, etc.) → determinístico.
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 3) return "expected";

  // 3) Heurística off-topic POR STEP (objetivo da etapa).
  //    Se o texto contém marcador do objetivo da etapa → expected.
  //    Senão e tem marcador de pergunta livre → freeform_question.
  const lower = text.toLowerCase();
  const hasQuestionMark = lower.includes("?");
  const questionWords = /\b(quanto|como|porque|por que|pq|quando|onde|qual|quais|posso|vou|tenho que|é seguro|funciona|cobra|gratis|grátis|desconto)\b/;

  const stepObjectiveHit: Record<string, RegExp> = {
    ask_email:       /@|email|e-mail/i,
    capture_email:   /@|email|e-mail/i,
    ask_phone_confirm: /\d{8,}|whats|telefone|numero|número|celular|confirm/i,
    confirm_phone:     /\d{8,}|whats|telefone|numero|número|celular|confirm/i,
    confirmando_dados_conta: /^(sim|nao|não|n|s|editar|corrigir|esta certo|está certo|ok)/i,
    confirmando_dados_doc:   /^(sim|nao|não|n|s|editar|corrigir|esta certo|está certo|ok)/i,
    aguardando_conta:        /conta|luz|energia|foto|fatura|enviei|mandei/i,
    aguardando_doc_auto:     /doc|rg|cnh|identidade|foto|enviei|mandei/i,
    capture_conta:           /conta|luz|energia|foto|fatura/i,
    capture_documento:       /doc|rg|cnh|identidade|foto/i,
    ask_finalizar:           /^(sim|nao|não|finaliza|terminar|ok|pode)/i,
    finalizar_cadastro:      /^(sim|nao|não|finaliza|terminar|ok|pode)/i,
  };

  const objective = stepObjectiveHit[args.stepBefore];
  if (objective && objective.test(text)) return "expected";

  // Tem sinal de pergunta E NÃO casa com objetivo do step → Cérebro.
  if (hasQuestionMark || questionWords.test(lower)) return "freeform_question";

  // Padrão seguro: na dúvida, determinístico (re-prompt corrige).
  return "expected";
}
```

Substituir nos dois webhooks a condição:
```ts
} else if (((hasImage || hasDocument) && !hasAudio) || CADASTRO_STEPS.has(stepBefore)) {
```
por:
```ts
const _cadKind = CADASTRO_STEPS.has(stepBefore)
  ? classifyCadastroInput({ stepBefore, text: messageText, isButton, hasImage, hasDocument, hasAudio })
  : null;
const _emCadastroExpected = _cadKind === "expected";
const _emCadastroFreeform = _cadKind === "freeform_question";
const _midiaOcr = (hasImage || hasDocument) && !hasAudio;

if (_midiaOcr || _emCadastroExpected) {
  // → 100% determinístico, igual hoje
} else if (_emCadastroFreeform) {
  // → Cérebro responde em readOnly e NÃO roda determinístico no turno
  const r = await responderComCerebro({ ..., readOnly: true });
  // não mexer em conversation_step, customer_flow_state, hashes
  return ok(); // encerra turno
} else {
  // fluxo conversacional normal (welcome/qualificacao)
}
```

### 3) `responderComCerebro({ readOnly: true })`

Novo parâmetro em `supabase/functions/_shared/cerebro/resposta-hook.ts`. Quando `readOnly`:
- Permite gerar e enviar texto.
- **Bloqueia** qualquer write em `customers.conversation_step`, `customer_flow_state.current_step_id`, `next_followup_at`, contadores de retry.
- **Não** muda `last_outbound_content_hash` do step atual (usar chave separada `last_freeform_hash`) — assim o próximo re-prompt determinístico ainda passa pelo dedupe normal.

### 4) Proteção em `finalize-capture`

No topo do handler: se `customer.customer_origin ∈ {igreen_sync, igreen_extension}` → 200 + log, sem criar idcliente no Portal 2.

### 5) Testes Deno

- `cadastro-input-classifier_test.ts`:
  - `ask_email` + `"meuemail@x.com"` → expected
  - `ask_email` + `"meu email é joao arroba"` → expected (contém `email`)
  - `ask_email` + `"quanto vou economizar por mês?"` → freeform_question
  - `confirmando_dados_conta` + `"sim"` → expected
  - `confirmando_dados_conta` + `"como funciona a energia solar?"` → freeform_question
  - `aguardando_conta` + foto → expected
  - `ask_phone_confirm` + `"11999999999"` → expected
  - Texto curto qualquer (`"ok"`, `"hum"`) em qualquer step → expected
- `webhook-origin-guard_test.ts`: stub com `customer_origin='igreen_extension'` não chama `runBotFlow` nem `finalize-capture`.

### 6) Sem migrations

Tudo lê de colunas existentes. Sem backfill — os 583 leads param de ser empurrados ao Portal 2 a partir do próximo turno.

## Arquivos tocados

- `supabase/functions/whapi-webhook/index.ts` (guard de origem + classifier)
- `supabase/functions/evolution-webhook/index.ts` (idem)
- `supabase/functions/_shared/cadastro-input-classifier.ts` (novo)
- `supabase/functions/_shared/cerebro/resposta-hook.ts` (suportar `readOnly`)
- `supabase/functions/finalize-capture/index.ts` (guard de defesa)
- Testes Deno correspondentes

## Riscos e mitigação

- **Cérebro responder onde não devia**: classificador é default=expected; só dispara Cérebro com sinal forte de pergunta livre (`?` ou palavra interrogativa) E sem hit no objetivo do step. Texto curto e mídia nunca viram freeform.
- **Cérebro confundindo input válido**: `readOnly=true` impede qualquer mudança de estado — mesmo se Cérebro respondesse errado, o step continua intacto e re-pergunta no próximo turno.
- **Cliente sincronizado que precisa recadastrar**: fora de escopo; exige re-classificação manual de `customer_origin`.
