# AGENTS — pos-venda-audio-prep

Domínio: `#pos-venda`.

## Papel
Pré-gera TTS (ElevenLabs) dos marcos due (atrasados + 48h) em `pos_venda_prepared_audio`.
**Não envia** WhatsApp. Roda mesmo fora da janela 08–20.

## Consumo
`pos-venda-auto-progress` usa o áudio se `saudacao_bucket` = bucket BRT na hora do envio.

## NÃO
Gravar `media_url` legado em default_media · misturar com `scheduled_messages`.
