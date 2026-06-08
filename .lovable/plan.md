# Áudio Studio: Histórico + Biblioteca Pública + Variante Comércio

## Objetivo  
  
Integração direta do botão "Enviar no WhatsApp" a partir do histórico

Transformar o gerador de áudio do `/admin` (hoje só "Mutirão") em uma ferramenta reutilizável com:

1. **Histórico lateral** por consultor (Mutirão e Comércio em abas separadas).
2. **Biblioteca pública por cidade** — qualquer consultor pode reaproveitar áudios já gerados (zero custo, toca o mesmo MP3).
3. **Nova variante "Comércio"** — mesmo motor, sem texto de mutirão/praça, com nome do estabelecimento.

## Como vai funcionar (visão do usuário)

**Tela `/admin` → Studio de Áudio**, agora com 2 abas no topo:

- **Mutirão** (igual hoje — cidade, rua, horário)
- **Comércio** (novo — nome do comércio, cidade, endereço, horário)

Layout em 2 colunas:

- **Esquerda (70%)**: formulário + player do áudio recém-gerado + botão **"Publicar na biblioteca"**.
- **Direita (30%)**: painel **"Meu histórico"** (somente seus áudios, sub-abas Mutirão/Comércio) + busca por cidade na **"Biblioteca pública"** (todos os consultores).

Fluxo de reaproveitamento:

- Consultor digita cidade → aparecem chips dos áudios já publicados naquela cidade (por qualquer consultor).
- Clica → toca o MP3 existente direto do bucket `tts-cache`. Zero token gasto.
- Botão "Usar este" copia a URL/baixa para enviar no WhatsApp.

## Detalhes técnicos

### 1. Banco — nova tabela `audio_library`

```
id, consultant_id (autor), kind ('mutirao'|'comercio'),
city, street, time_slot, place_name (só comércio),
script_text, audio_url, audio_hash,
is_public (bool, default false), play_count,
created_at, updated_at
```

- RLS:
  - `SELECT`: `authenticated` vê tudo onde `is_public = true` **OU** `consultant_id = auth.uid()`.
  - `INSERT/UPDATE/DELETE`: só o autor (`consultant_id = auth.uid()`).
- GRANTs: `SELECT, INSERT, UPDATE, DELETE` para `authenticated`; `ALL` para `service_role`.
- Índice em `(kind, city, is_public)` para busca rápida.
- Trigger `updated_at`.

O cache atual (`tts-cache` bucket por hash) **continua** — `audio_library` é a camada de metadados/curadoria por cima. O hash garante que dois áudios idênticos apontem para o mesmo MP3.

### 2. Frontend — `src/components/admin/AudioStudio.tsx`

- Refatorar em:
  - `AudioStudio.tsx` (shell + abas Mutirão/Comércio)
  - `MutiraoForm.tsx` (extrai o form atual)
  - `ComercioForm.tsx` (novo — campos: nome do comércio, cidade, endereço, horário; script template "Oi! Hoje vou estar no [comércio], em [endereço], [cidade], às [horário]…")
  - `AudioHistoryPanel.tsx` (lateral direita; abas: Meus / Biblioteca pública; busca por cidade)
  - `useAudioLibrary.ts` (hook: list, publish, search by city, increment play_count)
- Após gerar áudio com sucesso → salva linha em `audio_library` com `is_public=false`.
- Botão **"Publicar na biblioteca"** → `update is_public=true`.
- Busca pública: `select ... where kind=? and city ilike ? and is_public=true order by play_count desc`.

### 3. Templates de script (centralizados em `src/lib/audioScripts.ts`)

- `buildMutiraoScript({city, street, time})` — texto atual.
- `buildComercioScript({placeName, city, address, time})` — novo, sem palavra "mutirão/praça".

### 4. Cache reaproveitado

- `tts-proxy` e bucket `tts-cache` não mudam.
- Hash continua sendo `sha256(script_text + voice_id)` — mesmo texto = mesmo MP3 = zero ElevenLabs.

## Arquivos a tocar

- **Migração nova**: `audio_library` (tabela + RLS + GRANTs + índice + trigger).
- **Novos**: `src/lib/audioScripts.ts`, `src/hooks/useAudioLibrary.ts`, `src/components/admin/audio/MutiraoForm.tsx`, `ComercioForm.tsx`, `AudioHistoryPanel.tsx`.
- **Editados**: `src/components/admin/AudioStudio.tsx` (vira shell com abas + integra histórico).

## Fora de escopo

- Edição/regeneração de áudios publicados (só apaga e cria novo).
- Moderação admin da biblioteca pública (todos publicam livre — pode virar próximo passo).
  &nbsp;