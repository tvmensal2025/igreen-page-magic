# Estratégia: adaptar o Worker Green (EasyPanel) para a nova API iGreen

Data: 01/07/2026
Objetivo: fazer a coleta de clientes e rede do portal iGreen voltar a funcionar,
reaproveitando o **worker green** (`worker-igreen-sync`) que já roda no EasyPanel.

---

## 1. Diagnóstico — por que parou

O worker green **já resolve a parte difícil** (e continua válida):
- **Tor SOCKS5** → dá IP residencial e passa o **Cloudflare** (que bloqueia IP de
  datacenter/EasyPanel com 403).
- **2captcha** → resolve o **reCAPTCHA v2** da tela de login.
- **Playwright Chromium** → navega como browser real e captura o token.
- **OpenAI Vision** → debug visual passo a passo (`/last-debug`, `/last-screenshot`).

O que **quebrou** foi só o "endereço" dos dados. O worker aponta para o portal
antigo; a plataforma migrou de arquitetura (confirmado na análise
`ANALISE_PORTAL_IGREEN_API.md`):

| O que o worker usa hoje (v15) | O que existe agora (novo portal) |
|---|---|
| `API_BASE = api-voffice.igreenenergy.com.br/v1` | `api-vo.igreenenergy.com.br/v1` |
| `POST /v1/login` (body `{email,password,recaptchaToken,keepConnected}`) | `POST /v1/auth/session` (body `{email,password,keepConnected}`) + `/v1/auth/recaptcha` |
| `GET /customer-map/{consultorId}` paginado | **não existe** → usar `GET /crm/green` (Kanban com todos os clientes) |
| `GET /network-map` paginado (`per_page`) | `GET /network-map/data?month=YYYY-MM` (lista completa, sem paginação) |
| token em `data.accessToken` | token em `data.token` |

Ou seja: **90% do worker está pronto**. É uma cirurgia pequena, não uma reescrita.

> **CONFIRMADO por teste no navegador real (01/07/2026):** o novo `/login`
> **NÃO tem reCAPTCHA** (sem `grecaptcha`, sem iframe, sem `data-sitekey`).
> O body do `POST /v1/auth/session` é **só** `{ email, password, keepConnected }`.
> ⇒ **O worker não precisa mais do 2captcha para logar** (menos custo, menos
> ponto de falha). Manter o código do 2captcha desativado/como fallback, caso o
> reCAPTCHA volte no futuro.

---

## 2. Arquitetura-alvo (mantém o fluxo atual)

```
 Supabase Edge Function                Worker Green (EasyPanel)              Portal iGreen
 sync-igreen-customers   ──POST──►   worker-igreen-sync (Node)      ──Tor──►  Cloudflare ✅
   (agenda / manual)      /sync-*      1. Playwright + Tor
       │                              2. 2captcha (reCAPTCHA)
       │                              3. POST /v1/auth/session → token
       │                              4. GET /crm/green  +  /network-map/data
       ▼                              5. devolve JSON normalizado
  upsert customers / network_members
```

Nada muda no "contorno do Cloudflare" nem no agendamento. Muda só **para onde o
worker pede os dados** e **como ele lê a resposta**.

---

## 3. Mudanças no worker (`worker-igreen-sync/server.mjs`)

### 3.1 Constantes
```js
const PORTAL_URL = 'https://escritorio.igreenenergy.com.br/login';
const API_BASE   = 'https://api-vo.igreenenergy.com.br/v1';   // era api-voffice
```

### 3.2 Login → `/v1/auth/session` (sem reCAPTCHA)
- Interceptar `response` de `**/v1/auth/session**` (era `/v1/login`).
- Fallback `context.request.post(`${API_BASE}/auth/session`, ...)` com body
  **exato** `{ email, password, keepConnected: true }` (confirmado: **sem**
  `recaptchaToken`).
- **Pular a etapa do 2captcha** no novo fluxo (não há reCAPTCHA). Deixar o
  `solveRecaptcha()` como fallback condicional: só chamar se detectar o widget
  na página (`document.querySelector('[data-sitekey], .g-recaptcha')`).
- Ler o token de `data.token` (mantendo os fallbacks antigos por segurança):
  ```js
  const token = data?.data?.token || data?.token || data?.accessToken || null;
  ```
- `consultorId` continua vindo de `GET /v1/consultant` (campo `data.idconsultor`).

### 3.3 `/sync-customers` → usar `/crm/green`
`/crm/green` devolve um **Kanban**: `data[]` = colunas, cada uma com `cards[]`.
Achatar todos os cards numa lista de clientes. Cada card já traz:
`codigo, nome, cidade, uf, kwh, distribuidora, celular, data, devolutiva,
atraso, diasAtraso` + o `status` derivado do `id` da coluna.

```js
async function fetchCustomers(session) {
  const r = await session.context.request.get(`${API_BASE}/crm/green`, {
    headers: { Authorization: `Bearer ${session.token}` }, timeout: 60000,
  });
  if (!r.ok()) throw new HttpError(r.status(), `HTTP ${r.status()} em /crm/green`);
  const j = await r.json();
  const cols = Array.isArray(j?.data) ? j.data : [];
  const out = [];
  for (const col of cols) {
    for (const card of (col.cards || [])) {
      out.push({ ...card, status_coluna: col.id, status_label: col.label });
    }
  }
  return out;   // lista achatada de clientes
}
```
Resposta do endpoint: `{ ok:true, consultor_id, customers }` (mesmo formato de
antes → a edge function não precisa mudar de contrato).

> Enriquecimento opcional (fase 2): para clientes validados/ativos, chamar
> `GET /clientes-green/boletos/{codigo}` e completar `cpf`, `instalacao`,
> `concessionaria`, `dataAtivo`. Fazer com throttle (ex.: 5 req/s) e só quando
> necessário, para não sobrecarregar.

### 3.4 `/sync-network` → usar `/network-map/data?month=YYYY-MM`
```js
async function fetchNetwork(session) {
  const month = new Date().toISOString().slice(0, 7);           // YYYY-MM
  const r = await session.context.request.get(
    `${API_BASE}/network-map/data?month=${month}`,
    { headers: { Authorization: `Bearer ${session.token}` }, timeout: 60000 });
  if (!r.ok()) throw new HttpError(r.status(), `HTTP ${r.status()}`);
  const j = await r.json();
  return Array.isArray(j?.data) ? j.data : [];
}
```
A lista já vem completa (sem paginação). **Remover** o `fetchPaginated` para a
rede (o novo endpoint não usa `page`/`per_page`).

### 3.5 Mapear os nomes de campo (novo → esperado pela edge)
A edge `sync-igreen-customers` hoje lê da rede: `idconsultor, nome, celular,
idpatrocinador, nivel, data_ativo, cidade, uf, cliativo, gp, gi, qtde_diretos...`.
O `/network-map/data` usa nomes um pouco diferentes:

| Edge espera | `/network-map/data` entrega | Ação |
|---|---|---|
| `idconsultor` | `idconsultor` | ok |
| `nome`, `celular`, `cidade`, `uf` | idem | ok |
| `idpatrocinador` | `patrocinador` | **renomear no worker** |
| `nivel` | `nivel` | ok |
| `data_ativo` | `dataAtivo` (ISO) | **renomear + cortar p/ YYYY-MM-DD** |
| `cliativo` | `clientesAtivos` | **renomear** |
| `gp`, `gi` | `gp`, `gi` | ok |
| `qtde_diretos` | (não vem no `/data`; vem `licenciadosDiretos`) | mapear/derivar |

**Decisão de projeto:** fazer esse "de-para" **no worker** (devolver já com os
nomes que a edge espera) para **não precisar alterar a edge function**. Assim o
deploy é só do container do worker.

Campos extras ricos que o novo endpoint traz (bonificavel, qualificavel,
graduacao, graduacaoExpansao, licenciadosDiretos, licenciadosDiretosAtivos,
pro, devolutivas, agValid) podem ser incluídos numa fase 2 (a tabela
`network_members` já tem colunas para a maioria).

---

## 4. Passo a passo de implementação

1. **Branch + edição do worker** (`worker-igreen-sync/server.mjs`):
   - Trocar `API_BASE`.
   - Login: interceptar/POSTar `/v1/auth/session`; ler `data.token`.
   - `fetchCustomers` via `/crm/green` (achatar Kanban).
   - `fetchNetwork` via `/network-map/data?month=` + de-para de campos.
   - Manter `/health`, `/last-debug`, `/last-screenshot`, Tor, 2captcha e Vision.
   - Bump de versão (v16) no README e logs.
2. **Testar o login primeiro sem reCAPTCHA** (o novo `/auth/session` pode não
   exigir). Se exigir, confirmar a `sitekey` na página e ajustar.
3. **Build & deploy no EasyPanel** (rebuild da imagem do serviço worker green).
   Variáveis já existentes continuam: `WORKER_TOKEN`, `TWOCAPTCHA_API_KEY`,
   `OPENAI_API_KEY`, `TOR_SOCKS_PROXY`.
4. **Validar via `/health` e um `/sync-network` manual** (rede é o mais simples,
   1 chamada). Depois `/sync-customers`.
5. **Rodar a edge `sync-igreen-customers`** (modo network e depois customers) e
   conferir `network_members` / `customers` no Supabase.
6. **Observabilidade:** em caso de bloqueio, o worker já classifica
   `igreen_waf_blocked` (HTTP 503). Manter esse comportamento para o novo
   `/auth/session`.

---

## 5. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Novo login exige reCAPTCHA com sitekey diferente | **Descartado** — confirmado que não há reCAPTCHA hoje. Manter detecção dinâmica de `[data-sitekey]` para reativar 2captcha se voltar |
| Cloudflare bloquear mesmo via Tor (circuito ruim) | Retry com **novo circuito Tor** (`NEWNYM`) + classificação `igreen_waf_blocked` já existente |
| Token expira em 1h | Cache de sessão de 30min já existe (`SESSION_TTL_MS`); ok |
| `/crm/green` não trazer clientes reprovados antigos | Complementar com `/clientes-green/drilldown?bucket=<status>&mes=` por mês, se precisar de histórico |
| Falta CPF/instalação na lista | Fase 2: enriquecer via `/clientes-green/boletos/{id}` só para validados |
| Volume | Pequeno (~571 clientes, ~31-60 rede); 1-2 chamadas resolvem, sem paginação pesada |

---

## 6. Definição de pronto (DoD)

- `/health` do worker green responde OK após o deploy.
- `POST /sync-network` devolve a rede com os campos que a edge espera.
- `POST /sync-customers` devolve os clientes (achatados do `/crm/green`).
- Edge `sync-igreen-customers` popula `network_members` e `customers` sem erro.
- Em bloqueio, retorna `igreen_waf_blocked` (não fica em loop consumindo 2captcha).

---

## 7. Escopo desta fase x fase 2

**Fase 1 (esta):** clientes (via `/crm/green`) + rede (via `/network-map/data`),
mantendo o contrato atual com a edge. Deploy só do worker.

**Fase 2 (opcional):** enriquecimento de CPF/instalação (`/clientes-green/boletos/{id}`),
campos extras de rede (bonificavel/qualificavel/graduação), e novas carteiras
que o portal novo passou a expor (Telecom `/telecom/*`, Seguros `/seguros/*`,
painéis `/painel/*` e `/rotinas/*`).
