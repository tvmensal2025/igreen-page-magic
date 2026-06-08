## O que muda

Hoje as listas "Meus" e "Pública" mostram só um botãozinho de play que toca o áudio no player principal. Vou:

1. **Player inline em cada item** — ao clicar em "Tocar", o item expande e mostra um `<audio controls>` nativo (barra de progresso, volume, tempo). Toca o MP3 público direto, sem chamar a ElevenLabs (zero custo). Fechar = recolhe.
2. **Botão "Enviar no WhatsApp"** em cada item (Meus, Pública e Todos do super admin) — abre um popover idêntico ao `SendViaWhatsAppPopover` dos materiais, pedindo telefone + legenda opcional, e envia o áudio pela instância Evolution conectada do consultor logado.
3. **Mesmas ações no player principal** (logo após gerar) — adiciono o mesmo botão "Enviar no WhatsApp" ao lado de Baixar/Publicar.  
4. o playeronline permite ja escutar com vinheta ou normal e baixar com vinheta e normal

## Backend (edge function)

A `admin-send-material` atual só envia image/video/document via `sendMedia`. Áudio no WhatsApp precisa do endpoint específico do Evolution (`/message/sendWhatsAppAudio/{instance}`, que entrega como PTT/voice note). Duas opções:

- **A. Estender `admin-send-material**` para aceitar `mediatype: "audio"` e rotear para `sendAudio` adicionando essa função em `_shared/whatsapp-api.ts`. (menor superfície)
- **B. Criar `admin-send-audio**` separada. (mais explícito, mas duplica auth/anti-ban/quota)

Vou pela **A** — adiciono `sendAudio(chatId, audioUrl)` em `_shared/whatsapp-api.ts` e um `case "audio"` no `admin-send-material/index.ts` (mantendo checkSendQuota + registerSend + validação JWT).

## Frontend

`**AudioStudio.tsx**` — sem mudar lógica de geração:

- Novo estado `expandedRowId: string | null` para mostrar player inline no item ativo.
- Novo componente local `<RowAudioActions row={row} consultantId={...} />` que renderiza:
  - `<audio src={row.audio_url} controls preload="none" />` quando expandido
  - Botão "WhatsApp" abrindo `<AudioWhatsAppPopover>` (cópia adaptada do `SendViaWhatsAppPopover` chamando `admin-send-material` com `mediatype: "audio"`).
- Botão "WhatsApp" também no painel do áudio recém-gerado (logo abaixo de Publicar).
- Continua tocando via `audio_url` direto (sem chamar TTS), preservando o ganho de custo zero.

## Arquivos tocados

- `src/components/admin/AudioStudio.tsx` — UI: player inline + botões WhatsApp.
- `src/components/admin/AudioWhatsAppPopover.tsx` — novo, baseado no `SendViaWhatsAppPopover`.
- `supabase/functions/_shared/whatsapp-api.ts` — adiciona `sendAudio`.
- `supabase/functions/admin-send-material/index.ts` — aceita `mediatype: "audio"`.

## Fora de escopo

- Não mudo geração, cache TTS, RLS nem schema.
- Não toco no bucket `tts-cache` (separado).
- Não adiciono envio em massa — só 1-pra-1 por enquanto.