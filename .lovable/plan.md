## Causa raiz

Logs da `facebook-create-campaign` mostram, nas 4 tentativas mais recentes, o mesmo erro da Meta:

```
subcode=1443226 code=100
"Seu anúncio precisa de uma miniatura de vídeo"
"Especifique image_hash ou image_url no campo video_data de object_story_spec"
```

Fluxo do vídeo hoje (`supabase/functions/facebook-create-campaign/index.ts`):

1. `thumbUrl` é resolvido corretamente — log `[fb-create] thumb auto-resolved= https://scontent...` aparece antes do erro.
2. Mas na hora de montar o `object_story_spec` (linhas 863–871), o comentário diz *"NÃO enviar image_url"* e o `videoData` só contém `video_id`, `title`, `message`, `call_to_action`.
3. A Meta, nos placements Reels/Stories 9:16, **passou a exigir** `image_url` ou `image_hash` explícito no `video_data` — ela não aceita mais cair no thumbnail nativo automático. Por isso `POST /adcreatives` falha com 1443226.

Ou seja: a thumb está pronta, só não é enviada. Todas as publicações de vídeo estão travadas por causa disso (o modo foto não é afetado).

## Correção

Alterar `videoData` em `facebook-create-campaign/index.ts` (linhas ~866–871) para incluir a thumb já resolvida:

```ts
const videoData: Record<string, unknown> = {
  video_id: fbVideoId,
  title: videoTitle,
  message: body.primary_text,
  image_url: thumbUrl,               // ← reintroduzir; obrigatório desde 2025
  call_to_action: { type: "WHATSAPP_MESSAGE", value: { link: waLinkV } },
};
```

Ajustes de robustez que entram junto:

- Garantir que `thumbUrl` esteja definido antes do `adcreatives` também no caminho de **cache HIT** (hoje o auto-resolve só roda quando `!thumbUrl && fbVideoId`; se o cache trouxe um vídeo sem `thumb_url`, o request vai sem imagem e falha igual). Vou mover o bloco de auto-resolve para depois do cache, condicionado a `!thumbUrl`.
- Se após retry a Meta ainda não devolver thumb, manter o `throw` atual com mensagem clara (já existe).
- Atualizar o comentário antigo (“NÃO enviar image_url”) explicando a mudança de política Reels 2025 para não regredir de novo.
- Sem mudança em RLS, migrations, front-end, wizard ou modo foto.

Deploy da função em seguida; a próxima publicação de vídeo deve subir sem 1443226.

## Fora de escopo

- Mexer no wizard, catálogo de copy, rodízio ou notificação de parceiros.
- Alterar dimensões/aspect da thumb (Meta aceita a própria URL do CDN dela, que é o que já usamos).
