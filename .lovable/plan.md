# Bot não entende cliente que diz "te mando amanhã"

## O caso real (lead Verinha, 04/06 00:11)

```
00:11:10  cliente → [arquivo da conta]              step: capture_conta
00:11:19  bot     → "⚠ não consegui ler (qualidade 33%)... envie foto nítida"
00:11:49  cliente → [áudio] "Então amanhã eu te mando, porque hoje com as
                   luzes não tem como não ficar sombra. Amanhã logo cedo
                   eu mando, tá bom? Obrigada."     step: aguardando_conta
00:11:58  bot     → "📋 Voltando ao seu cadastro: Verinha, me envia uma
                   foto ou PDF da conta de luz pra eu seguir 📸"
```

A cliente avisou que envia amanhã. O bot ignorou e repetiu o pedido — soa robótico e queima o lead.

## Causa raiz

Em `supabase/functions/whapi-webhook/handlers/bot-flow.ts`:

1. Áudio é transcrito (`whapi-webhook/index.ts:1172`) e vira `messageText`, mas chega no handler com `isFile = true` (é mídia de áudio).
2. O interceptor "off-topic" (linha 2555) só roda quando `!isFile`. Áudio nunca passa por ele.
3. Não existe nenhuma detecção de **adiamento** ("amanhã", "logo cedo", "mais tarde", "à noite", "depois", "agora não", "tô na rua", "sem luz aqui"). Só existe `nao_quer` no intent-classifier conversacional — mas nos steps de coleta (`aguardando_conta`, `aguardando_doc_*`) o classifier nem é consultado.
4. Resultado: cliente que pede tempo recebe o mesmo prompt em loop até desistir.

## O que vou implementar

### 1. Helper de detecção de adiamento

Novo `detectPostponeIntent(text)` em `bot-flow.ts` (ou util compartilhado), regex em PT-BR cobrindo:

- "amanh[ãa]", "logo (cedo|mais|de manh[ãa])", "mais tarde", "depois", "[áa] noite", "[áa] tarde"
- "agora n[ãa]o", "ainda n[ãa]o", "n[ãa]o (consigo|posso|d[áa]) agora"
- "(t[oôu]|estou) (na rua|no trabalho|sem luz|sem internet|sem (a )?conta (em m[ãa]os|aqui))"
- "(daqui a pouco|j[áa] te mando|j[áa] mando|mando (assim que|quando))"
- captura opcional do "quando" (amanhã / mais tarde / hoje à noite) pra usar na resposta

### 2. Interceptor aplicado a texto **e** áudio nos steps de coleta de mídia

Antes do switch principal, em `bot-flow.ts` (perto da linha 2555, ampliado):

```ts
const MEDIA_WAIT_STEPS = /^(aguardando_(conta|doc|doc_auto|doc_frente|doc_verso))/;
if (MEDIA_WAIT_STEPS.test(step) && messageText && !isButton && !isFile_image_or_pdf) {
  const postpone = detectPostponeIntent(messageText);
  if (postpone) { … }
}
```

`isFile_image_or_pdf` = só bloqueia se a mídia recebida for **a própria conta/doc** (imagem/PDF). Áudio transcrito entra.

### 3. Resposta empática + pausa de prompts

Quando detecta adiamento:

- Envia mensagem única, sem repetir o "📋 Voltando ao seu cadastro": algo como
  *"Combinado, {nome}! Fico no aguardo da conta {quando}. 💚 Qualquer coisa, é só me chamar."*
- Marca em `customers` (campo já existente `bot_paused_until` / `next_followup_at` — verificar nome real na migração) o horário esperado: amanhã 09:00 / +3h / +6h conforme o "quando" detectado, default +12h.
- Registra `ai_decisions` com `tool_called: "schedule_followup"`, `reasoning: "lead pediu adiamento"`, pra aparecer no painel de decisões.
- **Não muda o `conversation_step`** — continua em `aguardando_conta`, só pausa nudges.

### 4. Nudge/reaquecimento respeita a pausa

Confirmar nos crons `bot-stuck-recovery` e `ai-followup-cron` que eles já leem o `bot_paused_until` (provavelmente sim — checar). Se não, adicionar guard.

### 5. Quando a pausa vence

O cron de follow-up dispara mensagem leve do tipo *"Oi {nome}! Conseguiu separar a conta de luz? 📸"* — usar texto existente se houver, senão adicionar template.

### 6. Testes

- Unit test do `detectPostponeIntent` cobrindo: "amanhã eu mando", "mais tarde te envio", "tô sem luz aqui", "depois eu vejo", falsos positivos ("amanhã não vai dar" → ainda é adiamento; "não quero" → continua `nao_quer` no fluxo normal).
- Teste de integração em `bot-flow` simulando áudio transcrito em `aguardando_conta` → garante que **não** reenvia o prompt e **agenda** follow-up.

## Arquivos a tocar

- `supabase/functions/whapi-webhook/handlers/bot-flow.ts` — interceptor + helper + chamada de schedule
- `supabase/functions/_shared/postpone-intent.ts` *(novo)* — regex + parser do "quando"
- `supabase/functions/_shared/postpone-intent.test.ts` *(novo)*
- Possível ajuste em `bot-stuck-recovery/index.ts` se não respeitar pausa
- Migração só se o campo de pausa ainda não existir (verifico antes)

## Fora do escopo

- Não mexo no OCR (a qualidade 33% do PDF original é outro fluxo).
- Não mudo o pipeline de transcrição de áudio.
- Não toco no design das landings (assunto das mensagens anteriores).
