# Plano: garantir que a IA responda sempre nos testes

## Problema atual
- Duas instâncias (`igreen-f9594900e75b` e `igreen-1e77b55a40fe`) apontam para o mesmo número `5514933005667`, causando loop de conexão (`428 refused`) no Evolution.
- Mesmo quando o webhook chega, o lead `5514933005667` está com `manual_review_required=true` e em quarentena (`phone_reset_quarantine`), o que faz o bot pular a resposta.
- Resultado: você manda "oi" e nada volta.

## O que vou ajustar (somente para destravar o teste — sem mexer em código de produção)

1. **Desativar uma das duas instâncias do mesmo número** (somente `status=disconnected` no banco, sem logout no Evolution, sem deletar). Mantenho `igreen-f9594900e75b` (Abel) como ativa por ser a mais recente em logs. Isso encerra o loop `428 refused`.
2. **Liberar o lead 5514933005667 / 5514971254914 da quarentena**:
   - `phone_reset_quarantine.status = 'released'`, `quarantine_until = now()`.
   - `customers.bot_paused = false`, sair de `aguardando_humano`, voltar para o passo inicial do fluxo (`d_welcome`).
3. **Garantir que a instância ativa responda**:
   - Zerar `manual_review_required`, `fatal_lock_until`, `recovery_mode_until` da instância mantida.
   - Confirmar `status=connected` e `connected_phone=5514933005667`.
4. **Forçar modo "sempre responder" durante o teste**:
   - Setar `customers.ai_force_reply = true` (ou flag equivalente já existente — vou checar antes; se não existir, uso `bot_paused=false` + reset do `current_step`).
   - Limpar `conversations.delivery_status` travado para que a próxima mensagem seja processada.

## Verificação
- Você manda "oi" no WhatsApp para o número da instância.
- Eu consulto `engine_logs` + `conversations` dos últimos 2 min e confirmo que a IA respondeu.
- Se ainda não responder, leio os logs da edge `evolution-webhook` para identificar o ponto exato de bloqueio e ajusto.

## O que NÃO vou fazer
- Não vou desconectar/deletar instância no Evolution (apenas marcar como inativa no banco).
- Não vou alterar código do bot/fluxo.
- Não vou mexer em outros leads/consultores.
