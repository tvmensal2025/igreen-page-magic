## Objetivo

Descobrir o(s) XHR real(is) que o SPA `escritorio.igreenenergy.com.br/clientes-green` dispara ao abrir o detalhe de um cliente, e usar esse endpoint para **enriquecer 100% dos clientes** da carteira do consultor com os campos que ainda faltam (endereço completo, licenciado, data de nascimento correta, etc.).

## Estratégia em 2 fases

### Fase 1 — Spy (descoberta, 1 cliente)

Novo endpoint no worker: `POST /spy-spa-detail`

1. Abre `https://escritorio.igreenenergy.com.br/login` no Chromium+Tor já existente.
2. Faz login pelo **formulário do SPA** (email + senha, sem reCAPTCHA hoje).
3. Aguarda redirect para a área logada; injeta `page.on('request')` + `page.on('response')` filtrando `api-vo.igreenenergy.com.br/v1/*`.
4. Navega para `/clientes-green`, aguarda a listagem carregar.
5. Localiza o card/linha da Sandra (ou primeiro cliente) e clica.
6. Aguarda 5 s coletando todas as URLs + status + primeiros 3 KB de cada JSON.
7. Devolve JSON: `{ requests: [{url, method, status, sample_body}], winners: [urls que contêm "SANDRA" ou o CPF/idcliente] }`.
8. Persiste em `igreen_endpoint_discovery` (bucket `spy_spa`).

**Entrega da Fase 1:** o path real (ex.: `/v1/crm/green/detalhe/{id}` ou o que for), com prova (sample_body contendo endereço e licenciado).

### Fase 2 — Enrich em massa (todos os clientes)

Com o endpoint confirmado:

1. Adiciono `fetchCustomerDetailReal(session, idcliente)` no worker usando o path descoberto.
2. Modifico `/sync-all` para chamar esse fetch **para todo cliente**, não só os 400 do enrich atual:
   - Remove o cap `enrich_limit: 400`
   - Adiciono `enrich_all: true` no body
   - Paraleliza em batches de 8 requisições simultâneas (respeita rate limit)
   - Progress via `worker_phase_logs`
3. Atualizo `sync-igreen-customers/index.ts` para mapear os campos novos:
   - `endereco_rua`, `endereco_numero`, `endereco_bairro`, `endereco_cidade`, `endereco_uf`, `endereco_cep`
   - `licenciado_nome`, `licenciado_codigo`
   - `data_nascimento` (corrige a inversão dd/mm)
   - Qualquer outro campo rico que o detalhe trouxer
4. Rodo `sync-all` completo para Rafael; reporto estatísticas (N clientes, X com endereço preenchido, Y com licenciado).

## Fluxo operacional (o que você precisa fazer)

```text
Eu edito worker  ─► você commita + deploy Easypanel (deploy 1)
                    │
Eu chamo /spy-spa-detail via edge function
                    │
              recebemos o path real
                    │
Eu edito worker + edge function ─► você commita + deploy (deploy 2)
                    │
Eu rodo sync-all completo (todos os clientes)
                    │
              relatório final 15/15 campos
```

**Total: 2 deploys manuais no Easypanel** (você já sabe o processo, ~2 min cada).

## Arquivos que serão alterados

- `worker-igreen-sync/server.mjs` — novo endpoint `/spy-spa-detail`, novo `fetchCustomerDetailReal`, `/sync-all` com `enrich_all`
- `supabase/functions/spy-igreen-spa/index.ts` — nova edge que chama `/spy-spa-detail` e persiste na tabela discovery
- `supabase/functions/sync-igreen-customers/index.ts` — mapeamento dos campos novos + correção do parser de `data_nascimento`

## Fora do escopo

- Não mexo em `worker-portal-2`, cadastro, OTP, contratos
- Não crio migration (colunas `endereco_*`, `licenciado_*`, `data_nascimento` já existem em `customers`)
- Não toco em `portal-worker` (problema separado, deploy Easypanel)

## Riscos

- **Login SPA pode ter mudado** — se o formulário exigir OTP/reCAPTCHA para acesso via IP Tor, a Fase 1 aborta. Nesse caso, caio no plano B: injeto o JWT (que o worker já sabe minerar via `/auth/session`) direto no `localStorage`/`sessionStorage` do SPA antes de navegar.
- **Rate limit da api-vo no enrich em massa** — se 8 req/paralelo derrubar, reduzo para 4 e adiciono backoff.
- **SPA pode carregar detalhe sob demanda via WebSocket em vez de XHR** — improvável, mas se ocorrer, o spy também monitora `page.on('websocket')`.

## Aceite

- 100% dos clientes de Rafael com `endereco_cidade`, `endereco_uf` preenchidos (quando existir na origem)
- ≥ 95% com `licenciado_nome`
- `data_nascimento` da Sandra = `1971-06-01` (não invertida)
- `last_enriched_at` != null para todos
