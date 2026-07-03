## O problema

Na aba **Meus clientes**, o seletor de produto oferece Telecom, Seguro, Solar, Placas etc. Só que a lista lê apenas a tabela `customers` — e nela todos os 626 clientes do Rafael são `tipo_produto = 'energia'`. Os clientes de **Telecom** ficam em `igreen_telecom_customers` e os de **Seguro** em `igreen_seguros_customers`, tabelas separadas alimentadas pela sync do escritório iGreen.

Resultado: escolher "📱 Telecom" ou "🛡️ Seguro" hoje sempre devolve lista vazia, mesmo com dados no banco.

## O que vou fazer

Fazer o filtro de produto **realmente** trazer clientes daquele produto:

- **Energia / Solar / Placas**: continua vindo de `customers` (comportamento atual).
- **Telecom**: quando selecionado, a lista mostra os registros de `igreen_telecom_customers` do consultor, adaptados ao formato da lista (nome, telefone, cidade, licenciado, status). Se um mesmo cliente já existir em `customers` (match por telefone/nome), reaproveita o card existente; senão, mostra um item "somente Telecom".
- **Seguro**: mesma ideia usando `igreen_seguros_customers` (nome do segurado, cidade/UF, licenciado, mensalidade, placa/modelo como subtítulo).
- **Todos os produtos**: soma tudo (energia + telecom + seguro) sem duplicar.

Os filtros de licenciado, cidade e status continuam funcionando por cima do conjunto resultante.

## Detalhes técnicos

Arquivo principal: `src/components/whatsapp/CustomerManager.tsx`.

1. Buscar as duas tabelas por `consultant_id` com React Query (chaves `carteira-telecom` e `carteira-seguros`), reaproveitando o padrão já usado em `ClientesCarteiraTable.tsx`.
2. Criar um adapter local `telecomToCustomer(row)` e `seguroToCustomer(row)` que devolve um objeto compatível com `Customer` (id sintético prefixado `telecom:` / `seguro:`, `tipo_produto` correspondente, `phone_whatsapp` normalizado, `name`, `address_city`, `registered_by_name = licenciado`, `status = 'approved'`).
3. Substituir `myCustomers` (que hoje é só `customers`) por um `mergedCustomers` calculado assim:
   - base = `filterMyClients(customers, settings)`
   - se `selectedTipo === 'all'`: base + telecom não-duplicados + seguros não-duplicados
   - se `selectedTipo === 'telefonia'`: só telecom (com merge por telefone quando houver cliente energia correspondente para trazer nome/foto)
   - se `selectedTipo === 'seguros'`: só seguros
   - caso contrário: filtra `base` por `tipo_produto`
4. Dedupe por telefone normalizado. Item mesclado ganha um badge extra (📱/🛡️) no `CustomerListItem` — mas isso é ajuste visual mínimo, o card já suporta `tipo_produto`.
5. Contadores (`filterButtons`, header `({myCustomers.length})`) passam a considerar o conjunto mesclado, então o número muda conforme o filtro de produto ativo.

Sem mudanças de schema. Sem mudanças em edge functions. Sem mexer na sync.

## Fora do escopo

- Não altero o cadastro/edição de clientes Telecom/Seguro (continuam vindo da sync do iGreen; a tela de "Novo cliente" segue só para energia).
- Não mexo em Solar/Placas — não há tabela separada; se um dia surgirem clientes com `tipo_produto='solar'` em `customers`, o filtro já funciona.
- Não mexo na aba "Carteira iGreen" (`ClientesCarteiraTable`), que já mostra Telecom/Seguro num formato próprio.
