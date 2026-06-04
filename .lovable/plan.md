# Plano: paridade Evolution × Whapi (sem tocar superadmin)

Mexe apenas em arquivos do `evolution-webhook`. O `whapi-webhook` (superadmin), `_shared/step-media-order.ts` e `_shared/notify-consultant.ts` ficam intactos.

---

## Item 1 — Reduzir o "digitando…" entre mensagens

**Arquivo**: `supabase/functions/evolution-webhook/handlers/conversational/index.ts`

### Como está hoje

Áudio de 14s → bot espera `0,9 × 14s + 600ms = 13.2s` → manda vídeo de 15s → espera `0,9 × 15s + 600ms = 14.1s` → manda texto.
Total de "digitando…" em 1 áudio + 1 vídeo + 1 texto: **~28 segundos**.

```text
[áudio 14s]  →  digitando 13.2s  →  [vídeo 15s]  →  digitando 14.1s  →  [texto]
```

Linhas que produzem isso:
- `sleepForMedia` (222-235): piso 600ms (texto/imagem) / 800ms (áudio/vídeo), cap 5s.
- `sendStepMedia` (596-612): fórmula `min(0,9·duração_anterior + 600ms, 12s)`.

### Como vai ficar

Pausas curtas e fixas. WhatsApp já entrega na ordem; não precisa esperar a duração inteira.

| Item anterior | Pausa antes do próximo |
|---|---|
| texto / imagem | 400ms |
| áudio / vídeo | 900ms |
| `delay_before_ms` configurado | `min(cfg, 4000ms)` |

`sleepForMedia` passa a usar piso 400ms e cap 2500ms.

```text
[áudio 14s]  →  900ms  →  [vídeo 15s]  →  900ms  →  [texto]
```

Total: **~1.8 segundos** entre mensagens. O lead segue sentindo a digitação humana (presença renovada por `withTypingPresence`, que continua intacta), mas sem o gap eterno.

---

## Item 2 — Lead que diz "não quero" ou fica confuso

**Arquivo**: `supabase/functions/evolution-webhook/handlers/conversational/index.ts` (mesmo do #1)

### Como está hoje

Lead recebe um passo com botões `[Quero simular] [Tenho dúvida] [Falar com humano]` e digita "ah não, deixa pra lá".

1. Evolution chama `matchButtonIntent` (linha 1273).
2. Se a IA não casar com nenhum botão → cai no bloco de baixa confiança (linhas 1281-1312) → pausa silenciosa: `reply: ""` + `bot_paused: true`.
3. **Lead recebe SILÊNCIO**. Não sabe se o bot quebrou, se foi ignorado, se deve esperar.

Mesmo cenário com "humm, não entendi, repete?": vai pra handoff direto, sem reenviar o menu.

### Como vai ficar

Espelha o padrão do whapi (linhas 1430-1545), adaptado para o Evolution (sem `sendButtons` nativo — usa lista numerada):

**A. Lead recusou** (`intent.refused`):
```
Tranquilo, João! Quando quiser voltar é só me mandar uma mensagem. Tô por aqui 💚
```
+ `bot_paused = true`, motivo `lead_refused_softpause`. Consultor vê no CRM.

**B. Lead confuso** (`intent.confused`), 1ª e 2ª vez:
```
Posso te ajudar com qualquer uma destas opções 👇

1) Quero simular
2) Tenho dúvida
3) Falar com humano

É só tocar no número ou me dizer qual 🙂
```
Contador `ai_followups_count` (já existe no schema) incrementa.

**C. Lead confuso pela 3ª vez**:
```
Vou chamar alguém do time pra te ajudar — em instantes te respondem por aqui 🙌
```
+ `notifyHandoff(consultantId, lead, msg, "confused_after_retries")` → consultor recebe alerta no WhatsApp.
+ `bot_paused = true`.

**D. Passo de captura (foto de conta) com recusa**:
```
Tranquilo, João! Quando quiser dar continuidade é só me mandar a foto da conta. Tô por aqui 💚
```
+ pausa.

### Garantia de não quebrar

- `notifyHandoff` tem dedupe interno (5 min em memória + 30 min persistido) → impossível enviar dois alertas seguidos pro consultor mesmo se o lead spamar.
- Inserido **antes** do bloco existente de baixa confiança (linha 1281), preservando o caminho atual para casos não cobertos.
- Usa a assinatura correta `(consultantId, lead, lastQuestion, reason)` — mesma do whapi:1470, validada na auditoria.

---

## Item 3 — Template com `{{representante}}` vazio

**Arquivo**: `supabase/functions/evolution-webhook/handlers/conversational/templates.ts`

### Como está hoje

Quando o consultor não tem nome cadastrado (`vars.representante` vazio ou nulo), o texto sai:

```
Bom dia! Eu sou o assistente do consultor.
```

E quando o template tem markdown WhatsApp em volta da variável (`do *{{representante}}*`), com variável vazia sai:

```
Bom dia! Eu sou o assistente do * *
```

(asterisco órfão, fica feio).

### Como vai ficar

Mesmo comportamento do whapi:
- Fallback de `representante` muda de `"consultor"` para `"iGreen Energy"`.
- Após render, aplica 3 regex de limpeza: `\*\s*\*` → "", `_\s*_` → "", `~\s*~` → "".

Resultado:
```
Bom dia! Eu sou o assistente da iGreen Energy.
```

Mudança: 6 linhas. Sem risco — é cópia literal do whapi.

---

## Verificação após deploy

1. Enviar "Oi" para um lead do `tvmensal01@gmail.com` (consultor de teste).
2. Conferir no painel `/admin/whatsapp` que o intervalo entre áudio → vídeo → texto está em ~1-2s (não mais 25s).
3. Responder "não quero" no passo com botões → conferir despedida amigável + `bot_paused`.
4. Responder "hã?" três vezes seguidas → conferir 2 nudges com menu numerado e depois handoff.
5. Conferir que o whapi (superadmin) continua idêntico — mandar "Oi" para o número do superadmin e validar timing/texto inalterados.

## Fora do escopo (não vamos mexer agora)

- Saudação no meio do funil — risco de quebrar passos sem template; revisitar só se houver reclamação.
- Trocar `answerFaqWithAI` por `conversational-orchestrator` — custo de IA sobe 3-5×; sem evidência de problema.
- Bug latente em `whapi-webhook/.../index.ts:1618` (`notifyHandoff` com argumentos errados) — pré-existente no superadmin; registrar para arrumar em outro plano.
