## Diagnóstico

1. **Clientes baixa, mas não grava:** os logs da função `igreen-ingest-xlsx` mostram erro real no upsert de clientes:
   - `there is no unique or exclusion constraint matching the ON CONFLICT specification`
   - A função tenta gravar com conflito em `phone_whatsapp,consultant_id`, mas no banco o índice único atual é parcial (`idx_customers_phone_consultant_production`). Por isso todos os 919 clientes viram erro.

2. **Rede baixa e grava, mas não aparece na tela Rede:** a extensão grava em `consultant_network`, porém o painel atual (`NetworkPanel`) lê de `network_members`. Resultado: a extensão informa `Rede: 59 atualizados`, mas a tela continua sem refletir automaticamente.

3. **Captcha/login do portal:** a extensão não deve digitar senha nem resolver captcha pelo cliente. Ela usa a sessão já logada do navegador. Se o portal pedir captcha/login, o usuário precisa resolver uma vez no próprio portal; depois a extensão só clica em exportar e envia os XLSX.

4. **Demora/download:** hoje ela espera o carregamento da página e tenta capturar o XLSX sem necessariamente deixar arquivo salvo em Downloads. Isso pode parecer que “não baixou”, mas a captura pode acontecer internamente. Vou deixar o status mais explícito para mostrar etapa por etapa.

## Plano de implementação

### 1. Corrigir gravação de Clientes
- Ajustar `igreen-ingest-xlsx` para usar uma estratégia compatível com o índice parcial existente.
- Em vez de `upsert(... onConflict: "phone_whatsapp,consultant_id")`, gravar clientes com `is_test_lead=false` e `is_sandbox=false` e usar um método que respeite o índice real do banco.
- Melhorar o retorno da função para mostrar erro claro quando o banco rejeitar um lote, sem mascarar tudo como erro genérico por linha.

### 2. Fazer a Rede aparecer automaticamente no sistema
- Alterar a ingestão da planilha de rede para também preencher/atualizar `network_members`, que é a tabela que a tela Rede já usa.
- Mapear campos do XLSX para o formato esperado pelo painel:
  - `codigo_igreen` -> `igreen_id`
  - `nome` -> `name`
  - `celular` -> `phone`
  - `patrocinador_codigo` -> `sponsor_id`
  - `nivel`, `cidade`, `uf`, `graduacao`, pontos/GP/GI quando existirem
- Manter `consultant_network` como tabela de auditoria/raw se útil, mas garantir que `network_members` seja atualizado para refletir no painel.

### 3. Melhorar confiabilidade e diagnóstico da extensão
- Atualizar `background.js` para salvar no status qual etapa está rodando: abrindo Clientes, esperando tabela, clicando Exportar, capturando XLSX, enviando para nuvem, depois Rede.
- Aumentar mensagens quando o portal estiver em login/captcha, por exemplo: “Portal pediu login/captcha; resolva manualmente na aba aberta e tente novamente”.
- Manter downloads sequenciais, um por vez, para evitar aviso de múltiplos downloads.

### 4. Ajustar UI/Passo a passo
- Atualizar `IGreenExtensionCard.tsx` explicando claramente:
  - O usuário não digita login/senha/captcha na extensão.
  - Ele entra no portal normalmente, resolve captcha se aparecer, e deixa a sessão ativa.
  - O botão “Sincronizar agora” deve mostrar progresso e pode levar alguns minutos.
  - A aba Rede será atualizada automaticamente após o XLSX de rede ser processado.

### 5. Reempacotar e versionar
- Subir versão da extensão para `1.2.1`.
- Regerar `public/igreen-sync-extension.zip`.
- Se houver alteração estrutural necessária no banco, criar migração pequena e segura antes do código.

## Validação

- Consultar logs da edge function depois do ajuste para confirmar que o erro `42P10` sumiu.
- Verificar no banco se os 919 clientes entram/atualizam com `errors: 0`.
- Verificar se os 59 membros entram em `network_members` e aparecem na tela Rede.
- Confirmar que a extensão exibe mensagens de progresso e orientação quando houver login/captcha.