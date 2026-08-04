# Plano de Correção e Aprimoramento: Bulk Pro Multicanal

O usuário relatou dificuldades no uso do módulo de disparo em massa (Bulk Pro), especificamente a incapacidade de adicionar mensagens, ouvir o áudio gerado para ligações e adicionar textos de SMS. Este plano visa tornar a experiência 100% funcional, intuitiva e auditável.

## 1. Aprimoramento do Passo "Multicanal" (`MultichannelStep.tsx`)
- **Visualização de Áudio**: Adicionar um player de áudio (`<audio controls />`) que aparece assim que um áudio da Sofia é gerado ou um clipe salvo é selecionado.
- **UX de SMS e Ligação**:
  - Tornar os campos de texto para SMS e Sofia sempre visíveis (ou mais destacados) para evitar a sensação de que "não dá para adicionar".
  - Adicionar um contador de caracteres para o SMS (limite 160).
  - Melhorar o feedback visual de quando a opção está ativa ou inativa.
- **Seleção de Clipe**: Mostrar claramente a URL/URL do áudio selecionado.

## 2. Reforço na Orquestração (`BulkProPanel.tsx`)
- **Testes Unitários**: Adicionar um botão "Testar Envio Multicanal" que permite enviar 1 SMS e 1 Ligação de teste para o número do próprio consultor (ou um número à escolha) antes de iniciar o disparo em massa.
- **Persistência**: Garantir que as configurações de SMS e Ligação sejam salvas corretamente no estado local e enviadas para o worker `bulk-scheduler`.
- **Validação**: Impedir o avanço para o passo de Envio se o usuário ativou SMS ou Ligação mas não forneceu o texto/áudio.

## 3. UI/UX do Editor de Mensagem WhatsApp (`MessageEditor.tsx`)
- Verificar se o `Textarea` está perdendo foco ou falhando em atualizar o estado.
- Garantir que a pré-visualização mobile reflita mudanças instantaneamente.

## 4. Estabilidade do Worker (`bulk-scheduler`)
- Verificar se a Edge Function `bulk-scheduler` está lendo os campos `sendSms` e `makeCall` da configuração persistida para disparar as subtarefas Velip.

## Tarefas Técnicas
1. Modificar `MultichannelStep.tsx` para incluir o player de áudio e melhorar os inputs.
2. Modificar `BulkProPanel.tsx` para adicionar a função de teste multicanal e validações.
3. Ajustar `types.ts` para garantir que os campos multicanal tenham valores default seguros.
4. Validar o fluxo completo com uma simulação de disparo.
