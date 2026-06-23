Diagnóstico encontrado

- O número analisado é `5511971254913` / `11971254913`.
- A conversa atual tem apenas dois inbounds registrados: `Oi` e um arquivo da conta. Não existe resposta outbound gravada em `conversations` depois do arquivo.
- O cliente atual ficou no customer `3435a944-0bce-44e9-aab4-e0676270da84`, passo `3d69389d-92bb-4e85-a8f6-e66fe16906e9`, que é o step `capture_conta` do Fluxo A/Cadastro.
- O estado v3 (`customer_flow_state`) ficou `paused_system`, `pause_reason=retry_exhausted`, `retries=3`, com `flow_id=null`.
- O log mostra que o WHAPI baixou a mídia e o router-bridge detectou corretamente `UUID capture_conta -> engine=sys`, mas depois o gate do Cérebro ainda classificou cadastro usando `CADASTRO_STEPS.has(stepBefore)`. Como `stepBefore` era UUID, `_emCadastro=false`, então o turno ainda pôde cair no caminho conversacional/sombra em vez de ser tratado como cadastro determinístico.
- No Evolution existe um segundo problema: ele ainda não tem o mesmo flag `bridgeForcedSysForCapture` do WHAPI. Depois de forçar `engine=sys`, o bloco seguinte pode reverter para `engine=flow` e limpar `conversation_step`, exatamente o bug que já havia sido corrigido no WHAPI.

Conclusão

O fluxo salvo de 5 passos não é o único problema. O problema real é de roteamento: steps customizados de cadastro por UUID precisam ser tratados como cadastro determinístico em todos os gates, não só no primeiro bridge. Enquanto isso não for corrigido, criar outro fluxo com os mesmos passos pode repetir a falha.

Plano de correção

1. Corrigir o WHAPI para reconhecer UUID de cadastro também no gate do Cérebro
   - Criar um booleano compartilhado para indicar que o UUID atual foi identificado como step de cadastro/captura.
   - Usar esse booleano em `_emCadastro`, além de `CADASTRO_STEPS.has(stepBefore)`.
   - Resultado esperado: quando o cliente estiver em UUID `capture_conta`, `capture_documento`, `capture_email`, `confirm_phone` ou `finalizar_cadastro`, mídia/texto esperado sempre vai para `runBotFlow`, nunca para o caminho conversacional.

2. Corrigir o Evolution com a mesma blindagem do WHAPI
   - Adicionar `bridgeForcedSysForCapture` no `evolution-webhook/index.ts`.
   - Impedir que o bloco seguinte reverta `engine=sys` para `engine=flow` quando o bridge acabou de detectar um UUID de cadastro.
   - Também usar o mesmo booleano no `_emCadastro` do gate do Cérebro.
   - Resultado esperado: WHAPI e Evolution ficam simétricos e nenhum dos dois engole mídia de cadastro.

3. Garantir que o estado v3 não pause indevidamente um lead legado/custom de cadastro
   - Ajustar o hook v3/dark ou o gate de uso para não usar `customer_flow_state` com `flow_id=null` como fonte de pausa operacional para o fluxo legado/custom.
   - O v3 em modo dark deve observar e logar, mas não deve transformar o lead em `paused_system/retry_exhausted` quando o legado ainda é a fonte real.

4. Recuperar o lead 11971254913 para novo teste limpo
   - Limpar a pausa sistêmica do customer atual `3435a944-0bce-44e9-aab4-e0676270da84`.
   - Resetar `customer_flow_state.status` para rodar novamente, `pause_reason=null`, `retries=0`, `last_outbound_content_hash=null`.
   - Manter ou recolocar `conversation_step` no UUID correto de `capture_conta` do fluxo Cadastro.
   - Assim o próximo arquivo enviado pelo número deve passar pelo OCR real.

5. Revisar o Fluxo A/Cadastro salvo
   - Confirmar os 5 steps ativos e em ordem: conta, documento, email, confirmar telefone, finalizar cadastro.
   - Aplicar a reescrita polida dos 5 textos se ainda não foi aprovada/aplicada.
   - Confirmar que o step 1 tem `captures` preenchido, pois hoje ele já tem captura de mídia configurada.

6. Validar com evidência
   - Enviar/receber nova mídia no número de teste.
   - Conferir logs esperados: router-bridge, cadastro determinístico, custom-step-resolver, OCR da conta, atualização de dados da conta e avanço para documento.
   - Confirmar que aparece pelo menos um outbound depois do PDF e que o lead não volta para `paused_system/retry_exhausted`.

Arquivos prováveis

- `supabase/functions/whapi-webhook/index.ts`
- `supabase/functions/evolution-webhook/index.ts`
- Possivelmente `supabase/functions/_shared/engine/webhook-hook.ts` ou o ponto onde o v3 dark é chamado
- Banco: reset pontual do customer/flow state do número `11971254913`

O que não farei

- Não vou alterar a estrutura dos steps do Flow Builder sem necessidade.
- Não vou mexer em frontend.
- Não vou criar arquivos de TODO/resumo separados.