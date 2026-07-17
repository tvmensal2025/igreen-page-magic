# iGreen Club (Conexão Club) — Mapa OFICIAL da API e do fluxo

> **Fonte da verdade** do cadastro no Club. Tudo aqui foi confirmado por
> engenharia reversa do bundle oficial + Playwright/browser ao vivo contra a
> API real (interceptação dry-run do POST — **nenhum cliente real foi criado**).
> **Antes de construir o WorkerClub, leia este arquivo.**
>
> Última validação completa: **2026-07-15**
> Landing: `https://club.igreenenergy.com.br/?id=<idconsultor>`
> Bundle analisado: `https://club.igreenenergy.com.br/assets/index-9c5c29fa.js`
> (o hash muda a cada deploy deles — ver §8)
>
> Screenshots: `01-landing.png`, `02-step1.png`, `03-after-step1.png`
> Payload PF capturado: `payload-pf.example.json`

---

## 0. Contexto de negócio (importante para o “benefício gratuito”)

| Produto | URL / origem | O que é |
|---|---|---|
| **Conexão Club (esta página)** | `club.igreenenergy.com.br/?id=` | Cadastro do clube de descontos. Marketing interno: PF ~R$ 19,90/mês. |
| **iGreen Club grátis (energia/telecom)** | benefício embutido em Conexão Green / Telecom / Licenciado | Clientes desses produtos já têm Club **sem** passar por esta página paga. |

Nesta SPA **não existe** flag `gratis` / `cortesia` / `valor=0` no bundle.
O fluxo PF é só: dados pessoais → endereço → `POST /cliente/club`.
Não há passo de pagamento na UI PF (boleto aparece só no sucesso **PJ**).

> Para dar Club “de graça” ao cliente inseguro, o WorkerClub precisa de uma
> decisão de produto ainda aberta: (A) cadastrar via esta API e absorver o
> custo operacional; (B) achar endpoint/admin de cortesia fora desta SPA;
> (C) liberar via Clube Certo / backoffice. **Não inventar flag.**

App pós-cadastro PF: **iGreen Club** nas lojas
([Play Store](https://play.google.com/store/apps/details?id=com.embarcadero.iGreenConnect) /
[App Store](https://apps.apple.com/br/app/igreen-club/id6444493340)).
Mensagens prontas: [`APP-LINKS-CLIENTE.md`](./APP-LINKS-CLIENTE.md).

---

## 1. Infra e autenticação

| Item | Valor |
|---|---|
| Landing | `https://club.igreenenergy.com.br/?id=<idconsultor>&cli=<indcli?>` |
| API base | `https://api.igreenenergy.com.br` |
| Auth | JWT Bearer (`Authorization: Bearer <token>`) |
| Como obter token | `POST /auth/consultor` body `{ "idconsultor": <number> }` — **sem** Bearer |
| Onde a SPA guarda | `localStorage["igreen-token"]` = `JSON.stringify(access)` (string JWT entre aspas JSON) |
| Também guarda | `username` (nome do consultor), `sponsorId` (idconsultor) |
| TTL do JWT | **2 horas** (`exp - iat = 7200`) |
| Audience / issuer | `aud: "igreen-connection"`, `iss: "igreen-platform"` |
| Payload JWT | `{ id, email, iat, exp, aud, iss }` |
| Cloudflare | curl/datacenter → **403**. Worker **precisa** de browser real (Playwright) + proxy residencial (mesmo padrão do `worker-portal-2`) |
| Auxiliares | ViaCEP `https://viacep.com.br/ws/{cep}/json/` · IBGE `https://servicodados.ibge.gov.br/api/v1/localidades/estados` |

### Interceptor Axios (oficial)

```js
baseURL = "https://api.igreenenergy.com.br"
// request:
token = JSON.parse(localStorage["igreen-token"] || '""')  // ou header authAux
headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
// se NÃO tem token E NÃO tem authAux → request segue sem Authorization
// (é o caso do POST /auth/consultor)
```

Resposta de erro: toast com `error.response.data.error.message` ou fallback
`"Houve um erro em sua solicitação."`

---

## 2. Endpoints (confirmados ao vivo)

### Auth / consultor
| Método | Endpoint | Auth | Body / query | Retorno (ao vivo) |
|---|---|---|---|---|
| `POST` | `/auth/consultor` | não | `{ idconsultor: number }` | ver abaixo |

```jsonc
{
  "auth": { "access": "<JWT>" },
  "name": "Rafael Ferreira Dias",
  "tipo_suporte": "ticket",
  "tipo_licenca": "EXPERT+TELECOM",
  "inadimplente": false,
  "inadimplenteReason": null
}
```

A SPA **não deixa seguir** se `!token` (tela de start exige login do consultor).
Se `inadimplente===true` → tratar como bloqueio (campo existe; comportamento
exato da UI a revalidar se aparecer caso real).

### Cadastro PF (e submit unificado do wizard)
| Método | Endpoint | Auth | Body | Notas |
|---|---|---|---|---|
| `POST` | `/cliente/club` | Bearer | ver §6 | Único endpoint de submit do wizard PF (e também do wizard PJ multi-step — o form inteiro vai no mesmo POST) |

### Planos PJ
| Método | Endpoint | Auth | Retorno |
|---|---|---|---|
| `GET` | `/cliente/clube/planos` | Bearer | array de planos PJ |

Resposta ao vivo (2026-07-15):

```jsonc
[
  { "idplanopj": 1, "qtdemin": 0, "qtdemax": 50, "valormin": "150", "valor_vida": "9.9" },
  { "idplanopj": 2, "qtdemin": 51, "qtdemax": 100, "valormin": "408", "valor_vida": "8" },
  // ... até idplanopj 10 (faixas por vidas)
]
```

### Pós-contratação PJ (painel Clube Certo)
| Método | Endpoint | Auth | Notas |
|---|---|---|---|
| `POST` | `/cliente/clube/company-creation` | header `authAux: <token da query>` | Rota SPA `/companyRegister/?token=...` → cria senha e redireciona para Clube Certo |

Redirect sucesso PJ painel:
`https://clubecerto.com.br/sistemaigreen/#/userVerify`

### Externos
| Uso | URL |
|---|---|
| CEP | `GET https://viacep.com.br/ws/{cep}/json/` |
| UFs | `GET https://servicodados.ibge.gov.br/api/v1/localidades/estados` |

---

## 3. Query string da landing

| Param | Uso na SPA |
|---|---|
| `id` | `idconsultor` / `sponsorId` — **obrigatório** |
| `cli` | `indcli` (indicado por cliente). Se ausente → `Number("")` → **`0`** |

Rotas React Router:
- `/` → wizard principal (`Bne`)
- `/companyRegister/` → criação de conta empresa no Clube Certo (`Kne`)

---

## 4. Fluxo oficial da UI

### 4.1 Tela inicial (`start`)
Dois botões:
- **Para mim** → `type = "PF"`
- **Para minha empresa** → `type = "PJ"`

Exibe nome do licenciado após `POST /auth/consultor`.

### 4.2 PF — 2 etapas

**Etapa 1 — Dados pessoais** (`schema Pb`)

| Campo (`name`) | Label | Máscara / regra Zod |
|---|---|---|
| `cpf_cnpj` | CPF | `000.000.000-00` · `kf.cpf` |
| `nome` | Nome | min 5 |
| `dtnasc` | Data de Nascimento | `00/00/0000` · date válida |
| `rg` | RG | min 5 |
| `email` | E-mail | email · máscara chars `[a-zA-Z0-9@._-]` |
| `celular` | Celular | `(00) 00000-0000` · **min 14** (com máscara) |

**Etapa 2 — Endereço** (`schema Tb`)

| Campo | Label | Regra |
|---|---|---|
| `cep` | CEP | `xxxxx-xxx` · length 9 |
| `endereco` | Logradouro | min 3 · autofill ViaCEP → readonly |
| `numero` | Número | min 1 |
| `complemento` | Complemento | opcional · default `""` |
| `bairro` | Bairro | min 2 · autofill |
| `uf` | (hidden) | sigla 2 letras (`SP`) — setado pelo select IBGE |
| `uf_select` | UF | id IBGE numérico (`35` = SP) — UI mostra nome do estado |
| `cidade` | Cidade | min 3 · autofill |

Botão final: **FINALIZAR** → `POST /cliente/club`.

**Sucesso PF (tela `sent`):**
mensagem de boas-vindas + download do app **iGreen Club**
(Play Store / App Store — ver [`APP-LINKS-CLIENTE.md`](./APP-LINKS-CLIENTE.md)).
**Sem boleto na UI.**

### 4.3 PJ — 5 etapas

1. **Plano** — `qtdevidasclub` (min 2) + `idplanopj` (de `GET /cliente/clube/planos`)
2. **Dados da empresa** — `cnpj`, `razao`, `fantasia`, `dtabertura`, `telefone`, `naturezajuridica` (+ hidden `nire`, `ie`)
3. **Endereço da empresa** — mesmos campos com prefixo `emp_` (`emp_cep`, `emp_endereco`, …)
4. **Dados pessoais do titular** — mesmo schema PF (`Pb`)
5. **Endereço do titular** — schema `Tb`

**Sucesso PJ:** contrato em até 48h + modelo `/modeloClubPj.pdf` + boleto em 3 dias úteis após assinatura (acesso online 24h / offline 10 dias). Depois fluxo `company-creation` no Clube Certo.

---

## 5. Submit — como a SPA monta o body

```js
// Dne.onSubmit
mutate({ ...formValues, indcli, idconsultor: sponsorId })
// → POST /cliente/club
```

- **Não há transformação** de data para ISO no submit (vai `dd/mm/aaaa`).
- **Máscaras vão no payload** (CPF, celular, CEP com pontuação).
- `uf_select` vai como **number** (id IBGE).
- `uf` vai como **sigla** string.
- Campos PJ (`idplanopj`, `qtdevidasclub`, `cnpj`, `emp_*`, …) só entram se o wizard PJ os preencheu — o mesmo endpoint recebe o merge.

---

## 6. Payload PF real (interceptado 2026-07-15, POST abortado)

```json
{
  "cpf_cnpj": "111.444.777-35",
  "nome": "TESTE MAPEAMENTO WORKER CLUB",
  "dtnasc": "01/01/1990",
  "rg": "123456789",
  "email": "teste.mapeamento.worker.club@example.com",
  "celular": "(11) 98765-4321",
  "cep": "01310-100",
  "endereco": "Avenida Paulista",
  "numero": "100",
  "complemento": "",
  "bairro": "Bela Vista",
  "uf": "SP",
  "uf_select": 35,
  "cidade": "São Paulo",
  "indcli": 0,
  "idconsultor": 124170
}
```

Headers obrigatórios no POST:
```
Authorization: Bearer <jwt>
Content-Type: application/json
Origin: https://club.igreenenergy.com.br
```

> ⚠️ O POST acima foi **interceptado e abortado** no browser (dry-run).
> A forma do body está confirmada; o shape da **resposta de sucesso/erro**
> do `/cliente/club` ainda precisa de um probe controlado (não feito de
> propósito para não criar cliente fantasma).

---

## 7. Diferenças críticas vs Portal 2 (`worker-portal-2`)

| | Portal Green (autoconexão) | Club |
|---|---|---|
| Host | `green.igreenenergy.com.br/autoconexao` | `club.igreenenergy.com.br` |
| API | `api-green-connection.igreenenergy.com.br` | `api.igreenenergy.com.br` |
| Auth | HMAC `x-frontend-*` | JWT Bearer via `/auth/consultor` |
| OCR / fatura / docs | sim | **não** |
| OTP WhatsApp | sim | **não** nesta SPA |
| Passos PF | 5 | **2** |
| Data no payload | ISO | **`dd/mm/aaaa` com máscara** |
| Pagamento UI PF | não | não (cobrança se existir é backend) |

**Não reutilizar** o client HMAC do Portal 2 neste worker.

---

## 8. Como revalidar quando algo mudar

```bash
# 1) Abrir com Playwright + proxy residencial (CF bloqueia datacenter)
# 2) Baixar o bundle atual
#    grep assets/index-*.js no HTML
# Âncoras úteis:
#   'endpoint:"/cliente/club"'
#   'endpoint:"/auth/consultor"'
#   'endpoint:"/cliente/clube/planos"'
#   'company-creation'
#   'const Pb=Kr({cpf_cnpj'
#   'const Tb=Kr({cep'
#   '$ne=e=>e===Yu.PF'

# 3) Probe seguro (sem POST real):
#    - POST /auth/consultor {idconsultor}
#    - GET  /cliente/clube/planos (com Bearer)
#    - Preencher UI PF até Finalizar com route.abort no /cliente/club
```

**Regra de ouro:** desconfiou? Não chute — abra a SPA com Playwright, intercepte
a rede e leia o bundle. Cada regra deste arquivo tem âncora verificável.

---

## 9. WorkerClub (implementado — serviço independente)

Pasta `worker-club/` — **não** compartilha client/fila/porta com Portal 2.

| Arquivo | Função |
|---|---|
| `club-api-client.mjs` | JWT + tunnel Playwright + `cadastrarPf({ dryRun })` |
| `club-normalize.mjs` | Máscaras oficiais + `montarPayloadClubPf` |
| `club-errors.mjs` | Classificação de erro |
| `server.mjs` | HTTP :3102 · fila `club-worker-leads` · dryRun default |
| `test/` | Unitários de payload/máscara |

Live POST só com `dryRun:false` (ALLOW_LIVE_CLUB_POST já liberado no Dockerfile).
Decisão de **cortesia/gratuidade** (§0) continua aberta no produto.

---

## 10. Checklist do que JÁ está 100% confirmado

- [x] Landing + botões PF/PJ
- [x] Auth `POST /auth/consultor` + JWT 2h + localStorage
- [x] Campos e schemas Zod PF (etapa 1 e 2)
- [x] ViaCEP autofill + IBGE estados (`uf` sigla + `uf_select` id)
- [x] Payload real do `POST /cliente/club` (PF)
- [x] `GET /cliente/clube/planos` (PJ)
- [x] Fluxo PJ (passos + company-creation + Clube Certo) via bundle
- [ ] Shape da resposta de sucesso/erro de `POST /cliente/club` (falta probe)
- [ ] Comportamento cobrado vs cortesia no backend (fora desta SPA)
- [ ] Caso `inadimplente: true` na UI
