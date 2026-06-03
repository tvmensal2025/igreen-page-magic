## Fluxo B — IA livre conversacional do início ao fim

A IA do Fluxo B (Lovable AI Gateway: cascata **Gemini 3 Flash → GPT-5.5**) assume a conversa inteira. Em vez de seguir 10 passos pré-escritos, ela recebe um **super prompt editável no painel admin** e decide o que falar a cada turno. Coletas críticas (foto da conta, documento) continuam pelos handlers determinísticos atuais — a IA só **chama** esses passos via tool-calling quando entender que o lead está pronto.

---

## Arquitetura

### 1. Disparo do fluxo
- Quando `customer.flow_variant = "B"` chega no `whapi-webhook`, em vez de despachar `bot_flow_steps` por position, redireciona para o novo handler `fluxo-b-ai`.
- O primeiro turno (lead novo) também roda pela IA — ela mesma faz a boas-vindas usando o super prompt.

### 2. Nova edge function `fluxo-b-ai`
Núcleo do Fluxo B. A cada mensagem inbound:
1. Carrega `customer`, últimos ~20 turnos de `conversations`, `consultants.ai_persona_fluxo_b` (super prompt editável), `consultants.name` (nome do representante), `conversation_summary` (memória longa).
2. Triagem barata (`google/gemini-3-flash-preview`) classifica: continuar com IA, escalar humano, ou pular pra captura determinística (lead acabou de mandar imagem).
3. Se continuar: chama Gemini 3 Flash com `tools=[registrar_nome, pedir_foto_conta, pedir_documento, finalizar_cadastro, escalar_humano]` + super prompt + histórico.
4. Em casos difíceis (lead reclama, faz objeção complexa, conf < 0.6, ou Flash retorna `needs_escalation`), faz cascata pra `openai/gpt-5.5` reaproveitando a infra `_shared/ai-gateway.ts` + `aiChatCascade`.
5. IA responde texto livre **e/ou** dispara tool. Quando dispara `pedir_foto_conta` → seta `conversation_step="aguardando_conta"` e o handler `capture_conta` atual assume; quando dispara `pedir_documento` → idem com `capture_documento`.
6. Após OCR/documento OK, controle volta pra IA (handler `post-confirm-conta` chama `fluxo-b-ai` de novo em vez do CTA hardcoded).
7. Custo trackeado em `ai_costs` (já existe).

### 3. Super prompt — base que eu escrevo
Salvo em `consultants.ai_persona_fluxo_b` (nova coluna `text`). Estrutura:
- **Persona:** "Você é {{representante}} da iGreen Energy, atendendo {{nome_cliente}} pelo WhatsApp."
- **Objetivo:** cadastrar o lead no plano de 20% desconto na conta de luz.
- **Tom:** brasileiro, próximo, mensagens curtas (≤3 linhas), emojis com moderação, nunca formal/robótico.
- **Regras duras:** nunca inventar valor de economia (sempre calcular `valor × 0.20`); nunca prometer instalação/obra; se lead pedir humano, chamar tool `escalar_humano`; máximo 3 tentativas por etapa antes de escalar.
- **Roteiro flexível (não script):** descobrir nome → entender valor da conta → explicar desconto em 1-2 frases → pedir foto da conta (`pedir_foto_conta`) → após OCR confirmado, pedir documento (`pedir_documento`) → finalizar (`finalizar_cadastro`).
- **Few-shot:** 2-3 exemplos de conversas reais bem-sucedidas + 1 exemplo de objeção bem tratada.

Após eu salvar a base, você refina ao vivo no painel.

### 4. Painel admin
Em `/admin/fluxos` (ou `/admin/consultores`), tab nova **"Fluxo B — IA livre"**:
- Textarea grande do super prompt (`ai_persona_fluxo_b`).
- Slider de "criatividade" (`temperature` 0–1, default 0.7).
- Toggle "Cascata GPT-5.5 ativa" (default on).
- Botão "Testar com lead simulado" — abre modal de chat que conversa com a IA usando o prompt atual sem mandar Whapi.
- Histórico das últimas 20 conversas Fluxo B com tags (cadastrou / escalou / abandonou).

### 5. Tools que a IA pode chamar
| Tool | Efeito |
|---|---|
| `registrar_nome(nome)` | `update customers set name=$1, name_source='ai_chat'` |
| `pedir_foto_conta()` | seta `conversation_step='aguardando_conta'`, envia mensagem que a IA gerou |
| `pedir_documento()` | seta `conversation_step='aguardando_documento'` |
| `finalizar_cadastro()` | dispara pipeline `finalizar_cadastro` existente |
| `escalar_humano(motivo)` | `bot_paused=true`, alerta super-admin |

---

## Detalhes técnicos

### Arquivos novos
- `supabase/functions/fluxo-b-ai/index.ts` — handler principal
- `supabase/functions/_shared/fluxo-b-prompt.ts` — montagem do super prompt (persona + vars + histórico + tools schema)
- `src/components/admin/fluxos/FluxoBAIPanel.tsx` — UI de tunagem
- `src/components/admin/fluxos/FluxoBChatTester.tsx` — modal de teste

### Arquivos alterados
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts` — desvio quando `flow_variant === "B"` (curto: ~30 linhas)
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts` post-confirm-conta — em vez do CTA hardcoded, devolver controle pra `fluxo-b-ai`
- `evolution-webhook/handlers/bot-flow.ts` — espelho do mesmo desvio
- `src/pages/AdminFluxos.tsx` (ou onde fica o FluxoCamila) — nova tab Fluxo B

### Migration
- `ALTER TABLE consultants ADD COLUMN ai_persona_fluxo_b text;`
- `ALTER TABLE consultants ADD COLUMN ai_persona_fluxo_b_temperature numeric DEFAULT 0.7;`
- `ALTER TABLE consultants ADD COLUMN ai_persona_fluxo_b_cascade_enabled boolean DEFAULT true;`
- Seed do prompt base pra todos consultores ativos.

### Reaproveitamento (não reinventar)
- `_shared/ai-gateway.ts` `aiChatCascade` (cascata + retry + 429/402)
- `_shared/ai-cost-tracker.ts` (`ai_costs`)
- `_shared/ai-decisions.ts` (logar cada turno em `ai_decisions`)
- `_shared/ai-summary.ts` (`conversation_summary` a cada ~6 turnos)
- `capture_conta`, `capture_documento`, `finalizar_cadastro` handlers existentes — não tocar
- `dev-fire-all-steps mode=real` continua funcionando pra Fluxo A; pra B, novo botão "Testar IA" no painel

---

## Teste

1. Cria/edita o super prompt no `/admin/fluxos` → tab Fluxo B.
2. Clica "Testar com lead simulado" → conversa no modal sem gastar Whapi.
3. Quando satisfeito, marca um consultor com `flow_variant_default="B"` e dispara `dev-fire-all-steps mode=real fresh:true` no seu número.
4. Conversa de verdade pelo WhatsApp do início ao fim.

## Fora de escopo
- Voz/áudio: Fluxo B começa text-only. Pode virar V2 (TTS Gemini quando lead manda áudio).
- Multi-idioma: PT-BR apenas.
- A/B test automatizado A vs B vs C: já existe infra (`flow_variant`), não preciso mexer.
