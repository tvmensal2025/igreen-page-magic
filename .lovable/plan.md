## Diagnóstico confirmado

- O áudio novo foi gerado no Storage (`tts-cache/multichannel-a2/masculino-1784308670894.mp3`), mas ele não está sendo usado no envio real do WhatsApp.
- O fluxo real do WhatsApp não lê `src/lib/multichannelApprovedAudios.ts` para esse envio. Ele usa a tabela `ai_media_library`.
- Para o consultor Rafael, o corpo masculino ativo ainda é o arquivo antigo:
  - slot: `a2_audio_activate_name__body_masculino`
  - URL ativa: `multichannel-a2_audio_activate_name_body_masculino_1784290750771.mp3`
- O áudio “Olá Felipe” já foi montado como stitch e ficou em cache:
  - slot: `stitch:a2_audio_activate_name:ola6:masculino:felipe`
- Por isso “nada mudou”: o sistema reutilizou o corpo masculino antigo e também pode reutilizar stitches antigos já montados.
- O problema de pronúncia citado é na palavra “diga”, dentro do corpo fixo masculino.

## Plano de correção

1. Ajustar o texto fonte do corpo masculino A2 para o ElevenLabs pronunciar melhor “diga”.
   - Manter o feminino intacto.
   - Trocar apenas no masculino a grafia enviada ao TTS, por exemplo de “me diga” para uma forma fonética/mais natural como “me díga” ou “me fala”.
   - Recomendo “me fala” se você aceitar pequena mudança de texto, porque reduz o risco de pronúncia ruim.

2. Regerar o corpo masculino A2 pela função `regen-a2-audio`.
   - Confirmar resposta da ElevenLabs.
   - Confirmar novo arquivo no bucket `tts-cache` com tamanho/data nova.

3. Promover o novo arquivo para o slot real usado pelo WhatsApp.
   - Desativar o registro antigo ativo em `ai_media_library` para `a2_audio_activate_name__body_masculino`.
   - Inserir/ativar o novo registro no mesmo slot, com `text_content` atualizado.
   - Não mexer no slot feminino.

4. Limpar os stitches masculinos antigos afetados.
   - Desativar pelo menos o cache de `stitch:a2_audio_activate_name:ola6:masculino:felipe`.
   - Idealmente desativar todos os stitches `stitch:a2_audio_activate_name:ola6:masculino:%`, porque todos foram montados com o corpo antigo e continuariam tocando a pronúncia errada.

5. Testar com “Felipe”.
   - Rodar o fluxo/geração para montar um novo stitch usando o corpo masculino novo.
   - Verificar logs do `whapi-webhook` mostrando `corpo FIXO reutilizado slot=a2_audio_activate_name__body_masculino` após a troca.
   - Confirmar que o novo stitch aponta para arquivo criado depois da correção.

## Detalhe técnico

A causa principal não é apenas a geração do MP3. Existem duas camadas de cache:

```text
ElevenLabs gera corpo masculino novo
        ↓
Storage recebe MP3 novo
        ↓
ai_media_library precisa apontar o slot ativo para esse MP3
        ↓
stitch por nome precisa ser recriado, senão continua usando o MP3 antigo
```

Sem atualizar `ai_media_library` e limpar os stitches antigos, o WhatsApp continua tocando o áudio anterior mesmo que exista arquivo novo no Storage.