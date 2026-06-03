# Aplicar Fluxo A Perfeito — Plano de Implementação

## Análise final antes de aplicar (sem risco detectado)

Validei contra o código atual:

- `bot_flows` ativo `Fluxo Padrão` (id `66a19db4-…`) tem 13 passos e mídias já cadastradas em `ai_media_library` (áudios `boas_vindas`, `como_funciona`, vídeos `fazenda_solar` + `Conexão Green`). **Não preciso criar mídia nova.**
- `state-machine.ts` linha 90 e 110: pitch_conexao_club já existe como estado, mas o roteamento atual pula direto para `duvidas_pos_club` sem disparar o vídeo do club — é só ajuste de transição, sem schema novo.
- `variants/a.ts` já respeita `mediaOrderByStepKey` e `_buttons` no capture — basta corrigir a ordem do slot `como_funciona` (hoje `[text,audio,video,image]` mistura 3 vídeos + 2 áudios) e adicionar `_buttons` no step `ask_quero_cadastrar`.
- Sem migração destrutiva. Sem mexer em auth, RLS, storage. Sem alterar OCR (mantido como pedido).
- Risco de quebra do fluxo D = zero (mudanças isoladas em variant A e em steps com `slot_key` exclusivo do flow A).

✅ **Pode aplicar.**

---

## O que vou mudar (3 frentes, build mode)

### 1. Corrigir state-machine.ts (falhas C1, C2, C3)
Arquivo: `supabase/functions/whapi-webhook/handlers/conversational/state-machine.ts`

- **C2 fix** — `checkin_pos_video + afirmação` deve disparar o vídeo do club, não cair em `qualificacao`. Já está correto na linha 90 ✓ — vou só garantir que `pos_video` siga o mesmo caminho.
- **C3 fix** — case `pitch_conexao_club` hoje vai direto pra `duvidas_pos_club`. Vou mantê-lo aguardando o `followup` do vídeo (não emite ação dupla).
- **C1 fix** — `duvidas_pos_club + afirmação` hoje entra em `ENTER_CADASTRO` que pede a **conta**. Já está certo ✓. Vou só remover o atalho que em alguns paths levava direto pra `aguardando_doc_auto` no `bot-flow.ts` legacy (linhas 2282–2293 e 3999–4013) — substituir por `aguardando_conta`.

### 2. Reorganizar mídia do step `como_funciona` (DB)
Migração leve em `bot_flow_steps`/`ai_media_library`:
- Desativar (`is_active=false`) os 3 vídeos e o áudio webm extras anexados a `como_funciona` — manter só o áudio "Como funciona a energia" (123s).
- Mover o vídeo "Conexão Green — Apresentação" para o slot `fazenda_solar` (já está lá ✓).
- Atualizar `flow_step_media_order["como_funciona"]` para `["text","audio"]` (sem vídeo/imagem).
- Atualizar `flow_step_media_order["fazenda_solar"]` para `["text","image","video"]` (texto curto, imagem da fazenda, vídeo institucional 60s).

### 3. Adicionar botões no `ask_quero_cadastrar`
- Inserir `captures._buttons = [{id:"sim_cadastrar",label:"✅ Quero economizar"},{id:"tenho_duvida",label:"❓ Tenho dúvidas"}]` no step `559b8f1b-…`.
- Handler em `bot-flow.ts`: ao receber `tenho_duvida`, abrir Q&A (LLM com contexto FAQ) e ao final reapresentar o mesmo CTA — sem loop infinito (máx 3 perguntas → handoff humano).

---

## Roteiro final que ficará vivo (resumo dos 10 passos)

| # | Step | O que o bot envia | O que espera do cliente |
|---|---|---|---|
| 1 | `boas_vindas` | 🎙️ áudio 7s + texto "qual seu nome?" | Nome |
| 2 | `qualificacao` | Texto "qual valor da sua conta?" | Número (R$) |
| 3 | `como_funciona` | Texto curto + 🎙️ áudio 2min Rafael | Reação ("entendi"/"como assim") |
| 4 | `fazenda_solar` | Texto + 🖼️ imagem usina + 🎬 vídeo 60s | "show"/"quero" |
| 5 | simulação | Texto com economia personalizada + botões | ✅ ou ❓ |
| 6 | `capture_conta` | "manda foto da conta" → OCR → card de confirmação | Foto/PDF + Sim |
| 7 | `ask_quero_cadastrar` | Resumo da economia + botões | ✅ ou ❓ |
| 8 | `capture_documento` | "manda RG/CNH" → OCR → confirmação titularidade | Foto + Sim |
| 9 | dados faltantes | Pergunta apenas o que falta (email/tel/cep) | Respostas pontuais |
| 10 | `finalizar_cadastro` | Submete portal → pede OTP → valida → ✅ | Código de 6 dígitos |

**Dúvidas em qualquer ponto** (override global): "humano" → handoff; "é golpe?" → prova; "tem fidelidade?" → "não, 30d aviso"; etc. — já existe Q&A em `bot_flow_qa`, vou só garantir que está sendo consultado em todos os steps.

---

## Arquivos que serão tocados

- `supabase/functions/whapi-webhook/handlers/conversational/state-machine.ts` (ajuste transições)
- `supabase/functions/whapi-webhook/handlers/conversational/bot-flow.ts` (remover atalho aguardando_doc_auto, adicionar handler tenho_duvida)
- 1 migração SQL: desativar mídias extras + atualizar `_buttons` do step + atualizar `flow_step_media_order`
- Sem alterações no OCR, no portal worker, no frontend.

---

## Validação pós-deploy

1. `test_jornada_completa.py` (já existe em `.kiro/specs/flow-engine-v3-rewrite/`)
2. Curl no `whapi-webhook` simulando 1 lead novo (smoke).
3. Verificar nos próximos 3 leads reais: `customer_flow_state.current_step` percorre `boas_vindas → qualificacao → como_funciona → fazenda_solar → aguardando_conta → ask_quero_cadastrar → aguardando_doc_auto → finalizar` sem pular etapas.

Tudo pronto. Pode aprovar que aplico em build mode.
