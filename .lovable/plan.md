Diagnóstico confirmado:

- Na última conversa do telefone `5511971254913`, o lead estava corretamente em `aguardando_doc_auto`.
- O PDF do documento foi baixado com sucesso pela Evolution e salvo no MinIO.
- A falha aconteceu antes do OCR do documento: o classificador `detectDocumentTypeDetailed` chamou Gemini direto e recebeu `429` em todas as tentativas.
- Por causa disso, ele retornou `tipo=outro, source=fallback, motivo=não identificado`, e o bot rejeitou o arquivo como se não fosse RG/CNH.
- O OCR real do documento nem chegou a rodar. O OCR principal já usa Lovable AI Gateway; quem quebrou foi só a etapa anterior de classificação RG/CNH.

Plano de correção:

1. Corrigir o classificador de documento compartilhado
   - Alterar `supabase/functions/_shared/detect-doc-type.ts`.
   - Quando a chamada direta ao Gemini falhar por `429`, timeout, resposta vazia ou sem JSON, tentar classificar via Lovable AI Gateway usando `LOVABLE_API_KEY`.
   - Manter a rejeição `tipo=outro` apenas quando a IA realmente responder que o arquivo é conta, selfie, boleto, print etc.

2. Fail-open seguro quando a classificação estiver indisponível
   - Se todas as tentativas de classificação falharem por quota/erro técnico, não rejeitar o arquivo como `outro`.
   - Retornar `rg_antigo` com baixa confiança e motivo técnico, deixando o fluxo seguir para o OCR real.
   - Assim, documento válido não fica bloqueado por falha do classificador. Se for arquivo errado, o OCR/retry do próprio passo trata depois.

3. Preservar comportamento dos próximos passos
   - Não mudar a sequência conta → simulação → documento.
   - Não mexer no banco nem criar migration.
   - A correção vale para `evolution-webhook` e `whapi-webhook`, porque ambos usam o mesmo `_shared/detect-doc-type.ts`.

4. Validar o fluxo crítico
   - Conferir testes/rotas existentes de OCR e fallback.
   - Validar pelos logs esperados:
     - não aparecer mais rejeição `tipo=outro source=fallback motivo=não identificado` quando o erro real for `429`;
     - após receber documento, o bot deve avançar para `aguardando_doc_verso`, `ask_cpf` ou `confirmando_dados_doc`, conforme o tipo/dados lidos;
     - o lead não deve ficar preso pedindo o mesmo documento por erro de quota do classificador.