# Validação final do fluxo variante D

Antes de você reiniciar a conversa do lead `11971254913`, preciso concluir 3 ações para garantir que tudo está coerente.

## 1. Migração de limpeza do lead (pendente)
Resetar o estado contaminado do lead `42d4821f-1d75-4162-b0c2-8613fa19b960`:
- Limpar `document_type`, `document_front_url`, `document_back_url`, `cpf`, `rg`, `birth_date`
- Voltar `conversation_step` para `aguardando_doc_auto`
- Limpar `media_collected` referente a documentos
- Manter `account_*` (conta de luz já validada) para não repetir essa etapa

## 2. Auditoria de mídias da variante D (pendente)
- Desativar em `ai_media_library` mídias do passo `d_como_funciona` que estavam disparando após a conta confirmada
- Confirmar que `aguardando_doc_auto`, `aguardando_doc_verso` e `confirm_phone` têm apenas 1 mídia/prompt ativo cada

## 3. Verificação dos handlers já editados
Reler `whapi-webhook/handlers/bot-flow.ts` e `evolution-webhook/handlers/bot-flow.ts` para confirmar:
- Skip pós-conta funciona (não reenvia "como funciona")
- Preflight em `aguardando_conta` rejeita CNH/RG
- Threshold de confiança no `detectDocumentTypeDetailed` (0.62 CNH / 0.78 outros)
- `aguardando_doc_verso` valida que o arquivo recebido é mesmo verso (não CNH/conta)
- `buildMissingDocPrompt` consolida CPF+RG+nascimento em uma única mensagem

## Detalhes técnicos
- Migração: UPDATE em `leads` + DELETE filtrado em `lead_media` (apenas docs) + UPDATE em `ai_media_library.active=false` para mídias `d_como_funciona` órfãs
- Sem mudanças de schema, apenas dados
- Deploy automático de `whapi-webhook` e `evolution-webhook` após qualquer ajuste fino

## Saída esperada
Ao reiniciar a conversa com `11971254913`:
1. Bot pula direto para `aguardando_doc_auto` (conta já confirmada)
2. CNH enviada → OCR extrai tudo → vai para `d_resultado` sem pedir verso/CPF/RG separados
3. Se OCR ambíguo → pergunta "É RG ou CNH?" em vez de chutar
4. Sem duplicação de mensagens

Aprove para eu rodar a migração de limpeza e a auditoria de mídias.