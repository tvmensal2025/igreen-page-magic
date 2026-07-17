# Áudio do nome com entonação de chamada (`!`)

## Objetivo
Manter as reticências `...` (respiro/tempo) e trocar o fecho `.` / `...` do **nome** por **`!`**, para o TTS entonar como chamada.

Resultado:
- Saudação: `"Olá, Fernandinho."` → **`"Olá... Fernandinho!"`**
- Só nome (costurado antes do corpo): `"Fernandinho."` → **`"Fernandinho!"`**
- Idem para "Então, Maria." → `"Então... Maria!"` e "Oi, João." → `"Oi... João!"`.

## Onde muda (3 arquivos + 2 testes)

1. **`supabase/functions/_shared/tts-ptbr-anchor.ts`** — edge (WhatsApp + Velip)
   - `formatNameGreetForTts`: gera `"{Lead}... {Nome}!"` (era `"{Lead}... {Nome}..."`); fallback sem "Olá/Oi/Então" também termina em `!`.
   - `buildNameOnlyTtsText`: retorna `"{Nome}!"` (era `"{Nome}."`).
   - `buildOlaGreetTtsText` reaproveita `formatNameGreetForTts` → herda o `!`.

2. **`src/lib/ttsEnhanceV3.ts`** — mirror front-end/Estúdio
   - `formatNameGreetForTts`: mesmo padrão `"Olá... Nome!"`.
   - `ensureSoftEdges` **não muda** (afeta texto geral, não é o cumprimento).

3. **`supabase/functions/_shared/voice-dialer/call-stitch.ts`** (linha 100)
   - `` `Olá, ${displayName}.` `` → `` `Olá, ${displayName}!` `` (coerência; o helper normaliza de qualquer forma).

## Testes ajustados
- `src/lib/ttsEnhanceV3.test.ts`: `"Olá... Maria!"`, `"Então... Maria!"`, `"Olá... Ana!"`, `formatNameGreetForTts("Então, João.") === "Então... João!"`.
- `supabase/functions/_shared/tts-ptbr-anchor_test.ts`:
  - `buildOlaGreetTtsText("Fernandinho") === "Olá... Fernandinho!"`
  - `buildNameOnlyTtsText("Fernandinho") === "Fernandinho!"`
  - `formatNameGreetForTts("Então, Maria.") === "Então... Maria!"`

## Cache
`voice_call_renders` e `wa_audio_name_cache` são chaveados pelo texto TTS. Como o texto muda (`.` → `!`), novas gerações criam entradas novas sem colidir com o cache antigo — sem invalidação manual.

## Fora de escopo
- `voice_settings` (estabilidade/velocidade) permanecem iguais.
- Textos gerais (fora do cumprimento/nome) seguem com o comportamento atual de `ensureSoftEdges`.
