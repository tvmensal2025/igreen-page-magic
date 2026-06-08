# Corrigir geração de áudio + Histórico do Super Admin

## Diagnóstico (o que eu já verifiquei)

1. **Não existe áudio antigo para recuperar.** Procurei em `audio_library` (vazia), `ai_media_library` (só áudios de gravações de voz, nenhum MP3 de mutirão/comércio) e no bucket `ai-agent-media` (zero arquivos `.mp3`). Os "áudios gerados" anteriores ficaram só no cache local do navegador (IndexedDB), não no servidor.
2. **O bucket `tts-cache` NÃO existe.** A migração anterior que tentou criá-lo falhou silenciosamente. Por isso toda nova geração precisa chamar a ElevenLabs do zero — gasta token e o cache compartilhado entre consultores nunca funcionou.
3. **A última tentativa nem chegou a chamar a ElevenLabs.** Nas requisições de rede capturadas, não há nenhuma chamada para `tts-proxy`. Significa que o erro aconteceu antes — provavelmente uma validação travou ou o botão não disparou.

## O que vou fazer

### 1. Criar o bucket `tts-cache` (faltando)

Via tool `supabase--storage_create_bucket` (público, 5MB, `audio/mpeg`) + políticas de leitura pública e upload autenticado em `storage.objects`. Sem isso, o reaproveitamento de token nunca funciona.

### 2. Super admin enxerga TUDO no histórico

Ampliar a política RLS de `SELECT` em `audio_library`:

```sql
USING (consultant_id = auth.uid() OR is_public = true OR is_super_admin(auth.uid()))
```

E, no painel lateral do `AudioStudio.tsx`, quando o usuário for super admin, adicionar uma **3ª aba "Todos (super admin)"** que lista os áudios de todos os consultores com o nome do dono. Detecção via hook `useUserRole`/`is_super_admin` que já existe no projeto.

### 3. Diagnóstico do erro de geração

Para descobrir POR QUE deu errado preciso da mensagem exata. Vou adicionar logs detalhados (`console.error`) em cada etapa de `handleGenerate` (TTS → decode → concat → encode → upload → insert) para que da próxima vez o erro apareça claro no console e no toast. Também vou trocar o `confirm()` nativo (que pode estar bloqueado) por toast de erro mais informativo.

### 4. Backfill (não tem o que recuperar)

Confirmei via banco que não há MP3 de mutirão/comércio salvo em lugar nenhum. Os áudios em `ai_media_library` são gravações de voz (boas-vindas, "como funciona a energia") e continuam aparecendo na biblioteca normal — não são geração TTS de mutirão.

## Arquivos a tocar

- **Bucket novo**: `tts-cache` (via tool, não SQL).
- **Migração**: ampliar RLS `SELECT` de `audio_library` para incluir super admin.
- **Editado**: `src/components/admin/AudioStudio.tsx` — aba "Todos" para super admin + logs detalhados em `handleGenerate`.

## Preciso de você

Para fechar o diagnóstico do erro: **quando você clicou em "Gerar Áudio de Comércio", qual mensagem apareceu?** (toast vermelho, popup, ou simplesmente nada aconteceu?) Pode me dizer e eu termino de corrigir junto com as outras 3 entregas.  
  
o audio foi gerado

&nbsp;