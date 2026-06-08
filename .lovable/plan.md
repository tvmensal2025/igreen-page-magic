## Diagnóstico

O Estúdio de Áudio do mutirão (`src/components/admin/AudioStudio.tsx` + edge `tts-proxy`) já está bem montado, mas hoje **não funciona** e ainda **gastaria tokens em duplicidade** por dois motivos:

1. **`ELEVENLABS_API_KEY` NÃO está nos secrets do Supabase.** Conferi: só existem `LOVABLE_API_KEY` e `TWOCAPTCHA_API_KEY`. O `tts-proxy` retorna 503 com a mensagem "ELEVENLABS_API_KEY não configurada".
2. **O bucket `tts-cache` NÃO existe no Storage.** O código tenta criar pelo frontend (`supabase.storage.createBucket`), mas isso exige service_role e falha silenciosamente. Resultado: o cache L2 (compartilhado entre consultores/dispositivos) **nunca grava**, só funcionam IndexedDB local (L1) e memória (L0). Cada navegador novo regenera tudo do zero = ElevenLabs cobrado de novo.

A boa notícia: a estratégia de chunking do texto já está perfeita pra reaproveitamento — o texto do mutirão é quebrado em pedaços determinísticos antes de hash:

```
trecho1   → "Atenção, moradores e comerciantes de {cidade} e região!"   ← cacheia por CIDADE
FIXO_2    → texto fixo do mutirão (sempre igual)                         ← cacheia 1× e nunca mais gera
"na {rua}." → endereço expandido + número por extenso                    ← cacheia por RUA+Nº+BAIRRO+REF
horarioP  → "Das {x} às {y}."                                            ← cacheia por HORÁRIO
FIXO_3    → "Traga documento, fatura..."                                 ← cacheia 1× e nunca mais gera
sorteio   → variação opcional                                            ← cacheia por sorteio
```

Hash determinístico (`hashText` com versionamento `v6`) → mesma cidade/rua/horário = mesmo arquivo no bucket.

## Plano

### 1. Adicionar o secret `ELEVENLABS_API_KEY`
Vou disparar o tool `secrets--add_secret` para você colar a chave da ElevenLabs no painel seguro. O `tts-proxy` é redeployado automático.

### 2. Migration: criar bucket `tts-cache` definitivo + políticas
- Bucket público (leitura aberta, para o `download()` funcionar sem token).
- Policies de Storage: qualquer `authenticated` pode **fazer upload e read** em `tts-cache` (todo consultor compartilha o cache — é justamente o ponto, não regenerar).
- Limite de 5 MB por arquivo, MIME `audio/mpeg`.

### 3. Pequenos ajustes no `AudioStudio.tsx`
- Remover o `createBucket` client-side (agora o bucket já existe pela migration; chamada falhava em silêncio).
- Manter `upsert: true` no upload (idempotente).
- Adicionar log discreto "cache hit/miss" no console pra você auditar economia.

### 4. (Opcional, recomendado) Tabela `tts_cache_index`
Pequena tabela só pra você visualizar/auditar o que já está cacheado:
`hash, text, consultant_id, bytes, created_at`. Insert feito no `setCachedTTS`. Não bloqueia nada se falhar.

Pergunta: quer essa tabela ou pula? (Padrão: **pulo**, deixa só o bucket — é o que importa pro custo.)

### 5. Verificação
- `supabase--curl_edge_functions` POST `/tts-proxy` com um texto curto → confirma 200 + bytes de MP3.
- Gerar o áudio na UI 2× com a **mesma cidade/rua/horário** → segunda vez deve mostrar "cache hit" em todos os 5 trechos (0 chamada à ElevenLabs).
- Mudar só a cidade → só `trecho1` regenera, resto vem do cache.

## Detalhes técnicos

**SQL da migration (resumo):**
```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tts-cache', 'tts-cache', true, 5242880, array['audio/mpeg'])
on conflict (id) do update set public = true, file_size_limit = 5242880;

create policy "tts-cache public read"   on storage.objects for select using (bucket_id = 'tts-cache');
create policy "tts-cache auth upload"   on storage.objects for insert to authenticated with check (bucket_id = 'tts-cache');
create policy "tts-cache auth update"   on storage.objects for update to authenticated using (bucket_id = 'tts-cache');
```

**O que NÃO vou mexer:** template do texto, vozes, vinheta, fluxo de salvar em `ai_media_library`, processamento MP3 — tudo isso já funciona.

## Próximo passo
Aprova o plano? Assim que aprovar eu: (a) peço a chave do ElevenLabs no popup seguro, (b) rodo a migration do bucket, (c) limpo o `createBucket` no front, (d) testo `tts-proxy` e te mostro o resultado.