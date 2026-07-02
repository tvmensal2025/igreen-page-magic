## Plano paralelo

### Trilha A — Descobrir endpoints via Playwright (independe de redeploy)

1. Abro `escritorio.igreenenergy.com.br` num Chrome headless (Playwright), faço login com as credenciais do Rafael (leio `igreen_portal_email`/`igreen_portal_password` da tabela `consultants` via `supabase--read_query`).
2. Navego para `/clientes-green`, aguardo a lista carregar.
3. Ativo captura de rede (`page.on("request")` + `page.on("response")`) e clico no cliente SANDRA (idcliente `1117549`).
4. Filtro requisições que:
   - Vão para `api-vo.igreenenergy.com.br/v1/*`
   - Retornam JSON com strings `SANDRA` **OU** `Salto` (cidade) **OU** `Rafael Ferreira` (licenciado)
5. Registro na tabela `igreen_endpoint_discovery` (via edge function ou insert direto) o(s) endpoint(s) vencedor(es) com `sample_body`.
6. Analiso o JSON e mapeio: `endereco_rua`, `endereco_numero`, `endereco_bairro`, `endereco_cidade`, `endereco_uf`, `endereco_cep`, `licenciado_nome`, `licenciado_codigo`.

**Vantagem:** não depende de VPS, sai em ~2 min.

### Trilha B — Destravar Easypanel

O erro `curl: (23) Failure writing output` + `tar: unexpected EOF` no build do `portal-worker` significa que o tarball do GitHub veio incompleto. Causas comuns em ordem de probabilidade:

1. **Disco cheio na VPS** — checar `df -h` em `/etc/easypanel`. Solução: `docker system prune -af --volumes`.
2. **Token GitHub expirado no Easypanel** — Settings → Git → reconectar app do GitHub.
3. **Rate limit / rede intermitente** — retry manual do deploy.

Vou te entregar comandos de diagnóstico prontos (df, docker prune, teste manual do `git archive`) e, se for token, o passo-a-passo no Easypanel UI.

**Observação:** esse erro é no `portal-worker`, não no `igreen-worker` que precisa do meu patch de sintaxe. Preciso confirmar se você tentou redeployar o worker errado, ou se ambos estão com o mesmo problema de disco/token.

### Depois que Trilha A entregar os endpoints

- **Passo 3 (worker):** adiciono `fetchCustomerAddress` + `fetchCustomerLicensee` no `igreen-worker/server.mjs` chamando os endpoints descobertos, e ligo no `/sync-all` enrich.
- **Passo 4 (edge function):** atualizo `sync-igreen-customers` para mapear os campos novos + corrigir parser de `data_nascimento` (invertendo dd/mm).
- **Passo 5 (validação):** rodo sync da Sandra, comparo 15/15 campos com o modal do escritório.
- **Passo 6 (sync completo):** rodo para toda a carteira do Rafael, reporto estatísticas.

### Fora do escopo

- Não mexo em `worker-portal-2`, cadastro, OTP, contratos.
- Não crio migration nova de schema (colunas `address_*` já existem em `customers`).

### Riscos

- Se o login pedir OTP/reCAPTCHA no Playwright, aviso e paro a Trilha A.
- Se nenhum XHR de detalhe existir (SPA já ter tudo em memória do `/clientes-green` inicial), reporto e proponho alternativa (inspecionar payload da listagem completa).
