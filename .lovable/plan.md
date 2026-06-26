## Diagnóstico — por que áudio + vídeo do `d_como_funciona` não chegaram no Evolution

O Fluxo D é compartilhado: o `abelolympio` está em `sync_mode='public'` e herda mídia do dono do template público (Rafael Ferreira / `0c2711ad`). Tudo certo até aí — o problema está nos **dados** de mídia daquele slot e em **3 bugs reais** no envio.

### Estado atual de `ai_media_library` para `slot_key='como_funciona'` (consultor=Rafael, dono do público)

```
kind   id          send_order  is_public  active   url
audio  310be588    100         true       FALSE    supabase storage
audio  fdde2dba    102         false      TRUE     supabase storage   ← único áudio "vivo"
audio  bb478335    108         true       FALSE    minio
audio  ad1ae922    109         true       FALSE    minio
video  4d0a180e    101         true       FALSE    supabase storage
video  90843fd5    106         true       TRUE     supabase storage   ← único vídeo "vivo"
video  2d2f5229    107         true       FALSE    supabase storage
video  24fe29ca    110         true       FALSE    supabase storage
```

6 de 8 mídias foram **auto-desativadas** pelo HEAD-check órfão de `bot-flow.ts:1611-1620` (`urlExists` → marca `active=false` no primeiro 4xx/5xx). Sobrou 1 áudio + 1 vídeo, e mesmo esses provavelmente também falham no HEAD em alguma janela, fazendo o `dispatch` cair em "sem mídia" e mandar só texto. Esse é o sintoma que o usuário viu: "como funciona" mandou texto, mas não áudio nem vídeo.

### 3 bugs/fragilidades reais

1. **HEAD-check órfão derruba mídia boa.** `urlExists()` chama HEAD sem retry, sem User-Agent custom, e em qualquer 4xx/5xx (CDN engasgou, MinIO timeout, Supabase Storage com latência) marca `active=false` permanentemente. É uma "soft delete" sem reversão. Resultado: o slot vai sangrando mídia até sobrar nada.
2. **Áudio "vivo" do como_funciona está com `is_public=false`** (id `fdde2dba`). Funciona para o caller `abelolympio` só porque `mediaOwnerId` resolve para Rafael via `sync_mode='public'`. Se o resolver falhar (qualquer exceção → fallback retorna o próprio `consultantId`), o áudio some. Frágil.
3. **Engine v3 está `'dark'`** para o `abelolympio` (`flow_engine_v3='dark'`). Só o legado emite. Qualquer melhoria de envio que esteja no v3 não toma efeito. (Não é bug, é status — vale saber.)

### Por que isso só pega o `como_funciona`

`boas_vindas` tem 3 áudios (provavelmente algum ainda OK), `fazenda_solar` tem 3 vídeos + 2 áudios + 1 imagem. O `como_funciona` é o que ficou mais "raspado" pelo HEAD-check. Mesma classe de bug pode atacar qualquer outro slot a qualquer momento.

---

## Plano

Ordem do mais barato (dados/SQL) para o mais caro (código + teste real).

### Passo 1 — Recuperação imediata dos dados (slot `como_funciona`)

UPDATE `ai_media_library` reativando as 6 mídias que foram auto-desativadas, MAS antes verificar `HEAD` de cada URL via `curl` no console para não reativar URL realmente quebrada. Critério de reativação:

- URL responde 200 OK no curl manual → `active=true`.
- URL 404/410 → fica `active=false` (de fato órfã).

Validação: rodar `SELECT kind, COUNT(*) FILTER (WHERE active) AS vivas FROM ai_media_library WHERE slot_key='como_funciona' GROUP BY kind` — esperado: ≥1 áudio + ≥1 vídeo + (se houver) imagem. Mesma varredura para `boas_vindas`, `fazenda_solar`, `prova_social`, `objecao_*` e qualquer slot `passo_*`.

### Passo 2 — Corrigir o `is_public` do áudio vivo

UPDATE `ai_media_library SET is_public=true WHERE id='fdde2dba-…'`. O slot público precisa estar 100% público — `false` em conteúdo do template global é dado errado, herdado de quando o áudio foi enviado como "pessoal" antes de virar template.

### Passo 3 — Fix de código: HEAD-check menos agressivo

Em `supabase/functions/_shared/url-exists.ts` (ou o módulo de `urlExists`) e em `bot-flow.ts:1609-1620`:

- Trocar HEAD por GET com `Range: bytes=0-0` (mais compatível com MinIO e Supabase Storage).
- 2 tentativas com backoff curto (500ms) antes de considerar morto.
- Timeout de 5s (provavelmente hoje é menor).
- **Nunca** marcar `active=false` automaticamente. Em vez disso, registrar `inbound_media_failures` (ou criar `outbound_media_health(media_id, last_check_at, consecutive_failures, last_status)`) e só desativar quando `consecutive_failures >= 5`. Decisão de desativar fica explícita.
- Adicionar log estruturado: `[media-healthcheck] media_id=… url=… status=… consecutive_failures=…`.

Espelhar a mudança no `whapi-webhook` (mesmo bloco).

### Passo 4 — Garantir envio de áudio + vídeo no Evolution

Em `supabase/functions/_shared/channels/evolution.ts:136-145`, validar que `sendAudio` está usando o endpoint `/message/sendWhatsAppAudio/{instance}` (não `/message/sendMedia` com kind=audio — esse manda como `audioMessage` sem PTT, e às vezes o WhatsApp engole). Confirmar via curl direto na Evolution.

Para vídeo: confirmar que a URL passada é resolvível pelo runtime do Evolution (a Evolution faz fetch do arquivo no servidor dela). URLs do Supabase Storage public devem funcionar; URLs `igreen-minio.d9v63q.easypanel.host` precisam estar acessíveis do container Evolution na mesma rede.

Adicionar teste de smoke (em `scripts/manual-tests/`): chama `sendMedia` com kind=audio e kind=video usando uma URL pública conhecida (ex: o vídeo `90843fd5`) e confere `ok=true`.

### Passo 5 — Validação E2E

Disparar manualmente no número de teste:
1. Mensagem inicial → recebe `d_welcome`.
2. Aperta "2" → entra em `d_como_funciona`.
3. Conferir que chegam **na ordem** configurada: áudio → imagem (se houver) → vídeo → texto → botões.
4. Logs do `evolution-webhook` devem mostrar 4 inserts em `conversations` (kind audio, kind video, kind text, kind buttons).
5. Variar a variante (`flow_variant`) para garantir que as 6 variantes do step `d_como_funciona` agora rodam o mesmo caminho de mídia.

### Passo 6 — Atualizar `docs/auditoria/abelolympio-2026-06-26.md`

Adicionar seção "5.6 Rodada 4 — mídia do `como_funciona` no público" com:
- snapshot do `ai_media_library` antes/depois,
- bug do HEAD-check explicado,
- evidência do E2E (logs + screenshot da conversa),
- recomendação ao Super Admin: revisar `ai_media_library` para todo slot que tenha `>30%` de mídias `active=false`.

---

## Arquivos tocados

- **Dados** (via insert tool, sem migration):
  - `ai_media_library` — UPDATE em ~6 linhas do slot `como_funciona` (reativar + corrigir `is_public`), e varredura nos outros slots.
- **Código**:
  - `supabase/functions/_shared/url-exists.ts` (ou equivalente) — HEAD → GET Range, retry, timeout.
  - `supabase/functions/evolution-webhook/handlers/bot-flow.ts:1609-1620` — não desativar automaticamente; logar e contar falhas.
  - `supabase/functions/whapi-webhook/handlers/bot-flow.ts` — mesmo patch.
  - (Possível) `supabase/functions/_shared/channels/evolution.ts:136-145` — confirmar endpoint correto de áudio.
  - `scripts/manual-tests/test-evolution-media.ts` — novo smoke test.
- **Migration**: NÃO. Sem mudança de schema.
- **Docs**: `docs/auditoria/abelolympio-2026-06-26.md` (nova seção 5.6).

## Riscos

- Reativar mídia órfã de verdade pode gerar erros 404 em runtime. Mitigado pelo curl prévio de cada URL no Passo 1.
- Mudar o HEAD-check para GET Range tem custo de banda marginal. Aceitável.
- Engine v3 continua `'dark'`. O fix vale para o legado (que é o que emite hoje). Quando v3 virar `'on'`, herdará o mesmo `urlExists` corrigido.
