## Objetivo

Garantir que o consultor envie exatamente 1 passo por vez, sem o sistema avançar automaticamente para o próximo passo, e melhorar a sensação de demora no botão.

## Plano

1. Ajustar o botão principal do preview de passo
  - Trocar a ação principal de “Seguir fluxo” para envio simples do passo atual.
  - Manter apenas o envio do passo selecionado por padrão, sem `continueFlow=true`.
  - Deixar o texto do botão claro: “Enviar este passo”.
2. Bloquear clique duplo no frontend
  - Em `CaptureStepsList`, impedir novo envio se já houver `sending` em andamento.
  - Fechar/ignorar novas tentativas enquanto o primeiro envio ainda não terminou.
3. Proteger o envio sequencial passo-a-passo
  - Em `SendSequenceDialog`, adicionar uma trava por `ref` para impedir disparos duplicados antes do React atualizar o estado.
  - Garantir que, depois de enviar 1 passo, o sistema fique em “aguardando resposta” e não envie o próximo sozinho.
4. Corrigir a causa backend do “envia 2 passos”
  - Em `manual-step-send`, quando vier envio manual da tela de captação, não chamar `buildContinuationPatch` para encadear o próximo passo automaticamente.
  - A função deve mandar somente os itens do passo atual e atualizar o cursor do lead para esse passo.
  - Preservar o mecanismo de continuidade apenas se existir algum uso interno realmente necessário, mas a UI de captação não deve acioná-lo.
5. Melhorar a resposta de demora
  - Manter o botão desabilitado e com loading enquanto envia.
  - Evitar espera extra causada por encadeamento do próximo passo.
  - A demora restante será apenas do envio real dos itens do passo atual, como áudio/texto/mídia.

## Arquivos previstos

- `src/components/captacao/CaptureStepPreview.tsx`
- `src/components/captacao/CaptureStepsList.tsx`
- `src/components/captacao/SendSequenceDialog.tsx`
- `supabase/functions/manual-step-send/index.ts`

## Resultado esperado

Ao clicar em enviar, o sistema manda somente o passo escolhido, uma única vez. O próximo passo só será enviado quando o consultor clicar novamente, depois da resposta do lead ou quando decidir forçar manualmente.  
  
Se for conta de luz ele extrai os dados normamelte ou se for o documento tambem e ja preenche em ficha facilitando para o usuario.