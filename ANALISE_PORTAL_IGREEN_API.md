# Análise: como pegar os dados do portal iGreen (nova API)

Data da análise: 01/07/2026
Portal analisado: https://escritorio.igreenenergy.com.br
Login usado: rafael.ids@icloud.com (consultor idconsultor=124170)

Ferramenta: navegação automatizada com Playwright + inspeção dos arquivos
JavaScript do site e teste real dos endpoints.

---

## 1. Resumo executivo (o que mudou)

O portal **mudou de arquitetura por completo**. O que existia antes:

- Site antigo com páginas `/mapa-clientes` e `/mapa-rede`.
- A extensão de navegador (`extension/igreen-sync`) clicava em "Exportar Excel",
  capturava o arquivo `.xlsx` e mandava para a edge function
  `igreen-ingest-xlsx`, que fazia o parse das planilhas.

O que existe agora:

- O portal é um aplicativo moderno (SPA em React) que **não tem mais botão de
  Exportar Excel**. Ele consome uma **API REST em JSON**:
  `https://api-vo.igreenenergy.com.br/v1` ("vo" = Virtual Office).
- As páginas mudaram de nome: agora são **"Clientes Green"** (`/clientes-green`)
  e **"Rede"** (`/rede-lider`), além de CRM, Financeiro, Painel do Líder, etc.
- A autenticação é por **token JWT** (`POST /v1/auth/session` devolve um token
  válido por 1 hora).

**Conclusão prática:** não dá mais para "baixar Excel/PDF". O jeito certo, mais
limpo e mais completo de trazer os dados agora é **consumir a API REST direto**
(JSON já estruturado). Isso é melhor do que o método antigo — não depende de
parse de planilha e traz mais campos.

---

## 2. O grande obstáculo: Cloudflare

Tanto o site quanto a API `api-vo` ficam atrás do **Cloudflare** (um "segurança"
anti-robô). Consequências que confirmei nos testes:

- Requisição feita por `curl` ou por navegador **headless** (sem tela) para a
  API → **403 "Attention Required" (bloqueado)**.
- Navegador headless conseguiu fazer o **login** e as **chamadas de API que
  acontecem logo após o primeiro carregamento**, mas ao trocar de tela
  (clicar em "Clientes Green") o Cloudflare bloqueava os arquivos internos.
- O que **funcionou de forma confiável**: rodar o **Chrome real** (modo com
  tela / headed, usando o display do sistema). Nesse modo o Cloudflare libera
  tudo — login, troca de telas e todas as chamadas de API.

**Implicação para a automação:** qualquer robô que for buscar esses dados precisa
se comportar como um navegador real (idealmente Chrome headed, ou headless bem
disfarçado). Um `fetch`/`curl` simples do servidor **não passa** no Cloudflare.

Detalhes técnicos observados:
- O cookie `cf_clearance` é emitido após o desafio, mas é amarrado a IP + User-Agent
  (não dá para reaproveitar em `curl`).
- Endpoints da API respondem com JSON limpo `{"success":false,"error":{"code":"NOT_FOUND"...}}`
  para rota inexistente — ou seja, dá para distinguir "rota errada" (404) de
  "bloqueio Cloudflare" (403 HTML).

---

## 3. Autenticação

```
POST https://api-vo.igreenenergy.com.br/v1/auth/session
Body: { "email": "<email>", "password": "<senha>", "keepConnected": true|false }
Resposta: { "success": true, "data": { "token": "<JWT>", "expiresIn": 3600 } }
```

- O body foi confirmado no código do app (campos: `email`, `password`,
  `keepConnected`).

- O token é um **JWT** com `sub` = idconsultor, `exp` = +1h.
- Todas as demais chamadas usam o header: `Authorization: Bearer <token>`.
- Existe também `POST /v1/auth/recaptcha` (o login pode exigir reCAPTCHA).

Renovação: como expira em 1 hora, a automação precisa re-logar/renovar o token
periodicamente.

---

## 4. Endpoints descobertos (todos testados, exceto onde indicado)

Base: `https://api-vo.igreenenergy.com.br/v1`

### 4.1 Consultor / dashboard (já usados hoje pelo portal)
| Método | Rota | O que traz |
|---|---|---|
| GET | `/consultant` | Dados do consultor logado (idconsultor, nome, email, cpf, cnpj, graduacao) |
| GET | `/consultant/activation-code` | Cupons/campanhas (blackFriday etc.) |
| GET | `/dashboard/summary` | `{ rootConsultantId, networkSize }` |
| GET | `/dashboard/customers-by-region?idgraduacao=13` | Clientes por cidade (regiao, totalcustomer) |
| GET | `/dashboard/daily-analysis?idgraduacao=13&dateField=DATA_VALIDADOSUCESSO` | Série diária de cadastros |

### 4.2 Clientes ("Clientes Green") — substitui o antigo `/mapa-clientes`
Todos sob `/clientes-green`:

| Método | Rota + parâmetros | O que traz |
|---|---|---|
| GET | `/clientes-green/resumo-geral` | Totais gerais (totalCadastros, mwh, validados, aguardando, devolutivas, cancelados, reprovados, agAssinatura, licenciados, kwhValidados) |
| GET | `/clientes-green/overview?mes=YYYY-MM` | Visão do mês (funil por status + aniversariantes) |
| GET | `/clientes-green/financeiro` | Resumo financeiro (emProducao, pagos, disponivel, vencidosTotal, injecao) |
| GET | `/clientes-green/buscar?search=<txt>&page=1&perPage=20` | **Busca de clientes por nome** → items[{codigo, nome, cidade, uf, licenciado, consumo, status}], total, counts |
| GET | `/clientes-green/cadastros?dia=YYYY-MM-DD&status=<s>&search=&page=1&perPage=20` | **Cadastros de um dia** (mesmos campos de item). `dia` é **obrigatório**. `status` ∈ todos\|validado\|aguardando\|devolutiva\|assinatura\|cancelado\|reprovado |
| GET | `/clientes-green/drilldown?bucket=<b>&mes=YYYY-MM&search=&page=1&perPage=20` | **Lista de clientes por categoria/mês**. `bucket` ∈ validado\|aguardando\|devolutiva\|assinatura\|reprovado\|cancelado\|com_energia\|aniversariantes\|licenciados |
| GET | `/clientes-green/cidades?periodo=<mes\|geral>&sort=<crescimento\|total>&search=` | Clientes por cidade (cidade, uf, total, ativos, licenc, aguard, devol, cancel, reprov) |
| GET | `/clientes-green/licenciados?periodo=<mes\|geral>&sort=<crescimento\|total\|validados>&faixa=<todos\|1-4\|5-9\|10-19\|20+>&search=` | Ranking de licenciados (idLicenciado, nome, cidade, uf, graduacao, total, kwh, assin/valid/aguard/devol/cancel/reprov com n+kwh) |
| GET | `/clientes-green/devolutivas?categoria=<c>&search=&page=1&perPage=20` | Clientes com devolutiva (codigo, nome, cidade, uf, licenciado, motivo, categoria). `categoria` ∈ todos\|problemas_fatura\|debitos\|erro_documento\|testemunha\|outros |
| GET | `/clientes-green/devolutivas/resumo?search=` | Resumo das devolutivas por categoria |
| GET | `/clientes-green/boletos?status=<s>&injecao=<todos\|com\|sem>&tipo=<todos\|unico\|duplo>&search=&page=1&perPage=20` | Boletos por cliente (idcliente, nome, cidade, uf, licenciado, total, valorFornecedora, valorDistribuidora, vencimento, mesReferencia, status, diasAtraso, injecao, kwhCompensado, contaUnica, fornecedora, tipoPagamento, urlinvoice, urlboleto, direto, celular). `status` ∈ todos\|pago\|disponivel\|vencido\|vencido_1_30\|vencido_31_60\|vencido_60 |
| GET | `/clientes-green/boletos/{idcliente}` | **DETALHE COMPLETO DO CLIENTE** (ver 4.4) |

### 4.2.b CRM Green — MELHOR fonte para a carteira de clientes (descoberta)

`GET /crm/green` retorna um **Kanban completo de clientes agrupados por status**,
e — diferente de `/clientes-green/buscar` — **já traz o celular, distribuidora,
cidade, kWh, data e devolutiva de cada cliente na própria lista**, numa única
chamada (não precisa de N chamadas de detalhe). É o substituto mais direto do
antigo Excel de clientes.

Colunas retornadas (`data[]` = colunas, cada uma com `cards[]`):
`aguardando_assinatura`, `aguardando` (validação), `devolutiva`, `reprovado`,
`validado`, `adimplente`, `menos_30d` (<30 dias), `inadimplente`, `cancelado`.

Campos de cada card:
```
codigo, nome, cidade, uf, kwh, distribuidora, celular, data, devolutiva,
atraso, diasAtraso
```

Relacionados (por produto): `GET /crm/telecom`, `/crm/seguros`, `/crm/expansao`.

Complementares de cliente:
- `GET /customer-devolutivas/{idcliente}` → devolutiva completa em texto
  (com prefixos `caminhoarquivo:` que a ingestão atual já sabe limpar).
- `GET /clientes-green/boletos/{idcliente}` → ficha + boletos (CPF, instalação,
  concessionária, datas).

### 4.3 Rede ("Rede" / Rede-Líder) — substitui o antigo `/mapa-rede`
Todos sob `/network-map`:

| Método | Rota + parâmetros | O que traz |
|---|---|---|
| GET | `/network-map` | **Rede inteira** (lista plana de todos os consultores) |
| GET | `/network-map?idgraduacao=13` | idem, filtrado por graduação |
| GET | `/network-map/data?month=YYYY-MM` | **Rede completa do mês** com todos os campos (ver 4.4) |
| GET | `/network-map/head?month=YYYY-MM` | Raiz da árvore (root) + resumo |
| GET | `/network-map/search?search=<txt>&month=YYYY-MM` | Busca por membro |
| GET | `/network-map/{idconsultor}/detalhe` | Detalhe do consultor (graduação atual/próxima, gp, gi, bonificavel, qualificavel, clientesAtivos, metas de qualificação) |
| GET | `/network-map/{idconsultor}/diretos` | Diretos do consultor (idconsultor, nome, cidade, uf, graduacao, dataAtivo, clientesAtivos, diretos, ativo) |
| GET | `/network-map/{idconsultor}/node-cards?month=YYYY-MM` | Cartões dos nós filhos (nivel, idconsultor, nome, celular, cidade, uf, gp, gi, bonificavel, qualificavel, dataAtivo, graduacao, graduacaoExpansao, licenciadosDiretos, licenciadosDiretosAtivos, clientesAtivos, diretosPro, pro) |

### 4.4 Campos-chave que a API entrega hoje

**`/network-map/data` (por membro da rede):**
```
nivel, idconsultor, nome, celular, cidade, uf, gp, gi, bonificavel,
qualificavel, dataAtivo, graduacao, graduacaoExpansao, licenciadosDiretos,
licenciadosDiretosAtivos, clientesAtivos, diretosPro, pro, patrocinador,
devolutivas, agValid
```

**`/clientes-green/boletos/{idcliente}` (detalhe do cliente — o mais rico):**
```
idcliente, nome, cidade, uf, concessionaria, direto, celular, cpf,
instalacao, numCliente, consumo, statusCliente, dataAtivo, dataInjecao,
fornecedora, licenciado, situacao, trocaTitularidade,
boletos: [{ mesReferencia, total, valorFornecedora, valorDistribuidora,
  contaUnica, injecao, kwhCompensado, vencimento, pagamento, status,
  fornecedora, tipoPagamento, urlinvoice, urlboleto }]
```

---

## 5. O que a nossa plataforma espera (schema atual) x o que a API traz

Nossa ingestão hoje (`igreen-ingest-xlsx`) preenche estas tabelas:

- `customers` — cliente (carteira iGreen). Campos importantes vindos do iGreen:
  `igreen_code`, `name`, `cpf`, `email`, `phone_whatsapp`, `address_city`,
  `address_state`, `distribuidora`, `numero_instalacao`, `media_consumo`,
  `desconto_cliente`, `andamento_igreen`, `devolutiva`, `registered_by_name`,
  `registered_by_igreen_id`, `data_cadastro_igreen`, `data_ativo_igreen`,
  `data_validado_igreen`, `status_financeiro`, `cashback_igreen`,
  `assinatura_cliente_status`, `assinatura_igreen_status`, `link_assinatura`,
  `nivel_licenciado`, `data_nascimento`, `observacao_igreen`.
- `network_members` — membro da rede (idgreen_id, name, phone, sponsor_id,
  nivel, cidade, uf, graduacao, gp, gi, gt_qualificavel, bonificavel,
  green_points_ano, gp_mes, gi_mes, clientes_ativos, licenciados_diretos,
  licenciados_diretos_ativos, pro, etc.).
- `consultant_network` — espelho da rede (codigo_igreen, nivel, nome,
  patrocinador_codigo, celular, cidade, uf, graduacao, gp/gl_qualificados).

### Mapeamento CLIENTES (API → nosso `customers`)

| Nosso campo | Fonte na API nova | Observação |
|---|---|---|
| `igreen_code` | `codigo` / `idcliente` | chave do cliente no iGreen |
| `name` | `nome` | ok |
| `cpf` | `boletos/{id}.cpf` | **só no detalhe**, não vem na lista |
| `phone_whatsapp` | `boletos/{id}.celular` ou `boletos.celular` | **só em boletos/detalhe** |
| `address_city` | `cidade` | ok |
| `address_state` | `uf` | ok |
| `distribuidora` | `boletos/{id}.concessionaria` | detalhe |
| `numero_instalacao` | `boletos/{id}.instalacao` | detalhe |
| `media_consumo` | `consumo` | ok (lista traz `consumo`) |
| `andamento_igreen` / `status` | `status` / `situacao` | valores: validado/aguardando/devolutiva/assinatura/cancelado/reprovado |
| `devolutiva` | `/devolutivas.motivo` | ok (endpoint separado) |
| `registered_by_name` | `licenciado` | ok |
| `data_ativo_igreen` | `boletos/{id}.dataAtivo` | detalhe |
| `fornecedora` | `fornecedora` | novo campo já existe na tabela |
| `contaunica` | `boletos.contaUnica` | já existe |

### Mapeamento REDE (API → nosso `network_members`)

| Nosso campo | Fonte na API nova |
|---|---|
| `igreen_id` | `idconsultor` |
| `name` | `nome` |
| `phone` | `celular` |
| `sponsor_id` | `patrocinador` |
| `nivel` | `nivel` |
| `cidade` / `uf` | `cidade` / `uf` |
| `graduacao` | `graduacao` |
| `graduacao_expansao` | `graduacaoExpansao` |
| `gp` / `gi` | `gp` / `gi` |
| `bonificavel` | `bonificavel` |
| `gt_qualificavel` | `qualificavel` |
| `clientes_ativos` | `clientesAtivos` |
| `licenciados_diretos` | `licenciadosDiretos` |
| `licenciados_diretos_ativos` | `licenciadosDiretosAtivos` |
| `qtde_diretos` | `qtde_diretos` (em `/network-map` sem month) |
| `data_ativo` | `dataAtivo` |
| `pro` | `pro` |

**Cobertura da rede:** praticamente 100%. A API nova cobre todos os campos que
o Excel de rede trazia — e ainda melhor (dados já tipados, sem parse de planilha).

---

## 6. O que está FALTANDO (lacunas — atualizado após varredura completa)

Após baixar **todos os 61 chunks** do app e mapear **todos os endpoints**, as
lacunas ficaram bem menores:

1. **RESOLVIDO — celular/distribuidora do cliente:** vêm direto em `/crm/green`
   (não precisa mais de N chamadas de detalhe como se pensava). CPF, instalação
   e concessionária continuam só no detalhe `/clientes-green/boletos/{id}`, mas
   isso só é necessário para quem precisar do documento completo.

2. **E-mail, endereço completo (rua/número/bairro/CEP), nome do pai/mãe, RG,
   data de nascimento** — **não aparecem em nenhum endpoint** do portal novo.
   O portal antigo (Excel) também não trazia. Esses campos hoje vêm do fluxo de
   cadastro do próprio bot, não do portal iGreen. **Conclusão:** não são
   obtidos por esta integração (nunca foram).

3. **`link_assinatura`, `cashback`, `status_financeiro`, `desconto_cliente`** —
   não há endpoint dedicado no portal novo. Há `/cashback/resumo` (mas exige
   parâmetro `origem` válido, a confirmar) e os dados financeiros agregados em
   `/clientes-green/financeiro` e `/painel/*`. Assinatura individual: parece ter
   saído do escopo do portal (era coluna do Excel antigo).

4. **`data_validado` por cliente** — disponível indiretamente via `/crm/green`
   (coluna `validado` traz `data`) e via `/clientes-green/drilldown?bucket=validado`.

5. **Cloudflare (continua sendo o ponto de atenção operacional)** — a coleta
   PRECISA rodar em navegador real (Chrome headed) ou dentro do navegador do
   consultor (extensão). `curl`/`fetch` de servidor **não passa**.

### Endpoints extras descobertos (fora de clientes/rede)
O portal novo tem muito mais do que o Excel antigo cobria:
- `/painel/*` — Painel do Líder (overview, produção, team, inativos, onboarding,
  licenças expirando, ranking, eventos, top-expansão).
- `/rotinas/*` — Rotinas de CEO (diária, semanal, mensal, avanços, boletos,
  devolutivas-novas, engajamento, pessoas, pro, top-performance).
- `/telecom/*` e `/seguros/*` — carteiras de outros produtos (mesma estrutura de
  clientes-green: buscar/cadastros/cidades/licenciados/financeiro/resumo-geral).
- `/crm/{green|telecom|seguros|expansao}` — Kanban por produto.
- `/analise-pro/summary`, `/analise-retencao/summary`, `/estatisticas-pro`,
  `/pro-builder`, `/cashback/resumo`, `/export-file/{id}`, `/view/{id}`.

---

## 7. Recomendação de arquitetura para a nova coleta

Duas opções, da mais robusta para a mais simples:

### Opção A — Reaproveitar a extensão de navegador (recomendado)
A extensão `igreen-sync` já roda dentro do Chrome do consultor (sessão logada,
Cloudflare já liberado). Em vez de clicar em "Exportar Excel" (que não existe
mais), ela passa a:
1. Ler o token JWT que o app guarda (localStorage/sessionStorage) — ou
   observar a chamada `/v1/auth/session`.
2. Chamar os endpoints REST (`/clientes-green/*`, `/network-map/*`) com
   `fetch(..., { credentials: 'include' })` a partir da página do portal
   (herda cookies + passa Cloudflare).
3. Enviar o JSON já estruturado para uma **nova edge function**
   (`igreen-ingest-json`) que faz upsert em `customers` / `network_members`.

Vantagens: contorna Cloudflare de graça, sem precisar re-logar, sem risco de
bloqueio de IP de servidor.

### Opção B — Worker headless próprio (Chrome real)
Um serviço backend com Playwright + **Chrome headed** (via Xvfb) que loga,
renova token de hora em hora e chama a API. Mais controle e agendamento, mas
precisa lidar ativamente com Cloudflare (headed obrigatório) e com o risco de
challenge/captcha no login.

### Em ambos os casos
- Criar a edge function **`igreen-ingest-json`** (novo formato JSON) mantendo a
  `igreen-ingest-xlsx` por compatibilidade durante a transição.
- Para clientes: usar **`/crm/green`** (uma única chamada traz todos os clientes
  agrupados por status, já com celular/distribuidora/cidade/kWh/data/devolutiva).
  Complementar com `/clientes-green/boletos/{id}` só quando precisar de
  CPF/instalação/concessionária.
- Para rede: `/network-map/data?month=YYYY-MM` cobre tudo de uma vez.

---

## 8. Próximos passos sugeridos

1. Confirmar os campos do `POST /v1/auth/session` (body exato) capturando o
   request no Chrome headed. **RESOLVIDO:** body = `{ email, password, keepConnected }`.
   Antes do login o app chama `/auth/recaptcha` (há verificação de segurança —
   principal risco para automação sem navegador real).
2. Definir com o time: coleta via **extensão** (Opção A) ou **worker** (Opção B).
3. Implementar `igreen-ingest-json`:
   - Clientes ← `/crm/green` (+ boletos/{id} opcional para CPF/instalação).
   - Rede ← `/network-map/data?month=YYYY-MM`.
   - Devolutivas ← `/customer-devolutivas/{id}` (texto completo).
4. (Opcional) Ingerir também Telecom e Seguros (`/telecom/*`, `/seguros/*`) e
   os painéis (`/painel/*`, `/rotinas/*`) — recursos que o Excel antigo não tinha.
5. Volume atual é pequeno (~571 cadastros, ~31-60 na rede); throttling leve basta.

---

## Anexos (evidências coletadas)

Amostras reais de resposta salvas em `.tmp/portal-analyze/` (schema, schema2..5).
Chunks do app baixados em `.tmp/portal-analyze/headed/` (contêm a definição dos
endpoints): `useClientesGreenQueries`, `useNetworkMapData`, `ClientesGreenPage`,
`ClienteBoletoDrawer`, `RedePage`.
