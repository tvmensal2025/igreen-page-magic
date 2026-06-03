# Fix — anúncio em vídeo bloqueado por falta de miniatura

## Causa
No `supabase/functions/facebook-create-campaign/index.ts` (linha 519-525), o `video_data` só recebe `image_url` se o usuário enviou `body.video.thumb_url`. Quando não envia, o Meta recusa com:

> Invalid parameter | Seu anúncio precisa de uma miniatura de vídeo | Especifique image_hash ou image_url no campo video_data | subcode=1443226

## Fix

### `supabase/functions/facebook-create-campaign/index.ts` (modo vídeo)
1. Após o upload e o status do vídeo virar `ready` (loop atual em ~485-494), se **não houver `thumbUrl`**, chamar:
   - `GET /{fbVideoId}/thumbnails?access_token=...`
   - Pegar `data[].uri` — preferir `is_preferred: true`, senão o primeiro item.
   - Atribuir essa URI a `thumbUrl` para que a linha 525 (`videoData.image_url = thumbUrl`) sempre tenha valor.
2. Se o vídeo **não ficou ready a tempo** (não entrou no `if`), pular o passo acima e ainda assim **forçar uma busca rápida** (1 retry após 3s); se mesmo assim vier vazio, retornar erro claro: "Meta ainda não gerou a miniatura do vídeo, tente novamente em alguns segundos" — em vez de deixar o `adcreatives` quebrar com subcode 1443226.
3. Persistir o `thumb_url` resolvido no cache `ad_video_library.thumb_url` (upsert na linha 498-505) pra próximo uso reaproveitar.

Sem mudanças em modo foto, UI ou no wizard — o problema é só backend.

## Validação
- Republicar o mesmo vídeo: deve criar a campanha sem o erro 1443226.
- Logs `[fb-create] thumb auto-resolved=...` pra confirmar fluxo.

## Fora de escopo
- Não mexo em UI, score de qualidade, persona da IA, nem upload manual de thumbnail.
