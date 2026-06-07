# Plano — eliminar 429 do Gemini direto e parar duplicação no boas_vindas

## Causa raiz (recapitulada)
1. `_shared/gemini.ts` chama `https://generativelanguage.googleapis.com` direto com `GEMINI_API_KEY` → **402/429 "prepayment credits depleted"** desde 15:46 UTC. Toda transcrição nova falha.
2. Slot `boas_vindas` tem **10 áudios ativos** (1 canônico + 9 duplicados de gravações). Variant B itera todos: 1 vira texto (cache de transcript), os 9 falham silenciosamente.
3. Variant B não dedupa transcripts por turno (bug latente).

## Mudanças

### 1. Novo helper `_shared/lovable-ai-gateway.ts`
Wrapper para `https://ai.gateway.lovable.dev/v1/chat/completions` usando `LOVABLE_API_KEY` (já provisionada).
- `lovableGatewayMultimodal({ prompt, base64, mimeType, model })` — monta payload OpenAI-compat com `input_audio`/`image_url` conforme `mimeType`.
- Mapeia model: `gemini-2.5-flash` → `google/gemini-2.5-flash`, `gemini-2.5-pro` → `google/gemini-2.5-pro`, default `google/gemini-3-flash-preview`.
- Trata 429 (rate limit) e 402 (créditos workspace) com mensagens claras.

### 2. Patch `_shared/gemini.ts` — gateway como primário
Em `geminiGenerate` e `geminiMultimodal`:
- **Se `LOVABLE_API_KEY` existir → usa gateway primeiro.**
- Se gateway retornar 402/429 ou faltar suporte multimodal para o mime → cai para `GEMINI_API_KEY` direto.
- Se ambos faltarem ou falharem → throw atual (sentinela mantida).
- Sem mudança de assinatura pública; todos os callers (ai-transcribe-media, ai-generate-step-text, flow-ai-rewrite, ad-*, ocr.ts, etc.) ganham o failover sem edição.

### 3. Migration — limpar slot `boas_vindas`
```sql
UPDATE ai_media_library
SET active = false, updated_at = now()
WHERE slot_key = 'boas_vindas'
  AND id <> 'e822e37a-761e-4017-ad7c-bec61c0a4ebe'; -- mantém só "Boas-vindas" canônico
```
Resultado: variant A/D mandam 1 áudio; variant B converte para 1 texto (se houver transcript).

### 4. Patch dedupe variant B em `sendStepMedia`
Em `supabase/functions/_shared/.../sendStepMedia.ts` (o caller no whapi-webhook/handlers/conversational):
- Manter um `Set<string>` de transcripts já enviados no turno.
- Antes de emitir o texto convertido, hash do transcript normalizado; se já enviado, pular.

### 5. Re-transcrever o áudio canônico imediatamente
Após o gateway entrar no ar, rodar uma chamada one-shot (script /tmp via `ai-gateway` skill) para forçar `ensureAudioTranscript` no áudio `e822e37a` e popular o cache, evitando a primeira request lenta em produção.

## Deploy
Edge functions tocadas: todas que importam `_shared/gemini.ts` herdam o fix; redeploy explícito de `ai-transcribe-media`, `whapi-webhook`, `evolution-webhook`, `ai-generate-step-text`, `flow-ai-rewrite`, `reprocess-capture`, `portal2-ai-audit`, `ad-creative-qa`, `ad-image-validator`, `ad-video-captions`, `flow-step-suggest`.

## Validação
- `curl ai-transcribe-media` com payload de áudio base64 conhecido → verificar `transcript` no body.
- Mandar "Oi" do número de teste no Whapi → confirmar: 1 outbound nome + 1 outbound boas_vindas + 1 outbound transcript único (sem duplicatas) + sem warnings `sem transcript → pulado` em loop.
- Conferir logs de `ai-transcribe-media`: zero ocorrências de `Gemini 429` quando `LOVABLE_API_KEY` presente.

## Fora do escopo
- Não muda V3 engine, não muda variant A/D, não toca em flows do banco além da limpeza do slot.
- Não cria credit budget tracker (pode entrar em segundo plano se quiser depois).

Aprovar para eu implementar?
