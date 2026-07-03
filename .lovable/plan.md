# Sync iGreen 100% completo — clientes + todos os campos

## Diagnóstico honesto (o que hoje NÃO está correto)

Rodei o scan no portal do Rafael. Estes são os fatos:

1. **Lista de clientes:** `/crm/green` é a única fonte e devolve **todos os 159 clientes ativos da carteira** (todas as 9 colunas do Kanban, inclusive Reprovado/Cancelado). Isso está OK — não há cliente "escondido".
2. **Matias Brito da Silva** (código 1578934) está no portal, coluna Validado. **Nunca foi salvo com `portal2_idcliente**` no banco porque o sync atual não faz o de-para. Vai ser salvo assim que a próxima etapa rodar.
3. **Matias Geraldo Muniz** (o que você viu no banco) **não está mais na carteira do Rafael no portal** — saiu em algum momento após 15/06. Está órfão no banco.
4. **Enriquecimento (rua, número, bairro, CEP, complemento, PJ, procurador, concessionária, login/senha da distribuidora):** hoje o worker chama `/clientes-green/boletos/{id}` que **não devolve endereço nenhum**. Por isso `address_street`, `address_number`, `address_neighborhood`, `address_complement`, `cep`, `pj_jsonb`, `procurador_jsonb` estão vazios pra todos os 562 clientes. A ficha completa está em outro endpoint (`/customers/{id}` da API `api-green-connection`) que **nunca é chamado**.
5. Além disso, o enrich atual só roda pra status `validado/adimplente/menos_30d/inadimplente` e com limite de 400. Reprovados, cancelados e aguardando assinatura ficam sem enriquecer.

Ou seja: **hoje o sync NÃO puxa 100% dos dados**. Puxa a lista completa, mas descarta metade dos campos.

## O que o plano vai fazer

### 1. Worker (`worker-igreen-sync/server.mjs`) — novo `fetchCustomerFull`

Trocar/complementar `fetchCustomerDetail` por uma versão que bate no endpoint da ficha real:

```
GET https://api-green-connection.igreenenergy.com.br/v1/customers/{idcliente}
Authorization: Bearer <token da mesma sessão>
```

Retorno cru inclui: `cep, endereco, numero, complemento, bairro, cidade, uf, num_cliente_distribuidora, concessionaria, fornecedora, possui_placas, contaunica, transferir_titularidade, logindistribuidora, senhadistribuidora, indcli, PJ (cnpj/razao/fantasia/ie/cargo), procurador`. Se o endpoint der 404/403 (mudou de host), cair em fallback pra `/clientes-green/boletos/{id}` já existente.

No `/sync-all`, quando `body.enrich === true`:

- **Remover o filtro por status** — enriquecer TODOS os clientes vindos do Kanban.
- **Remover o limite 400** (default). Deixar opcional (`enrich_limit`) só como safety.
- Manter throttle 5 req/s.

### 2. Edge function `sync-igreen-customers` — `applyCustomerDetails` completo

Estender o mapeamento (arquivo `supabase/functions/sync-igreen-customers/index.ts`, função `applyCustomerDetails`) pra gravar:

- `cep, address_street, address_number, address_complement, address_neighborhood`
- `num_cliente_distribuidora, concessionaria, fornecedora`
- `possui_placas, contaunica, transferir_titularidade`
- `logindistribuidora, senhadistribuidora` (colunas já existem — TEXT)
- `pj_jsonb` (dump dos campos de PJ) e `possui_pj` derivado
- `procurador_jsonb` e `possui_procurador` derivado
- Continuar setando `last_enriched_at`

### 3. Marcar quem saiu da carteira

Ao fim de um `sync_all` bem-sucedido (com `customers.length > 0`), marcar como `situacao_igreen = 'fora_da_carteira'` (e opcionalmente `left_carteira_at = now()`) todo `customer` que:

- `consultant_id = X`
- `customer_origin = 'igreen_sync'`
- `igreen_code` **NÃO** está no batch atual

Assim os 400+ órfãos do Rafael param de aparecer como ativos e o Matias Geraldo Muniz fica visivelmente sinalizado como "saiu do portal".

### 4. Verificação pós-deploy

- Rodar `sync_all` do Rafael.
- Query no banco: `SELECT count(*) FILTER (WHERE address_street IS NOT NULL) AS com_rua, count(*) AS total FROM customers WHERE consultant_id='0c2711ad…' AND customer_origin='igreen_sync' AND situacao_igreen != 'fora_da_carteira'`.
- Alvo: **com_rua = total = 159**.
- Conferir Matias Brito: deve ter `portal2_idcliente=1578934`, rua/cep preenchidos.
- Conferir Matias Geraldo: deve estar com `situacao_igreen='fora_da_carteira'`.

## Detalhes técnicos

- **Sem migration nova nesta fase** — todas as colunas de endereço/PJ/procurador já existem em `customers` (confirmado em `docs/portal-api/PORTAL2_ENRIQUECIMENTO_MAP.md`). Só falta um `left_carteira_at TIMESTAMPTZ` se você quiser rastrear a data — opcional, posso pular.
- **Custo:** 159 clientes × ~2,5s = ~7 min de worker no `sync_all` completo. Aceitável (hoje já leva 4–6 min sem endereço).
- **Sensibilidade:** `logindistribuidora`/`senhadistribuidora` vão pro banco em TEXT. Se preferir não sincronizar `senhadistribuidora`, aviso e pulo o campo.
- Arquivos tocados: `worker-igreen-sync/server.mjs` (fetchCustomerFull + loop sem filtro), `supabase/functions/sync-igreen-customers/index.ts` (`applyCustomerDetails` + marca fora_da_carteira).
- Requer redeploy do worker no Easypanel após a mudança.

## Pergunta antes de executar

1. `**senhadistribuidora**`: sincronizo ou pulo? (o `logindistribuidora` eu sincronizo em qualquer caso). nao precisa de senha da distribuidora, meus clientes nao tem
2. `**left_carteira_at**`: quer que eu adicione a coluna pra rastrear quando o cliente saiu, ou basta mudar o `situacao_igreen`? basta mudar, assim nao precisa criar a coluna