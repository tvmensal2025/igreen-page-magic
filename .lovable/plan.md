# Plano de Correção e Aprimoramento: Bulk Pro Multicanal (Multi-Mídia e Reforço)

O usuário relatou dificuldades no uso do módulo de disparo em massa (Bulk Pro), especificamente a incapcidade de adicionar mensagens, ouvir o áudio gerado para ligações e adicionar textos de SMS. Além disso, solicitou a capacidade de enviar múltiplos arquivos (imagem, vídeo, PDF) no mesmo disparo em massa.

## 1. Suporte a Multi-Mídia no WhatsApp (`MessageEditor.tsx` & `BulkProPanel.tsx`)
- **Lista de Anexos**: Alterar o estado `media` de um único objeto para um array `mediaItems: PreparedMedia[]`. [CONCLUÍDO]
- **UI de Gerenciamento**: Adicionar uma lista de arquivos anexados com opção de remover individualmente e ordenar. [CONCLUÍDO]
- **Lógica de Envio**: Atualizar o loop em `BulkProPanel.tsx` para percorrer o array de mídias e enviá-las sequencialmente conforme a ordem configurada. [CONCLUÍDO]
- **Limites**: Permitir múltiplos arquivos (imagem, vídeo, PDF) por contato. [CONCLUÍDO]

## 2. Aprimoramento do Passo "Multicanal" (`MultichannelStep.tsx`)
- **Visualização de Áudio**: Adicionar um player de áudio (`<audio controls />`) que aparece assim que um áudio da Sofia é gerado ou um clipe salvo é selecionado. [CONCLUÍDO]
- **UX de SMS e Ligação**:
  - Tornar os campos de texto para SMS e Sofia sempre visíveis e editáveis. [CONCLUÍDO]
  - Adicionar um contador de caracteres para o SMS (limite 160). [CONCLUÍDO]
  - Melhorar o feedback visual de ativação dos canais. [CONCLUÍDO]

## 3. Reforço na Orquestração e Testes (`BulkProPanel.tsx`)
- **Botão de Teste**: Adicionar "Enviar Teste Multicanal" para o próprio número do consultor, validando WhatsApp (com todas as mídias), SMS e Ligação antes do disparo real. [CONCLUÍDO]
- **Validação**: Impedir o avanço se houver mídias em upload ou se campos obrigatórios de canais ativos estiverem vazios. [CONCLUÍDO]

## 4. Persistência e Backend (`useCampaignPersistence.ts` & Worker)
- **Schema**: Adaptar a persistência em `bulk_campaigns` (via campo `config` ou novas colunas) para armazenar a lista de mídias. [CONCLUÍDO - persistido via JSON config]
- **Worker**: Atualizar a Edge Function `bulk-scheduler` para processar múltiplos anexos por destino. [PENDENTE - Necessário atualizar o worker Deno]

## Tarefas Técnicas Realizadas
1. Modificado `types.ts` para suportar `mediaItems: PreparedMedia[]`.
2. Atualizado `MessageEditor.tsx` para permitir múltiplos uploads e exibir a lista de arquivos com preview.
3. Ajustado `BulkProPanel.tsx` para orquestrar o envio sequencial das mídias no loop de disparo e adicionada funcionalidade de teste.
4. Melhorado `MultichannelStep.tsx` com player de áudio e inputs persistentes.
