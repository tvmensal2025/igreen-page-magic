# Executar probe → identificar endpoint → implementar enrich → validar puxada completa

## Estado atual
- Worker configurado: `https://igreen-worker-igreen.d9v63q.easypanel.host`
- 1 consultor com credenciais iGreen cadastrado
- Edge function `probe-igreen-detail` já deployada
- Tabela `igreen_endpoint_discovery` vazia (nenhum probe rodado ainda)

## Passos que vou executar agora

**1. Rodar probe automaticamente**
Invoco `probe-igreen-detail` via `curl_edge_functions` com `sample_idcliente=1117549` (SANDRA) e o consultor com credenciais.
Timeout esperado: 30-90s (worker faz login + testa 12 rotas).

**2. Ler resultado da tabela `igreen_endpoint_discovery`**
Identifico o vencedor (bucket=`ok`, status=200). Analiso o `sample_body` para mapear campos da API → colunas do banco (endereço, PJ, procurador, distribuidora, etc.).

**3. Implementar `fetchCustomerDetail` no worker + rota `/enrich-customer-batch`**
- Adiciona função que chama o endpoint vencedor para um `idcliente`
- Nova rota `POST /enrich-customer-batch { portal_email, portal_password, ids: string[] }` com concorrência 3
- Retorna `{ results: [{ id, mapped, error? }] }`

**4. Reintroduzir modo enrich em `sync-igreen-customers` (edge function)**
- Parâmetro `mode: "enrich"` + `enrichCustomerIds?: string[]` + `enrichLimit?: number`
- Seleção por `igreen_code` (não portal2_idcliente)
- Persiste nas colunas já existentes da Fase 1 + `last_enriched_at`

**5. Validar puxando 1 cliente real (SANDRA 1117549)**
- Executo `sync-igreen-customers { mode: "enrich", enrichCustomerIds: ["1117549"] }`
- Leio a linha do banco e comparo os campos preenchidos vs o modal do escritório (endereço, CPF, telefone, email, distribuidora, fornecedora, ativo desde, consumo médio, etc.)

**6. Reportar validação**
Mostro tabela: campo | valor no banco | valor esperado (screenshot) | status ✓/✗

## Se o probe não encontrar vencedor
Alguns endpoints candidatos podem retornar 404. Nesse caso, analiso os corpos de erro (podem revelar o formato correto do path), amplio para 6-10 candidatos adicionais e re-rodo — sem pedir sua ajuda.

## Se o worker falhar no login (Cloudflare/WAF)
Reporto o erro exato e paramos — nada a implementar até o worker voltar.

## Escopo intocado
`worker-portal-2`, cadastro, OTP, contratos.

Aprovar → rodo tudo em sequência e volto com o resultado da validação.
