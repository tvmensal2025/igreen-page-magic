Plano para melhorar as mensagens e o comportamento fora do fluxo sem quebrar o que já existe:

1. Revisar as fontes reais de mensagens
   - Auditar os textos hardcoded em `supabase/functions/whapi-webhook/handlers/bot-flow.ts`.
   - Auditar os fallbacks de templates em `handlers/conversational/templates.ts` para Whapi e Evolution.
   - Verificar seeds/migrations de mensagens de fallback para não corrigir só texto “morto”.
   - Se houver mensagens ativas em `bot_messages`, preparar uma correção segura via migration/update controlado, preservando variantes e mídias.

2. Padronizar gramática e tom de voz
   - Corrigir pontuação, concordância e frases repetidas.
   - Trocar informalidades excessivas por um tom WhatsApp profissional e humano, sem deixar robótico.
   - Padronizar chamadas como “envie”, “aguarde”, “em breve alguém responde aqui” e mensagens de handoff humano.
   - Manter emojis úteis, mas reduzir redundância e frases como “já já”, “pra”, “a gente tava”, “instantinho”, quando prejudicarem a clareza.

3. Melhorar perguntas fora do fluxo
   - Preservar o comportamento atual do `respondAndReentry`: responder dúvida via FAQ/IA/fallback e depois voltar ao mesmo passo.
   - Ajustar a mensagem de retorno para ficar mais clara, por exemplo: resposta da dúvida + “Voltando ao cadastro: [pergunta pendente]”.
   - Garantir que perguntas em etapas de coleta (`ask_email`, `ask_cep`, `aguardando_conta`, documento etc.) não avancem o fluxo por engano.
   - Manter o limite de muitas dúvidas para chamar humano, apenas melhorando o texto enviado ao cliente.

4. Garantir captura de informações mesmo fora da ordem
   - Revisar o extrator multi-campo já existente, que tenta capturar nome, CEP, valor, CPF, e-mail e telefone em mensagens livres.
   - Fortalecer sem mudar a regra central: se o lead responder uma informação útil fora do passo atual, salvar o dado quando for seguro, mas continuar conduzindo para a pergunta pendente.
   - Evitar sobrescrever dados fortes de OCR/manual com texto fraco do cliente.

5. Cobrir Whapi e Evolution sem alterar a arquitetura
   - Aplicar os mesmos ajustes de texto nos templates equivalentes dos dois canais quando houver paridade.
   - Não reescrever a máquina de estados nem a integração com OCR, Portal Worker, MinIO ou OTP.
   - Não mudar passos, IDs, triggers ou estrutura de banco além do necessário para textos ativos.

6. Validar o fluxo principal e os desvios
   - Testar cenários essenciais: pergunta fora do fluxo durante coleta, retorno ao passo correto, envio de dado válido depois do desvio, handoff por muitas dúvidas e textos de confirmação.
   - Conferir que `conversation_step` permanece igual durante dúvidas e só avança quando a resposta esperada chega.
   - Validar que mensagens corrigidas não quebram markdown do WhatsApp, variáveis como `{{nome}}`/`{{representante}}` e botões/opções numeradas.

Resultado esperado:
- Mensagens com português mais correto e consistente.
- Lead pode perguntar algo fora do fluxo, receber resposta e voltar naturalmente ao cadastro.
- Informações úteis enviadas fora da ordem continuam sendo aproveitadas quando seguro.
- O fluxo existente permanece preservado, sem mudanças arriscadas na lógica principal.