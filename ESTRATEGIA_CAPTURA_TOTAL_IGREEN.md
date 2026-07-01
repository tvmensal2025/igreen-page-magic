# Estratégia de Captura Total — Escritório iGreen (por consultor)

Data: 01/07/2026
Base: análise ao vivo do portal novo (`api-vo.igreenenergy.com.br/v1`) com o
Chrome real (passa Cloudflare). Consultor de teste: idconsultor 124170.

Objetivo: cada consultor conecta **seu próprio** login iGreen (email+senha) na
tela de configuração; o **Worker Green** (EasyPanel) puxa **tudo** que o portal
expõe daquele consultor, de forma individual e isolada.

---

## 1. Como fica a configuração individual (já existe base pronta)

O banco já tem as colunas em `consultants`:
- `igreen_portal_email`, `igreen_portal_password` (RLS por dono; `password`
  tem `REVOKE SELECT` para authenticated/anon — só service_role lê).
- `igreen_consultor_id`, `igreen_access_token`, `igreen_token_expires_at`,
  `igreen_token_expired`, `igreen_connect_code`.

A edge `sync-igreen-customers` **já itera por consultor** (pega todos os
`approved` com email+senha e sincroniza cada um). Ou seja, o modelo "cada
usuário tem o seu" **já está de pé** — só precisamos:

1. Uma tela em **Configurações → Dados / Integração iGreen** onde o consultor
   digita email+senha do escritório (salva em `consultants`).
2. O Worker Green usando esses dados para logar e puxar **tudo dele**.

Segurança: senha continua protegida por RLS + revoke de coluna. Recomendo
(fase 2) **criptografar em repouso** (pgcrypto/Vault) em vez de texto puro —
hoje está em texto (ver `docs/auditoria/07-seguranca.md`).

---

## 2. TUDO que o portal novo expõe (mapeado e testado)

Base: `https://api-vo.igreenenergy.com.br/v1` · Auth: `Bearer <token>` ·
Login: `POST /auth/session {email,password,keepConnected}` (SEM reCAPTCHA hoje).

### 2.1 Identidade / dashboard
| Endpoint | Traz |
|---|---|
| `/consultant` | idconsultor, nome, email, cpf, cnpj, graduacao |
| `/dashboard/summary` | rootConsultantId, networkSize |
| `/dashboard/customers-by-region?idgraduacao=` | clientes por cidade |
| `/dashboard/daily-analysis?idgraduacao=&dateField=` | série diária |

### 2.2 Clientes Green (carteira de energia) — PRINCIPAL
| Endpoint | Traz |
|---|---|
| **`/crm/green`** | **Kanban completo**: colunas (aguardando_assinatura, aguardando, devolutiva, reprovado, validado, adimplente, menos_30d, inadimplente, cancelado) com cards `{codigo,nome,cidade,uf,kwh,distribuidora,celular,data,devolutiva,atraso,diasAtraso}` |
| `/clientes-green/resumo-geral` | totalCadastros, mwh, validados/aguardando/devolutivas/cancelados/reprovados/agAssinatura (n+mwh), licenciados, kwhValidados |
| `/clientes-green/overview?mes=YYYY-MM` | funil do mês + aniversariantes |
| `/clientes-green/financeiro` | emProducao, pagos, disponivel, vencidosTotal, injecao |
| `/clientes-green/buscar?search=&page=&perPage=` | busca por nome (codigo,nome,cidade,uf,licenciado,consumo,status) |
| `/clientes-green/cadastros?dia=YYYY-MM-DD&status=&search=&page=&perPage=` | cadastros de um dia |
| `/clientes-green/drilldown?bucket=&mes=YYYY-MM&...` | lista por status/mês |
| `/clientes-green/cidades?periodo=mes\|geral&sort=...` | clientes por cidade (total,ativos,licenc,aguard,devol,cancel,reprov) |
| `/clientes-green/licenciados?periodo=&sort=&faixa=&search=` | ranking de licenciados (kwh + n por status) |
| `/clientes-green/devolutivas?categoria=&search=&page=&perPage=` | clientes com devolutiva + motivo |
| `/clientes-green/devolutivas/resumo?search=` | resumo por categoria |
| `/clientes-green/boletos?status=&injecao=&tipo=&...` | boletos por cliente (valores, vencimento, urlboleto, urlinvoice, celular) |
| **`/clientes-green/boletos/{idcliente}`** | **FICHA COMPLETA**: cpf, instalacao, numCliente, concessionaria, consumo, dataAtivo, dataInjecao, fornecedora, situacao, trocaTitularidade, celular + todos os boletos |
| `/customer-devolutivas/{idcliente}` | texto completo da devolutiva |

### 2.3 Rede (downline) — substitui o "mapa-rede"
| Endpoint | Traz |
|---|---|
| `/network-map` | rede plana (idconsultor,nome,celular,idpatrocinador,nivel,data_ativo,cidade,uf,cliativo,gp,gi,qtde_diretos,...) |
| **`/network-map/data?month=YYYY-MM`** | **rede completa do mês** com campos ricos: bonificavel, qualificavel, graduacao, graduacaoExpansao, licenciadosDiretos, licenciadosDiretosAtivos, clientesAtivos, diretosPro, pro, patrocinador, devolutivas, agValid |
| `/network-map/head?month=` | raiz + resumo |
| `/network-map/search?search=&month=` | busca por membro |
| `/network-map/{id}/detalhe` | graduação atual/próxima + metas de qualificação (gp,gi,bonificavel,qualificavel,clientesAtivos) |
| `/network-map/{id}/diretos` | diretos (nome,cidade,uf,graduacao,dataAtivo,clientesAtivos,diretos,ativo) |
| `/network-map/{id}/node-cards?month=` | cartões dos filhos (todos os campos ricos) |
| `/network-map/{id}/contato` | WhatsApp formatado (`wa`) |

### 2.4 Painel do Líder (gestão) — NOVO, não existia no Excel
| Endpoint | Traz |
|---|---|
| `/painel/overview` | kpis (clientes green/telecom/seguros, licenciadosAtivos, diretos, gpMes, giMes), alertas (licenças, inativos), rede.tamanho, qualificavel |
| `/painel/producao` | bonificavelGp, bonificavelGi, qualificavel, bonusPrevia |
| `/painel/team` | onboarding, novosDoDia, aniversariantes |
| `/painel/ranking-movements` | movimentações de ranking |
| `/painel/inativos?page=&perPage=&filtro=` | inativos (filtro obrigatório) |
| `/painel/onboarding?page=&perPage=` | onboarding |
| `/painel/eventos` + `/eventos/confirmados` + `/eventos/vendas` | eventos, check-ins, ingressos |
| `/painel/top-expansao?periodo=&page=&perPage=` | top expansão |

### 2.5 Rotinas de CEO (gestão diária/semanal/mensal) — NOVO
| Endpoint | Traz |
|---|---|
| `/rotinas/diaria` | aniversariantes, novosDia, engajados, primeiroBoleto, vencendoHoje, inad1/30/60, novasDevolutivas |
| `/rotinas/semanal` | topPerformance, pro, avancos, novosSemAtivacao, esfriando, reeng30/60/90 |
| `/rotinas/mensal` | licencasVencendo, mesesProTotal, novosClientesMes/Prev, novosLicenciadosMes/Prev, proMes, avancosMes |
| `/rotinas/{avancos,boletos,devolutivas-novas,engajamento,pessoas,pro,top-performance}?mes=` | listas paginadas por tema (ex.: boletos → idcliente,nome,cidade,uf,valor,vencimento,diasAtraso,urlboleto) |
| `/rotinas/licenciado/{id}/detalhe` | detalhe de licenciado |

### 2.6 Pro / Análises
| Endpoint | Traz |
|---|---|
| `/pro-builder?mes=` | kpis (pros, construcao, redeLicenciados, p3/p6/p9/p12) + items |
| `/pro-builder/trajetoria` | streak, recorde, emDia |
| `/analise-pro/summary`, `/analise-retencao/summary`, `/estatisticas-pro` | (exigem parâmetros; a mapear) |

### 2.7 Telecom (carteira de telefonia) — NOVO produto
| Endpoint | Traz |
|---|---|
| `/telecom/resumo-geral` | ativas, total, canceladas, portConfirmada, portPendente, carteiraMensal |
| `/telecom/financeiro` | pago, aVencer, vencido, topInadimplentes |
| `/telecom/resumo-mes?mes=` | novas, portab, canceladas, licenciados |
| `/telecom/buscar?search=&page=&perPage=` | lista de linhas (items, counts) |
| `/telecom/{cadastros,cidades,drilldown,faturas,licenciados,pendencias}` | detalhes |

### 2.8 Seguros — NOVO produto
| Endpoint | Traz |
|---|---|
| `/seguros/resumo-geral` | vigentes, total, canceladas, carteiraMensal |
| `/seguros/financeiro` | carteiraMensal, vigentes, primeiraPaga, primeiraPendente |
| `/seguros/overview` | kpis, geracao, topLicenciados |
| `/seguros/{buscar,cadastros,cidades,licenciados,pendencias}` | detalhes |

### 2.9 Outros
- `/crm/{green,telecom,seguros,expansao}` — Kanban por produto.
- `/cashback/resumo?origem=` — cashback (parâmetro `origem` a confirmar).
- `/export-file/{id}`, `/view/{id}` — download de arquivos/faturas.

---

## 3. O que dá para MELHORAR na nossa plataforma (dados reais novos)

Comparando com o que a ingestão antiga (Excel) trazia, o portal novo permite
**muito mais**. Propostas de melhoria, por prioridade:

### 3.1 Enriquecer a carteira de clientes (alto valor, baixo esforço)
Hoje `customers` recebe pouco do sync. Com a API dá para preencher/atualizar:
- **Status real e granular** (`/crm/green`): validado, aguardando assinatura,
  devolutiva, reprovado, adimplente, inadimplente, <30 dias, cancelado.
- **Celular, distribuidora, cidade, kWh, data** — direto do `/crm/green`.
- **CPF, instalação, concessionária, dataAtivo, situacao, fornecedora,
  trocaTitularidade** — via `/clientes-green/boletos/{id}` (enriquecimento).
- **Devolutiva completa** (motivo) — `/customer-devolutivas/{id}`.
- **Boletos/faturas do cliente** (valor, vencimento, status, PDF) — nova
  funcionalidade: mostrar situação financeira do cliente no CRM.

Colunas que já existem em `customers` e podem ser alimentadas:
`igreen_code, cpf, phone_whatsapp, address_city, address_state, distribuidora,
numero_instalacao, media_consumo, andamento_igreen, devolutiva, fornecedora,
contaunica, data_ativo_igreen, data_validado_igreen, status`.

### 3.2 Enriquecer a rede (médio valor)
`network_members` já tem colunas para quase tudo do `/network-map/data`:
`bonificavel, gt_qualificavel (=qualificavel), graduacao, graduacao_expansao,
licenciados_diretos, licenciados_diretos_ativos, clientes_ativos, pro, gp, gi`.
Basta o worker mandar esses campos (hoje manda só os básicos).

### 3.3 Painéis de gestão (novo — grande diferencial)
Trazer para dentro da nossa plataforma o que o líder vê no portal:
- **KPIs do consultor** (`/painel/overview`): clientes por produto, licenciados
  ativos, diretos, GP/GI do mês, alertas de licenças/inativos.
- **Rotinas** (`/rotinas/*`): aniversariantes do dia, novos sem ativação,
  clientes esfriando, reengajamento 30/60/90, boletos vencendo, novas
  devolutivas. Isso vira **tarefas/alertas** e pode alimentar o bot de WhatsApp
  (ex.: disparar mensagem para aniversariante, cobrar boleto vencendo).
- **Pro-builder / trajetória**: acompanhamento de metas.

Sugestão de novas tabelas (fase 2):
- `igreen_consultant_metrics` (snapshot mensal por consultor: gp, gi,
  bonificavel, qualificavel, clientes por produto, licenciados, diretos).
- `igreen_customer_boletos` (boletos por cliente: valor, vencimento, status, url).
- `igreen_daily_routine` (foto diária das rotinas para gerar tarefas/alertas).

### 3.4 Multiproduto (novo)
Passar a capturar **Telecom** e **Seguros** além de energia — alimenta as
tabelas `sales`/`products` que já existem no banco, dando visão multiproduto
real por consultor.

### 3.5 Automação inteligente (usando os dados)
- Cliente com **boleto vencendo** → bot envia lembrete (dados de `/rotinas/boletos`).
- **Nova devolutiva** → alerta para o consultor resolver (`/rotinas/devolutivas-novas`).
- **Aniversariante** → mensagem automática (`/rotinas/diaria`).
- Cliente **reprovado/cancelado** → trilha de recuperação.

---

## 4. Estratégia do Worker Green (individual por consultor)

### Fluxo
```
Edge sync-igreen-customers (por consultor, agendada ou manual)
  → POST worker /sync-all { portal_email, portal_password }
     Worker (EasyPanel): Tor → CF ✅ → /auth/session → token (cache 30min)
       ├─ /consultant                      → identidade + idconsultor
       ├─ /crm/green                        → clientes (achatar Kanban)
       ├─ /network-map/data?month=          → rede completa
       ├─ /painel/overview                  → KPIs do consultor
       ├─ /rotinas/diaria|semanal|mensal    → rotinas/alertas
       ├─ /clientes-green/resumo-geral      → totais
       └─ (opcional) boletos/{id} p/ validados → CPF/instalação
  → edge normaliza e faz upsert em customers, network_members,
    igreen_consultant_metrics, igreen_customer_boletos, ...
```

### Endpoints do worker (novos/atualizados)
- `POST /sync-customers` → `/crm/green` (achatado) `{ok, consultor_id, customers}`
- `POST /sync-network`   → `/network-map/data?month=` `{ok, consultor_id, members}`
- `POST /sync-metrics`   → `/painel/overview` + `/rotinas/*` `{ok, metrics, routines}`
- `POST /sync-all`       → tudo de uma vez (recomendado; 1 login, N chamadas)

### Regras
- **1 login por consultor a cada 30min** (cache já existe) — reaproveita o
  token para todas as chamadas.
- **Isolamento total**: cada request carrega o email/senha do consultor; o
  worker nunca mistura sessões (Map por email + GC).
- **Cloudflare**: Tor + classificação `igreen_waf_blocked` já prontos. Retry
  com novo circuito Tor em caso de bloqueio.
- **Sem 2captcha** no login novo (confirmado); manter como fallback condicional.
- **Throttle** no enriquecimento por boleto (ex.: 5 req/s, só validados/ativos).

---

## 5. Plano de implementação (fases)

**Fase 1 — Paridade (fazer funcionar de novo):**
1. Worker: trocar base para `api-vo`, login `/auth/session`, clientes via
   `/crm/green`, rede via `/network-map/data`, de-para de campos. Sem 2captcha.
2. Edge: já compatível (contrato mantido). Ajustar `buildRecord` para os campos
   do `/crm/green` (status granular, distribuidora, celular).
3. Tela de Configurações → Dados: campo email+senha iGreen por consultor.
4. Deploy do worker no EasyPanel + teste `/health`, `/sync-network`, `/sync-customers`.

**Fase 2 — Enriquecimento:**
5. Enriquecer clientes (CPF/instalação via boletos) e rede (campos ricos).
6. Novas tabelas: `igreen_consultant_metrics`, `igreen_customer_boletos`,
   `igreen_daily_routine`.
7. Endpoint `/sync-all` no worker + `/sync-metrics`.

**Fase 3 — Inteligência & multiproduto:**
8. Telecom + Seguros (tabelas `sales`/`products`).
9. Automação: alertas/tarefas a partir de `/rotinas/*` e boletos vencendo.
10. Dashboards de gestão na plataforma (espelho do Painel do Líder).

---

## 6. Riscos / cuidados
- **Senha em texto** no banco: migrar para criptografia em repouso (fase 2).
- **Cloudflare** exige navegador real (Tor) — nunca `fetch`/`curl` puro.
- **Token 1h** — cache de 30min cobre; renovar sob demanda.
- **Volume** pequeno hoje (~571 clientes, ~31 rede); enriquecimento por boleto
  é viável com throttle. Escalar por consultor: rodar em fila, não paralelo
  pesado (Tor tem banda limitada).
- **LGPD**: dados de clientes de terceiros — manter isolamento por consultor e
  base legal (o consultor é o controlador da sua carteira).


---

## 7. STATUS DE IMPLEMENTAÇÃO (01/07/2026) — ✅ FEITO

### Backend / Worker
- **Worker green (`worker-igreen-sync` v16):** migrado para `api-vo`, login
  `/auth/session` (sem 2captcha), coleta via `page.evaluate` (passa Cloudflare).
  Novos endpoints: `/sync-customers`, `/sync-network`, `/sync-metrics`,
  `/sync-boletos`, `/sync-all` (+ enriquecimento por boleto).
- **Edge `sync-igreen-customers`:** novos modos `sync_all`, `sync_metrics`,
  `sync_boletos`; grava em `customers`, `network_members`,
  `igreen_consultant_metrics`, `igreen_customer_boletos`; aplica ficha detalhada
  (cpf/instalação/concessionária). Cron diário agora usa `sync_all`.

### Banco (migrations aplicadas)
- `igreen_consultant_metrics` — KPIs + rotinas por consultor/mês (RLS por dono).
- `igreen_customer_boletos` — boletos por cliente (RLS por dono).
- `customers` — novas colunas: `situacao_igreen`, `data_injecao_igreen`,
  `num_cliente_distribuidora`, `concessionaria`.
- Tabela `igreen_extension_tokens` **removida** (extensão descontinuada).

### Front-end
- Novo `src/lib/igreenSync.ts` (chama a edge) substitui `igreenExtensionBridge.ts`.
- `IGreenConnectionCard` (email+senha do iGreen + testar/sincronizar) substitui
  `IGreenExtensionCard`. Botões "Sincronizar" em NetworkPanel, DashboardTab e
  CustomerManager agora chamam a edge (modo `sync_all`).
- Extensão Chrome (`extension/`), bridge, card antigo, zip público e edges
  `igreen-ingest-xlsx`/`igreen-ingest-customers` **removidos**.
- `tsc --noEmit` e `vite build` → exit 0.

### Config individual por consultor
- Credenciais em `consultants.igreen_portal_email/password` (RLS + senha
  write-only). Tela: Admin → aba Dados → card "Conexão com o Escritório iGreen".
- Cron diário `sync-igreen-customers-daily` sincroniza todos automaticamente.

### Pendências para deploy
1. Rebuild do worker green no EasyPanel (imagem v16).
2. Deploy das edge functions (via GitHub Actions — ver `.kiro/steering/deploy.md`).
3. (Opcional) migrar senha do portal para criptografia em repouso.
