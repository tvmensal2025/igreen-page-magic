## Diagnóstico encontrado

O problema não é só visual. Hoje o app salva poucos dados porque o sync detalhado está incompleto:

- **Clientes Green:** o worker busca principalmente `/crm/green`, que é o Kanban. Para `tvmensal12`, ele retornou **21 cards**, enquanto o portal mostra resumo acumulado com **141 cadastros** e **42 validados**. Ou seja: o Kanban não representa toda a base histórica/acumulada.
- **Telecom:** o portal mostra no print **6 total cadastradas**, **2 portabilidade pendente**, **1 cancelada**, mas a tabela `igreen_telecom_customers` está com **0 linhas**. O sync atual lê `/crm/telecom`; essa rota retorna **0 cards** para essa conta, apesar do resumo `/telecom/resumo-geral` trazer números.
- **Seguros:** o portal mostra **1 apólice vigente** e **R$ 377,06/mês**, mas `igreen_seguros_customers` está com **0 linhas**. O sync atual lê `/crm/seguros`; essa rota retorna **0 cards**, apesar de `/seguros/resumo-geral` trazer o resumo correto.
- **Rede/licenciados:** `network_members` trouxe **7 membros**, mas o detalhe de Telecom/Seguros não está sendo varrido por endpoints de listagem adequados nem por rotas de licenciados/apólices/clientes.
- **Métricas:** `igreen_consultant_metrics` já tem os resumos corretos: `telecom_resumo_json` com total 6 e `seguros_resumo_json` com total 1. O gargalo está na coleta/persistência dos detalhes.

## Causa raiz

O worker trata estas rotas como fonte principal de detalhe:

- Clientes Green: `/crm/green`
- Telecom: `/crm/telecom` + `/telecom/faturas`
- Seguros: `/crm/seguros`

Mas pelos prints e pelo banco, para este consultor as telas reais usam também rotas de produto/resumo/listagem como:

- `/clientes-green`, `/clientes-green/resumo-geral`, `/clientes-green/boletos`, possivelmente paginações e filtros
- `/produtos/telecom`, `/telecom/resumo-geral`, `/telecom/licenciados`, `/telecom/clientes`, `/telecom/linhas`, `/telecom/portabilidade`
- `/seguros`, `/seguros/resumo-geral`, `/seguros/licenciados`, `/seguros/apolices`, `/seguros/clientes`

O código já tem catálogo/probe dessas rotas, mas o sync de produção ainda não usa esses endpoints como fontes oficiais para preencher as tabelas detalhadas.

## Plano de correção

### 1. Descobrir a fonte real das listas do portal

Adicionar/usar diagnóstico controlado no worker para capturar as requisições XHR reais das três páginas:

- `https://escritorio.igreenenergy.com.br/clientes-green`
- `https://escritorio.igreenenergy.com.br/produtos/telecom`
- `https://escritorio.igreenenergy.com.br/seguros`

O objetivo é identificar exatamente quais endpoints alimentam:

- Total acumulado de Clientes Green
- Lista de cadastros/validados/cancelados/inativos
- Lista de conexões Telecom
- Portabilidade Telecom
- Licenciados com ativação Telecom
- Apólices Seguros
- Cotações/Pendências/Financeiro/Licenciados Seguros

### 2. Refatorar o worker para fontes completas por produto

Substituir o uso exclusivo das rotas de CRM por uma estratégia em camadas:

#### Clientes Green

- Manter `/crm/green` para Kanban atual.
- Adicionar fonte paginada/histórica quando disponível, para bater com o resumo acumulado do portal.
- Continuar enriquecendo detalhe por cliente quando houver `idcliente`.
- Não descartar clientes sem telefone; manter fallback seguro como já existe.

#### Telecom

- Manter `/crm/telecom` como uma fonte, mas não depender só dela.
- Adicionar endpoints de produto/listagem descobertos, por exemplo:
  - `/telecom/clientes`
  - `/telecom/linhas`
  - `/telecom/portabilidade`
  - `/telecom/licenciados`
  - `/telecom/faturas`
- Normalizar tudo para `igreen_telecom_customers`.
- Preencher corretamente:
  - cliente/nome
  - número/linha
  - status e status_label
  - licenciado
  - cidade/UF quando existir
  - fatura_valor/status/mês
  - identificador estável (`idcnxtelecom` ou equivalente)

#### Seguros

- Manter `/crm/seguros` como uma fonte, mas não depender só dela.
- Adicionar endpoints de produto/listagem descobertos, por exemplo:
  - `/seguros/apolices`
  - `/seguros/clientes`
  - `/seguros/licenciados`
  - `/seguros/comissoes`
  - `/seguros/cashback/resumo` se existir para esta conta
- Normalizar tudo para `igreen_seguros_customers`.
- Preencher corretamente:
  - segurado
  - modelo
  - placa
  - FIPE
  - mensalidade
  - status/status_label
  - licenciado
  - cidade/UF
  - identificador estável (`seguro_id` ou equivalente)

### 3. Garantir paginação total e não só primeira tela

Para cada endpoint de listagem:

- Detectar `items`, `data.items`, arrays diretos e estruturas aninhadas.
- Rodar paginação até acabar, respeitando `total`, `perPage`, `page`, `pageSize` ou ausência de itens.
- Limitar por segurança com `maxPages`, mas suficiente para bases maiores.
- Registrar no diagnóstico:
  - endpoint chamado
  - páginas lidas
  - itens recebidos
  - itens válidos salvos
  - erros por endpoint

### 4. Corrigir persistência para não perder linhas válidas

Hoje Telecom exige `idcnxtelecom` numérico e Seguros exige `id/seguro_id`. Se o endpoint novo trouxer outro campo, o app pode receber dados e salvar 0.

Ajustar normalização para aceitar identificadores alternativos:

- Telecom: `idcnxtelecom`, `id`, `codigo`, `numero`, hash estável de nome+numero quando necessário.
- Seguros: `id`, `seguro_id`, `codigo`, `placa`, hash estável de segurado+placa quando necessário.

Sem isso, a busca pode estar correta mas a gravação continuar zerada.

### 5. Fazer o sync sempre comparar detalhe vs resumo

Após o sync, comparar:

- `telecom_resumo_json.total` vs linhas salvas em `igreen_telecom_customers`
- `seguros_resumo_json.total` vs linhas salvas em `igreen_seguros_customers`
- `clientes-green/resumo-geral.totalCadastros` vs linhas salvas/atualizadas em `customers`

Se o resumo indicar dados e a lista detalhada vier 0, gravar alerta claro em `igreen_sync_runs.counts.extras.diagnostics`, por exemplo:

- `telecom_summary_total: 6`
- `telecom_saved: 0`
- `telecom_gap: true`
- `probable_reason: endpoint_detail_not_mapped`

### 6. Ajustar frontend para mostrar estado correto

No app:

- Quando o resumo tiver dados mas a tabela detalhada estiver vazia, mostrar aviso de diagnóstico em vez de parecer que não existe produto.
- Exibir os cards de resumo de Telecom/Seguros a partir de `igreen_consultant_metrics`, mesmo antes de ter lista detalhada.
- Manter listas detalhadas de `igreen_telecom_customers` e `igreen_seguros_customers` quando preenchidas.
- Atualizar invalidação de cache após sync para incluir métricas, listas, rede e produtos.

### 7. Validar com o consultor tvmensal12/Sirlene

Depois da implementação:

- Rodar sync completo para `tvmensal12`.
- Confirmar no banco:
  - Clientes Green aproximando/igualando os totais do portal conforme a fonte disponível.
  - Telecom deixando de ser 0 e chegando aos números do resumo: esperado pelo print, **6 cadastradas**.
  - Seguros deixando de ser 0 e chegando ao resumo: esperado pelo print, **1 apólice vigente** e carteira mensal **R$ 377,06**.
  - Network/licenciados permanecendo com os 7 membros ou mais se o portal retornar mais.
- Confirmar que os dados aparecem no lugar certo no frontend.

## Arquivos principais a alterar

- `worker-igreen-sync/server.mjs`
  - novas funções de listagem/paginação para Clientes Green, Telecom e Seguros
  - normalização robusta por produto
  - diagnóstico de endpoints e gaps

- `supabase/functions/sync-igreen-customers/index.ts`
  - persistência aceitando novos formatos
  - comparação resumo vs detalhe
  - gravação de diagnóstico completo em `igreen_sync_runs`

- `src/components/admin/IGreenSyncStatusBar.tsx`
  - mostrar gaps entre resumo e detalhes

- `src/components/whatsapp/CustomerManager.tsx` e/ou telas de produtos
  - mostrar resumo mesmo quando a lista detalhada ainda está vazia
  - recarregar caches corretos após sync

- Hooks/listas de produtos, se necessário:
  - `src/features/produtos/acompanhamento/multiprodutoHooks.ts`
  - `src/features/produtos/carteira-green/TelecomClientesList.tsx`
  - `src/features/produtos/carteira-green/SegurosClientesList.tsx`

## Observação importante

Não vou usar nem repetir a senha enviada no chat. As credenciais já estão salvas no consultor e serão usadas pela edge function/worker de forma interna.