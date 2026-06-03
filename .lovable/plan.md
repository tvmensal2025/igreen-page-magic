# Fluxo D — copy nova, botão "dúvida" pro vídeo, e skip do botão Finalizar

## 1) Banco — atualizar passos do Fluxo D (`320bf22c-...`) via UPDATE

### `d_welcome`
**Nova copy:**
> Oi, {{nome}}! 👋
> 
> Vi que você se interessou em *reduzir a conta de luz em até 20%* — sem obra, sem instalação, na mesma distribuidora. 💚
> 
> Em 2 minutos eu te mostro *quanto você economiza por mês*. Posso começar? 👇

**Botões (mesmos IDs, destinos inalterados):**
- `quero_simular` → `d_escolher_simulacao`
- `como` (🎥 Como funciona) → `d_como_funciona`
- `humano` → handoff

### `d_resultado` — "Tenho dúvidas" vai pro vídeo
- `cadastrar` (✅ Quero me cadastrar) → `d_pedir_documento` (igual)
- `duvida` (🎥 Como funciona) → **`d_como_funciona`** (mudou — antes ia pra `d_duvidas`)
- `humano` (👨‍💼 Falar com Rafael) → handoff (igual)
Trigger_phrases ajustadas pra refletir o novo destino.

### `d_simular_resultado` — consertar swap + alinhar com `d_resultado`
- `cadastrar` (✅ Quero me cadastrar) → `d_pedir_documento`
- `duvida` (🎥 Como funciona) → `d_como_funciona`
- `humano` (👨‍💼 Falar com Rafael) → handoff

### `d_duvidas` — vira fallback de texto livre (sem botão)
- **Remove** a captura `_buttons`.
- **Mantém** `duvida_livre` com `ai_answer:true` (AI responde texto livre).
- Mantém as 3 transições por palavra-chave (`cadastrar` / `simular` / `humano`).
- Copy ajustada:
  > {{nome}}, manda sua *pergunta* aqui que eu te respondo na hora 💬
  > 
  > _(ou digite *cadastrar* pra continuar, ou *humano* pra falar com o Rafael)_

## 2) Código — pular o botão "✅ Finalizar"

Arquivo: `supabase/functions/evolution-webhook/handlers/bot-flow.ts`

Hoje, após `confirm_phone → Sim`, o lead cai em `ask_finalizar` e recebe um botão que quase ninguém clica. Já existe atalho em `ask_complement` (linha 4506) que pula direto pra `finalizando`.

**Mudança:** extrair helper local
```ts
function applyNextOrFinalize(next, merged, updates) {
  if (next === "ask_finalizar") {
    updates.conversation_step = "finalizando";
    return "✅ Tudo certo! Processando seu cadastro...";
  }
  updates.conversation_step = next;
  return getReplyForStep(next, merged);
}
```
e aplicar nos cases que hoje assinam `conversation_step` direto do retorno de `autoResolveCepIfNeeded`:
- `ask_phone_confirm` (≈4310)
- `ask_phone` (final do case, após validar telefone)
- `ask_email` (final do case)
- `ask_distribuidora` (≈4522)
- `ask_installation_number` e similares que também resolvem CEP

O `case "ask_finalizar"` existente fica como **fallback** pra leads antigos já parados nesse step.

## 3) Validação
- Reler `bot_flow_steps` do flow D após o UPDATE pra confirmar copy/botões/destinos.
- Conferir que nenhum `case` ainda assina `ask_finalizar` sem o helper.
- Garantir que `d_duvidas` continua respondendo texto livre via AI.

## Fora de escopo
- Não mexo nos IDs dos botões (`cadastrar`/`duvida`/`humano`) — só títulos e destinos.
- Não mexo nos slots de mídia (`como_funciona`, `fazenda_solar`, `prova_social`).
- Não mexo nos demais steps de captura/OCR nem nos flows A/B/C.
- Não removo o step `d_finalizar` do banco.