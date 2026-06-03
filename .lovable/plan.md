## Problema

Lead 5511971254913 perguntou "Quanto tempo demora para chegar o desconto?" no passo `d_duvidas`. A IA respondeu, mas nenhuma opção foi enviada (nem botão no Whapi, nem lista numerada no Evolution).

Duas causas combinadas:

1. **Passo `d_duvidas` (id `38c0d101…`) está sem `captures._buttons`.** A refatoração v2 zerou os botões — sobrou só o capture de texto `duvida_livre`.
2. **Dispatcher do `ai_answer` envia apenas `sendText`** (`whapi-webhook/handlers/conversational/index.ts` linha ~2571). Os botões do passo não são re-emitidos depois da fala da IA.

## Mudanças

### 1. Passo `d_duvidas` — restaurar botões (sem bagunçar outros passos)

Como o runtime só avalia `transitions` do **passo atual**, não há cross-step. Mas pra blindar contra falso-positivo dentro do próprio passo:

- **Match principal por ID do botão**, não por texto. Whapi envia `button.id`; Evolution numerado mapeia 1/2/3 → id pela posição.
- **`trigger_phrases` minimalistas** (só pra quem digita em vez de clicar).

Atualizar `bot_flow_steps.captures` do step `38c0d101-6492-4b1e-8229-c676c804161a`:

`captures._buttons`:
- `cadastrar` → "✅ Cadastrar agora"
- `nova_pergunta` → "💬 Fazer mais uma pergunta"
- `humano` → "👤 Falar com Rafael"

`transitions`:
- `trigger_intent: cadastrar`, phrases: `["cadastrar", "quero cadastrar"]` → `goto_step_id: 58f0a7e2-…` (já existente).
- `trigger_intent: nova_pergunta`, **phrases: []** → `goto_special: "repeat"`. Sem frases: se o lead digitar qualquer outra coisa, cai no `fallback: ai_answer` (que já é "responder mais uma pergunta"). O botão é só atalho visual.
- `trigger_intent: humano`, phrases: `["humano", "atendente", "rafael", "falar com rafael"]` → `goto_special: "humano"` (já existente).

A transition antiga de `simular` é removida (não foi pedida e poderia competir com perguntas sobre simulação).

`fallback` permanece `mode: "ai_answer"`, `after_ai: "stay"`. Substituir "Camila" por "Rafael" no `ai_prompt`.

### 2. Dispatcher `ai_answer` — re-emitir botões do passo após resposta da IA

Em `supabase/functions/whapi-webhook/handlers/conversational/index.ts`, no bloco `if (fb.mode === "ai_answer" …)` (linha ~2542), após o `sendText(aiText)`:

- Ler `currentStep.captures._buttons`.
- Se houver botões, mandar uma segunda mensagem com prompt curto `"👇 É só escolher uma opção:"` + botões, usando o mesmo helper já usado nos passos normais (`renderChoice` em `_shared/channels/dispatch-choice.ts`). Isso resolve Whapi (botão real) e Evolution (lista numerada) automaticamente.
- Gravar `conversations` insert da segunda mensagem (outbound, mesmo `conversation_step`).
- Em caso de erro no envio dos botões, logar warning e seguir — não falhar o turno.

Assim a IA responde e o lead recebe na sequência as 3 opções. Vale para **todos** os passos `ai_answer` que tiverem botões configurados.

### Fora de escopo

- `_shared/ai-faq-answerer.ts` (outro caminho, não usado aqui).
- Outros passos com `ai_answer` — a mudança no dispatcher já cobre todos automaticamente quando tiverem `_buttons`.
- Mudanças no prompt da IA além do nome.

## Verificação

- "Quanto tempo demora?" via Whapi → resposta da IA + 3 botões reais.
- Mesma pergunta via Evolution → resposta + `*1.* Cadastrar agora / *2.* Fazer mais uma pergunta / *3.* Falar com Rafael`.
- Clicar/digitar `cadastrar` → avança pro passo de cadastro. `humano` → handoff. `nova pergunta` ou qualquer outra dúvida → IA responde de novo até `max_questions`.
