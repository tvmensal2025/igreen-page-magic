## Diagnóstico

- O consultor `tvmensal12` está com credenciais válidas e sincronizou com sucesso em `05/07 23:28`.
- A sincronização trouxe:
  - Energia/clientes: 21 processados, 22 na base
  - Rede/licenciados: 7 membros gravados
  - Boletos: 1 gravado
  - Métricas: gravadas
  - Telecom: `0`
  - Seguros: `0`
- Para esse consultor, o portal autenticado usado pelo worker está identificando `igreen_consultor_id = 124661`, enquanto o cadastro do consultor no app tem `igreen_id = 1241`.
- O sistema hoje grava Telecom e Seguros somente na carteira direta retornada por `/crm/telecom` e `/crm/seguros` da conta autenticada. Ele não varre automaticamente Telecom/Seguros de cada licenciado da rede.
- Existe dado de Telecom/Seguros para outro consultor (`Rafael Ferreira`), mas não para `tvmensal12`. Isso confirma que as tabelas e persistência funcionam; o problema é escopo/varredura da rede e identificação correta do consultor no portal.

## Plano de correção

1. **Unificar identidade iGreen do consultor**
   - Tratar `igreen_consultor_id` retornado pelo portal como ID canônico da conta logada quando ele existir.
   - Preservar `igreen_id` antigo como dado legado, mas evitar que filtros e status dependam só dele.
   - Mostrar na UI quando a conta logada no portal é outro ID iGreen, para evitar confusão como `1241` vs `124661`.

2. **Garantir que `sync_all` sempre busque todos os blocos**
   - Manter Energia como Fase A para aparecer rápido.
   - Rodar Fase B com Rede, Métricas, Boletos, Telecom, Seguros, Devolutivas e Cashback sempre que os toggles estiverem ativos.
   - Se Telecom/Seguros voltarem `0`, gravar explicitamente `received: 0` nos counts, não apenas `saved: 0`, para diferenciar “portal retornou vazio” de “falhou ao gravar”.

3. **Adicionar diagnóstico real do worker para Telecom/Seguros**
   - Registrar no resultado do sync quais endpoints foram chamados (`/crm/telecom`, `/telecom/faturas`, `/crm/seguros`) e quantos cards/faturas vieram.
   - Se o endpoint falhar, salvar erro por produto em `igreen_sync_runs.counts.extras.telecom_error` ou `seguros_error`, sem esconder como lista vazia.

4. **Buscar produtos da rede no lugar certo**
   - Implementar uma etapa “carteira multiproduto da rede” baseada nos 7 `network_members` do consultor.
   - Para cada item de Telecom/Seguros retornado pelo portal, preencher `licenciado`, `consultant_owner_igreen_id`/equivalente e vincular ao membro da rede quando possível.
   - Se o portal só expuser Telecom/Seguros da conta logada e não dos licenciados, a UI deve deixar isso claro: “0 no portal para esta conta; há 7 licenciados na rede”.

5. **Corrigir exibição na aba Admin › Clientes**
   - A lista principal deve carregar:
     - Energia de `customers`
     - Telecom de `igreen_telecom_customers`
     - Seguros de `igreen_seguros_customers`
     - Licenciados de `network_members`
   - Os filtros “Produto” e “Licenciado” devem mostrar opções mesmo quando o produto tem 0 itens, com contador `0`, para não parecer que a sincronização não rodou.

6. **Melhorar o estado pós-clique em Sincronizar**
   - Ao clicar em sincronizar, mostrar imediatamente “sincronização iniciada”.
   - Atualizar a tela em duas ondas:
     - Primeiro clientes de energia
     - Depois extras: rede, telecom, seguros, boletos, métricas
   - Enquanto extras rodam, exibir “buscando Telecom/Seguros...” em vez de tela vazia.

7. **Validação final**
   - Rodar uma sincronização direcionada para `tvmensal12`.
   - Confirmar no banco:
     - `igreen_sync_runs.counts.extras.telecom.telecom_received`
     - `igreen_sync_runs.counts.extras.seguros.seguros_received`
     - total em `igreen_telecom_customers`
     - total em `igreen_seguros_customers`
     - 7 licenciados em `network_members`
   - Conferir visualmente em `/admin` que Energia, Licenciados, Telecom e Seguros aparecem no lugar correto, inclusive quando algum produto realmente vier `0` do portal.

## Observação importante

A senha enviada no chat não deve ser repetida nem gravada em código. O app já possui credenciais salvas para esse consultor; a correção deve usar o armazenamento seguro existente.