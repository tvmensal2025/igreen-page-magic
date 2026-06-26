# Auditoria — Fluxo do consultor `abelolympio` (2026-06-26)

Consultor analisado: `f9594900-e75b-4aef-b3df-51d2ea0fb41e` (`name = "abelolympio"`, `assistant_name = NULL`).
Leads inspecionados: `5511989000650`, `5514981009266` (mensagens entre 00:08 e 01:12 BRT em 2026-06-26).

## 1. Bugs encontrados e ação tomada

| # | Bug confirmado nas mensagens reais | Causa raiz | Ação |
|---|---|---|---|
| 1 | Botão "**Falar com Rafael**" aparecia para todos os leads, em **TODOS** os passos com `_buttons` | Títulos hardcoded em `bot_flow_steps.captures[]._buttons[].title` | ✅ Migration substituiu por `Falar com {{representante}}` (renderiza nome real do consultor) |
| 2 | `appendButtonsToText` enviava títulos sem renderizar `{{representante}}` | Função ignorava `vars` na renderização | ✅ `appendButtonsToText(step, text, vars)` agora aplica `renderTemplate` nos títulos antes de listar |
| 3 | "Já avisei o **abelolympio**" — vaza username/slug pro lead | `consultants.name = "abelolympio"` (slug). `firstNameOf("abelolympio") = "abelolympio"`, sem espaço pra cortar | ✅ `render-vars.ts`: detecta slug-like (1 token, minúsculo, com dígitos OU ≥9 chars) e cai pro genérico "consultor" |
| 4 | "Novo Lead" não mostrava qual persona da IA atendia | `notify-consultant.ts` mostrava "Sua IA" como fallback | ✅ Adicionada linha `🤖 *Atendido por:* <Aline ou nome configurado> (IA)`. Default "Aline" em vez de "Sua IA" |
| 5 | Formatação inconsistente na simulação rápida (linha em branco entre cada `✅`) vs simulação completa (agrupada) | `bot_flow_steps.message_text` do passo `b1a52222-…` | ✅ Migration normalizou — bullets agrupados sem `\n` extra |
| 6 | Pergunta "Como funciona" (opção 2) → bot responde "Hoje já somos mais de 700 mil pessoas economizando todos os meses" sem responder a dúvida real | Step `c87d76f8-d_como_funciona` tem só texto de oferta — não roda IA | ⚠️ **Pendente** — exige adicionar branch no flow editor / habilitar `_buttons` com `ai_answer: true` (mesmo padrão do step `d_duvidas`) |
| 7 | Nenhum lead chegou ao `portal_submitting` / OTP / link de assinatura facial | Caminho não foi atingido nos testes | ⚠️ **Pendente** validação E2E com mídia real (precisa de foto de conta de luz para acionar OCR) |
| 8 | `customers.name` ficou `NULL` mesmo após troca de mensagens | Coleta de nome só roda em steps que têm capture `name` ou via OCR da conta | ⚠️ **Pendente** — Silvia foi capturada (`name_source = user_confirmed`) porque enviou foto; quem só conversa em texto não tem nome capturado |

## 2. Mapa do fluxo end-to-end

```
welcome (d_welcome)
  ├─ "1" → flow:aee7b26c (simular) → b1a53333 (escolher tipo)
  │       ├─ "1" simulação completa → aguardando_conta → OCR → confirmando_dados_conta → portal_submitting
  │       └─ "2" simulação rápida → b1a51111 (ask valor) → b1a52222 (resultado) → c87d76f8
  ├─ "2" → c87d76f8 (d_como_funciona) — ⚠️ NÃO responde dúvida real
  └─ "3" → cadastro rápido → 279d3926 → aguardando_conta

aguardando_conta (foto)
  → OCR → confirmando_dados_conta
  → "1" confirma → d_resultado (cálculo) → 4df1f90a → 26b106c7 (continuar?)
                                              ├─ "1" → 58f0a7e2 → portal_submitting
                                              ├─ "2" → d_duvidas (IA livre)
                                              └─ "3" → aguardando_humano

portal_submitting
  → flow_template_submissions (insert)
  → worker-portal-2 (container externo) pega
  → iGreen API cria proposta
  → callback OTP → whapi-superadmin envia código
  → OTP confirmado → portal_otp_watchdog dispara link de assinatura facial
```

## 3. Riscos e pontos abertos

1. **Evolution não suporta botões interativos nativos** — todos os "botões" são renderizados como lista `1️⃣ 2️⃣ 3️⃣` em texto. O lead precisa digitar o número. Não há fix de código: é limitação da Evolution API.
2. **Step `d_como_funciona` (c87d76f8)** precisa ser convertido para passo do tipo `d_duvidas` (com `ai_answer: true`) para responder dúvida real, em vez de empurrar oferta.
3. **Worker portal-2 e watchdog OTP** rodam em containers externos (`worker-portal-2`, `portal-otp-watchdog`). Se estiverem offline, mesmo com código correto o pipeline para.
4. **`consultants.name` precisa ser preenchido** com nome humano real (não username) para cada consultor — fix de render só evita vazar o slug, mas o ideal é o cadastro do consultor ter "Abel Olympio" em vez de "abelolympio".
5. **Coleta de nome em conversas só-texto**: hoje só captura nome via OCR da conta de luz ou autoidentificação ("meu nome é X"). Leads que só respondem "1/2/3" continuam sem nome.

## 4. Arquivos alterados nesta auditoria

- `supabase/migrations/<ts>_*.sql` — UPDATE em `bot_flow_steps.captures` + `bot_messages.text` + normalização do `b1a52222`
- `supabase/functions/evolution-webhook/handlers/conversational/index.ts` — `appendButtonsToText(step, text, vars)` agora renderiza templates nos títulos
- `supabase/functions/_shared/render-vars.ts` — fallback "consultor" quando `representante` é slug
- `supabase/functions/_shared/notify-consultant.ts` — alerta NOVO LEAD inclui persona da IA e default "Aline"

## 5. Rodada 2 (2026-06-26 — pendências da auditoria fechadas)

### 5.1 Step `d_como_funciona` (c87d76f8) corrigido
- `message_text` substituído por explicação real do modelo iGreen (desconto direto na conta, mesma distribuidora, 8-20%, sem fidelidade, sem custo de entrada).
- Confirmado que `fallback.mode = "goto" → d_duvidas` (38c0d101) já roteia texto livre pro passo de IA — não precisou de `ai_answer` no próprio step.
- Limpeza: removida chave `ai_answer:true` indevida do `_buttons` capture.

### 5.2 `display_name` separado do `name` em `consultants`
- Migration adicionou coluna `display_name TEXT` (nullable) com backfill: copia `name` quando já tem espaço (nome humano real). Slugs ficam NULL para preenchimento manual.
- `_shared/render-vars.ts`: novo campo `representante_display` na `RenderVars`; prioridade `display_name → representante → "consultor"`. Heurística slug-like só roda se `display_name` não vier.
- `whapi-webhook/index.ts` e `evolution-webhook/index.ts`: agora selecionam `display_name` do consultor e usam como base de `nomeRepresentante` (com `display_name || name` como fallback).
- UI (`src/components/admin/DadosTab.tsx`): novo campo "Como o lead vai te chamar nas mensagens" (col-span 2) com placeholder usando o nome completo e dica explicando o uso.
- Hooks (`useAdminAuth`, `useConsultantForm`): leem e salvam `display_name`; default vazio no form.
- Exemplo aplicado: consultor `f9594900-…` ficou com `display_name = "Abel Olympio"`.

### 5.3 Hardcode "Rafael" residual no `d_duvidas` corrigido
- `fallback.ai_prompt` de todos os steps `d_duvidas` (6 variantes) tinha `"Você é a Rafael, assistente da iGreen Energy…"` hardcoded — substituído por `{{representante}}` via regexp_replace.

### 5.4 Rodada 3 — render do `ai_prompt` e reescrita semântica
Investigação posterior mostrou dois problemas que precisavam de fix de código + dado:

1. **`fb.ai_prompt` ia LITERAL pro LLM** — em `evolution-webhook/handlers/conversational/index.ts` e `whapi-webhook/handlers/conversational/index.ts`, o `systemPrompt` era `String(fb.ai_prompt)` sem passar por `renderTemplate`. Resultado: o LLM recebia "Você é a {{representante}}..." literal e tentava preencher sozinho (às vezes se apresentando como "{{representante}}" mesmo). ✅ Corrigido: agora ambos os webhooks chamam `renderTemplate(fb.ai_prompt, { nome, representante })` antes de mandar.
2. **Prompt estava semanticamente errado** — dizia "Você é a {{representante}}", mas `{{representante}}` é o consultor humano. ✅ Reescrito nas 6 variantes do `d_duvidas`:
   - Novo prompt: "Você é a assistente virtual da iGreen Energy, atendendo em nome de {{representante}}."
   - Regra explícita: "Nunca diga que você é o {{representante}} — você é a assistente dele(a)."
   - Limite 320 chars (era 280), no máximo 1 emoji e 1 negrito por resposta.

### 5.5 Pendentes que continuam abertos
- **Validação E2E real até portal2 → OTP → assinatura facial**: não foi executada nesta rodada (depende de teste manual com foto de conta de luz real e acompanhamento de logs do worker-portal-2 + portal_otp_watchdog). Quando rodar, documentar aqui em seção "5.6 Validação E2E".
- **`customers.name` em conversas só-texto**: continua sendo capturado apenas via OCR ou autoidentificação.
- **Evolution API sem botões interativos nativos**: limitação externa, sem fix possível.
- **3 consultores ainda com `display_name = NULL`** (`henzofelipef`, `olimpiajanete15`, `silviaclaudiaalmeida`). Cada um precisa abrir a aba Dados e preencher — auditoria deliberadamente NÃO chutou nomes humanos. Até lá, leads desses consultores recebem o termo genérico "consultor".


