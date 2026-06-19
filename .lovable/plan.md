
## Problema

Hoje o roteiro é gerado em **uma única chamada** ao TTS. Isso garante MP3 válido, mas:

- Cada novo áudio paga **tokens do roteiro inteiro**, mesmo trocando só a cidade ou o horário.
- O cache (memória → IndexedDB → bucket `tts-cache`) só bate quando o **texto é 100% idêntico** — qualquer mudança invalida tudo.

Você tem razão: dá pra economizar muito reaproveitando as partes fixas.

## Solução: gerar e cachear por trecho

Quebro o roteiro em segmentos estáveis. Cada segmento é gerado uma vez no TTS, fica no cache, e nas próximas vezes é só baixar do cache e concatenar.

### Segmentos do MUTIRÃO
```
[1] "Atenção, moradores e comerciantes de {CIDADE} e região!"   ← varia por cidade
[2] FIXO_MUTIRAO                                                 ← 100% fixo (cache eterno)
[3] "na {RUA}."                                                  ← varia por endereço
[4] "Das {HORA_INICIO} às {HORA_FIM}."                           ← varia por horário
[5] FIXO_FINAL                                                   ← 100% fixo (cache eterno)
[6] sorteioTexto (quando ativo)                                  ← varia
```

### Segmentos do COMÉRCIO
```
[1] "Atenção, moradores de {CIDADE} e região!"
[2] FIXO_COMERCIO                                                ← 100% fixo
[3] frag do local ({COMERCIO} + rua)
[4] "Das {HORA_INICIO} às {HORA_FIM}."
[5] FIXO_FINAL                                                   ← 100% fixo
```

### Ganho real

- **FIXO_MUTIRAO + FIXO_FINAL**: gerados 1x na vida toda — depois é zero token pra sempre.
- Cidades repetidas (mesma cidade, ruas diferentes): segmento [1] reaproveitado.
- Mesmo horário em áudios diferentes: segmento [4] reaproveitado.
- Só os trechos realmente novos pagam tokens.

Em uso normal, isso costuma economizar **60–80%** dos tokens depois dos primeiros áudios.

## Como funciona tecnicamente

1. `splitIntoSegments(kind, campos)` → devolve array de strings (os segmentos acima).
2. Para cada segmento:
   - `getCachedTTS(segmento)` — mesmo cache de 3 camadas que já existe.
   - Se não tiver, chama `ttsGenerate(segmento)` e salva no cache.
3. **Concatenação de MP3**: como cada trecho é um MP3 independente do ElevenLabs (mesmo `voice_id` + `model_id` + sample-rate), dá pra juntar os bytes diretamente — frames MP3 são autossuficientes. Faço isso com um `concatMp3Blobs(blobs[])` simples (`new Blob(blobs, { type: "audio/mpeg" })`) + tira tag ID3v2 dos trechos seguintes pra não embolar o player.
4. Validação: rodo `isValidMp3` em cada trecho antes de juntar. Se algum vier corrompido, faço fallback para 1 chamada única do roteiro inteiro (comportamento atual) — assim nunca quebra.
5. Dedup atual por `audio_hash` do texto completo continua igual (reaproveita o MP3 final inteiro quando o roteiro já existe — economia máxima, 0 token).

### Pausas naturais

Entre segmentos coloco um silêncio curto (~120 ms de MP3 silencioso pré-gerado, ficando em `/public/audio/silence-120ms.mp3`) pra evitar emendas estranhas. Sem isso, junção fica seca demais.

## Arquivos a mudar

- `src/components/admin/AudioStudio.tsx`
  - novo: `buildSegments(kind, ...)`, `concatMp3Blobs(blobs)`, `stripId3(blob)`.
  - `handleGenerate`: troca `getOrGenerate(textoPreview)` por loop de segmentos + concat. Mantém try/catch com fallback pra chamada única.
- `public/audio/silence-120ms.mp3` (asset novo, 1 KB).

Cache, dedup, MinIO/Supabase upload, vinheta, parser de horário — tudo continua igual.

## Pontos de atenção

- Concatenação de MP3 funciona bem com mesma voz/modelo/bitrate (caso aqui), mas alguns players são chatos com tags ID3 repetidas — por isso o `stripId3` nos segmentos 2+.
- O hash do áudio completo (`audio_hash`) continua sendo do **texto completo**, pra dedup de áudio final não ser afetado.
- Primeira geração paga tudo. A economia aparece da segunda em diante.

Confirma que quer assim que eu implemento.
