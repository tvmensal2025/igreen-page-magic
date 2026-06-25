## Auditoria do Fluxo D aplicado acima

Encontrei uma causa provável para a falha continuar: a correção anterior foi aplicada no fluxo errado/fora do caminho usado em produção.

### O que está acontecendo

1. **O Fluxo D corrigido não é o fluxo que o webhook está usando para Rafael**
   - O consultor real dos leads recentes é `Rafael Ferreira` com `consultant_id = 0c2711ad-4836-41e6-afba-edd94f698ae3`.
   - O `superadmin_consultant_id` também é esse mesmo ID.
   - O fluxo D ativo corrigido é `b643764c-adb5-47cf-8951-4db109e85f39`, mas ele está com:
     - `consultant_id = 11111111-2222-3333-4444-555555555555`
     - `is_public = false`
   - Resultado: o resolvedor de fluxo não encontra esse fluxo para Rafael.

2. **O Fluxo D público que os leads recentes usaram está inativo e ainda com transições antigas**
   - O fluxo público antigo `320bf22c-e383-4f53-a3c0-b88b89b02558` está `is_public = true`, porém `is_active = false`.
   - As transições reais dos leads recentes apontam para steps desse fluxo antigo, por exemplo:
     - `aee7b26c...` = `d_welcome`
     - `c87d76f8...` = `d_como_funciona`
   - Nesse fluxo antigo, `Quero me cadastrar` ainda aponta para `aguardando_conta`, não para documento.
   - Isso explica por que a auditoria anterior parecia correta no fluxo analisado, mas o cliente real ainda falhou.

3. **Há leads D parados em etapas de cadastro**
   - Lead recente `078a7450` ficou em `aguardando_conta` depois de “Quero me cadastrar”.
   - Lead recente `603d6f4e` chegou em `aguardando_doc_auto`, mas permanece pendente mesmo com conta/documento/email preenchidos, indicando possível travamento no avanço posterior.
   - Lead `75c969d1` chegou até `aguardando_facial`/assinatura, então o pipeline consegue finalizar em alguns casos, mas não está 100% confiável.

4. **Há alerta operacional separado no pós-cadastro/OTP**
   - `portal-otp-watchdog` registra repetidamente: `quota bloqueada whapi-superadmin: instance_not_found`.
   - Isso não é a causa do primeiro clique do Fluxo D, mas pode afetar recuperação/envios automáticos após cadastro/OTP.

## Plano de correção

### 1. Corrigir a fonte de verdade do Fluxo D
- Definir qual fluxo D deve ser o oficial para produção.
- Minha recomendação: promover `b643764c-adb5-47cf-8951-4db109e85f39` como o Fluxo D público/oficial do superadmin:
  - `consultant_id = 0c2711ad-4836-41e6-afba-edd94f698ae3`
  - `is_public = true`
  - `is_active = true`
  - `variant = D`
  - `sync_mode = custom` ou manter compatível com o resolvedor atual.
- Desativar ou deixar claramente fora de uso o fluxo D antigo `320bf22c...` para evitar colisão.

### 2. Reaplicar/garantir as transições críticas no fluxo que realmente roda
- Confirmar no fluxo oficial que todos os caminhos abaixo apontam direto para `d_pedir_documento`:
  - `d_welcome` → `Cadastro rápido`
  - `d_como_funciona` → `Quero me cadastrar`
  - `d_resultado` → `Quero me cadastrar`
  - `d_simular_resultado` → `Quero me cadastrar`
  - `d_duvidas` → `cadastrar`
  - `d_como_funciona_copy_qwpu` → `Continuar Cadastro`
- Remover qualquer rota antiga que mande `Quero me cadastrar` para `aguardando_conta`, salvo quando a pessoa escolheu simulação completa e ainda não mandou conta.

### 3. Blindar o resolvedor para não cair no fluxo errado
- Ajustar/validar `resolveFlowId` para que, quando `flow_ab_mode = only_D`, ele nunca caia silenciosamente em um fluxo de variante A.
- Se não houver fluxo D público/ativo, deve registrar erro claro ou cair em um fallback D válido, não em `Cadastro` variante A.

### 4. Corrigir leads que ficaram presos
- Reposicionar os leads D recentes travados para o step correto conforme o que já possuem:
  - Se já tem conta e documento/e-mail: avançar para a próxima etapa pendente segura.
  - Se não tem documento: colocar em `aguardando_doc_auto` e pedir documento.
  - Se só falta conta: manter em `aguardando_conta`.
- Registrar transição em `bot_step_transitions` para auditoria.

### 5. Auditar o pós-cadastro/OTP
- Verificar a configuração da instância `whapi-superadmin` usada pelo `portal-otp-watchdog`.
- Corrigir o `instance_not_found` para garantir recuperação/envio após cadastro.
- Validar se o erro `duplicate_phone` está sendo tratado sem bloquear a assinatura quando já existe `idcliente` e link.

### 6. Validação final
- Simular os 3 caminhos completos:
  - `Quero simular` → simulação rápida → `Quero me cadastrar`
  - `Como funciona` → `Quero me cadastrar`
  - `Cadastro rápido`
- Conferir no banco que todos chegam ao pipeline correto:
  - documento → e-mail → telefone → portal → OTP/assinatura.
- Conferir logs do webhook e tabelas `customers`/`bot_step_transitions` após a simulação.

## Resultado esperado

Após executar esse plano, a correção passa a valer no fluxo realmente usado por Rafael/produção, e não apenas em um template isolado. Isso elimina a divergência que fez o cadastro continuar falhando.