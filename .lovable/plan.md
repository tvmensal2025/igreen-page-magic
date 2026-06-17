# Auditoria — Parceiros, Áudio (TTS) e Evolution

## 1) Criação de Parceiros — OK
Verificado em `src/components/admin/parceiros/hooks/useReferralPartners.ts` e `PartnerForm.tsx`:
- Sanitização de entrada (trim, dedup de keywords, campos vazios → null).
- Validação de sessão antes do insert (mensagem clara se sem login).
- Retry leve (3x, 120ms) para colisão de `short_code` (unique).
- Mensagens de erro humanas no toast.
- CLI opcional quando há `partner_igreen_id` (consultor parceiro).

Status: criar parceiro não deve mais falhar silenciosamente.

## 2) Áudio / bucket `tts-cache` — OK
- Edge function `supabase/functions/ensure-tts-bucket/index.ts` testada agora: HTTP 200, `{ ok: true, created: false }` → bucket já existe.
- Query em `storage.buckets`: `tts-cache` presente, `public=true`, `file_size_limit=10485760`.
- `AudioStudio.tsx` usa `fetch` + `getPublicUrl` com `cache: "no-store"` para não poluir console com 400/404 esperados de cache miss; fallback para ElevenLabs via `tts-proxy` segue funcionando.

Os erros 400 que apareciam (`tts-cache/v6_*.mp3`) eram cache miss legítimos quando o bucket ainda não existia. Agora retornam 404 silencioso e o áudio é regenerado via `tts-proxy`.

## 3) Evolution — sem mudanças nesta rodada
Não houve alteração no fluxo Evolution. Os erros 403 do `pps.whatsapp.net` no console são **avatars do WhatsApp** servidos pela Meta com URL temporária assinada — expiram em horas, é normal e não afeta o sistema (são fotos de perfil dos leads). Não há ação útil do nosso lado além de cachear/ocultar quando 403.

## 4) Ruídos remanescentes no console (não bloqueantes)
- `QuotaExceededError` no `workbox`/`sw-app.js`: storage do Service Worker cheio (cache de PWA). Não impede uso. Solução futura: limpar cache antigo em `public/sw.js` (`caches.delete`) com TTL — fora do escopo desta rodada.
- React Router v7 `startTransition` warning: aviso informativo, não é bug.

## Melhorias opcionais a propor

a) **Auto-chamar `ensure-tts-bucket` no boot do AudioStudio** (uma vez por sessão) para autorreparar caso alguém apague o bucket no painel.

b) **Esconder avatares com 403** no UI (onError → fallback iniciais), removendo o ruído visual.

c) **Limpeza do cache do SW** para parar `QuotaExceededError` (incrementar versão do cache e remover antigos).

Nenhuma das três é necessária agora — o sistema está funcional. Posso aplicar a/b/c se você confirmar.

## Veredito
Parceiros: 100%. TTS bucket: 100%. Evolution: sem mudanças (não foi tocado). Ruídos restantes são cosméticos. Aprovar este plano apenas se quiser que eu aplique as melhorias opcionais a/b/c — caso contrário, está tudo em ordem.
