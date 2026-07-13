---
name: Voice Templates Feature
description: Templates de voz costurados (parte fixa + nome do lead) por consultor
type: feature
---
Templates de voz no /admin WhatsApp > Templates > aba "Voz personalizada".
- Tabelas: voice_templates, voice_template_blocks (kind: fixed_audio|name_slot|variable_slot), voice_name_clips (biblioteca de nomes do consultor), voice_template_renders (cache).
- Edge `voice-template-stitch`: concatena OGG/Opus por byte-concat (gravador usa sempre 16kHz mono frame 20ms via opusRecorderLoader), cacheia em voice_template_renders por (template_id, name_normalized) e sobe via upload-media (scope=template).
- Match de nome: name_normalized (NFD, sem acento, lowercase, _) — tenta nome completo, depois primeiro pedaço.
- Resposta 409 com `error:"name_not_recorded"` → UI mostra gravador inline pro consultor gravar o nome faltante.
- Toda mudança de bloco/nome invalida cache (delete em voice_template_renders).
- Envio no chat: `VoiceTemplatePicker` em `MessageComposer` (e bot via `channel-sender` quando o passo tem `voice_template_id`). Não é PSTN — áudio WhatsApp (OGG), separado do módulo Ligação/Velip.
