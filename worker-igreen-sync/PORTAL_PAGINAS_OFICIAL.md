# Mapa Oficial das Páginas do Portal iGreen (Virtual Office)

> Mapeado AO VIVO em 2026-07-06, logado como Rafael Ferreira (id 124170),
> via proxy residencial Evomi (Brasil) + login API-first do worker.
> Este documento diz, PÁGINA POR PÁGINA, o que cada tela mostra e QUAIS
> endpoints da API ela consome. É o mapa definitivo — não confundir.
>
> Complementa o `PORTAL_ENDPOINTS_OFICIAL.md` (detalhe de parâmetros/campos).
>
> **Base da API:** `https://api-vo.igreenenergy.com.br/v1`
> **Domínios de tela:** `escritorio.igreenenergy.com.br` (login + área green)
> e `vo.igreenenergy.com.br` (SPA nova: telecom, seguros, rede, financeiro…).
> Ambos protegidos por **Cloudflare** (exige IP residencial BR + sessão fixa).

---

## Regra de ouro (como capturar sem travar)

1. **Login é API-first:** abrir a página de login só serve para pegar o
   `cf_clearance` do Cloudflare; o login em si é `POST /auth/session`.
   NÃO depender da SPA (React) renderizar o formulário — os bundles JS pesados
   do domínio `vo` caem de vez em quando pelo proxy e travam a tela.
2. **Proxy com sessão fixa (sticky):** o Cloudflare amarra a liberação a UM IP.
   Usar `_session-XXXX` (≤15 chars) na senha do proxy para manter o mesmo IP.
3. **Depois do login, chamar os endpoints direto** com `Authorization: Bearer <token>`
   de dentro da página (herda o cf_clearance). É leve e estável.

---

## PÁGINA: Painel  (`/painel` — escritorio e vo)

Visão geral do consultor: produção, pontos bonificáveis, clientes ativos,
eventos, licenças a vencer e gráficos de crescimento.

| Endpoint | Retorna (chaves reais) |
|----------|------------------------|
| `GET /painel/producao` | bonificavelGp, bonificavelGi, qualificavel, bonusPrevia, clientesAtivos, clientesDetalhe{green,telecom,livre,seguros}, diretosAtivos |
| `GET /painel/eventos` | evento, confirmados, checkins, ingressosVendidos, valorVendido, semIngresso |
| `GET /painel/licencas-expirando` | total, counts{aVencer,vencida,expirada}, grads[], items[] |
| `GET /dashboard/daily-analysis` | array — série diária de clientes (day, month, totalcustomer) |
| `GET /dashboard/customers-by-region` | array — clientes por região (regiao, totalcustomer) |
| `GET /consultant` | idconsultor, nome, email, cpf, cnpj, graduacao |

---

## PÁGINA: Clientes Green  (`/clientes-green` — escritorio)

Carteira de energia (green). É a área mais importante para o sync de clientes.

| Endpoint | Retorna |
|----------|---------|
| `GET /clientes-green/overview?mes=YYYY-MM` | mes, resumo{totalCadastros,mwh}, funil, licenciadosComCadastro, aniversariantesHoje, kwhValidados, **cadastrosPorDia[]**, grafico, topCidades, recentes |
| `GET /clientes-green/cadastros?dia=YYYY-MM-DD&status=todos&page=1&perPage=100` | **FONTE COMPLETA de clientes** (varrer por dia). items[], total, counts{todos,validado,aguardando,devolutiva,assinatura,cancelado,reprovado} |
| `GET /clientes-green/financeiro` | emProducao, pagos, disponivel, vencidosTotal, injecao{com,sem,kwhTotal} |
| `GET /clientes-green/cidades?periodo=geral&sort=total` | total, crescendo, resumo{cadastros,ativos}, items[] (por cidade) |
| `GET /clientes-green/licenciados?periodo=geral&sort=total&faixa=todos&page=1&perPage=100` | total, resumo{cadastros,validados,mwh}, items[] (rede green) |
| `GET /clientes-green/devolutivas?categoria=todos&page=1&perPage=100` | items[]{codigo,nome,cidade,uf,licenciado,motivo,categoria}, total |
| `GET /clientes-green/boletos?status=todos&injecao=todos&tipo=todos&page=1&perPage=100` | items[] (boletos por cliente), total |
| `GET /crm/green` | array de 9 colunas Kanban (COMPLEMENTO — trunca colunas grandes, não usar como fonte única) |

> ⚠️ Ver `PORTAL_ENDPOINTS_OFICIAL.md`: a fonte 100% dos clientes é a varredura
> `cadastros?dia=`, NÃO o `/crm/green` (que só traz ~159 de 571).

---

## PÁGINA: Produtos / Telecom  (`/produtos/telecom` — vo)

Carteira de telefonia (chips/portabilidade).

| Endpoint | Retorna |
|----------|---------|
| `GET /telecom/resumo-mes?mes=YYYY-MM` | mes, novas, portabConfirmada, portabPendente, semPortab, canceladas, licenciados |
| `GET /telecom/cadastros?dia=YYYY-MM-DD&status=todos&page=1&perPage=100` | **FONTE COMPLETA telecom** (varrer por dia). items[], total, counts{sem,pendente,confirmada} |
| `GET /telecom/faturas?status=todos&page=1&perPage=100` | items[]{idcnxtelecom,numero,cliente,cidade,uf,licenciado,valor,mesReferencia,status}, total |
| `GET /telecom/pendencias?tipo=todos&page=1&perPage=100` | items[]{idcnxtelecom,numero,cliente,tipo,motivo…}, total, counts |
| `GET /telecom/financeiro` | pago{n,valor}, aVencer{n,valor}, vencido{n,valor}, topInadimplentes[] |
| `GET /telecom/cidades?periodo=geral&sort=total` | total, resumo{conexoes,novas}, items[] |
| `GET /telecom/licenciados?periodo=geral&sort=total&faixa=todos&page=1&perPage=100` | total, resumo{conexoes,novas}, items[] |
| `GET /crm/telecom` | array de 4 colunas Kanban telecom (COMPLEMENTO — trunca) |

---

## PÁGINA: Seguros  (`/seguros` — vo)

Carteira de seguros (apólices/cotações).

| Endpoint | Retorna |
|----------|---------|
| `GET /seguros/overview` | kpis{apolicesVigentes,novasMes,cotacoes,pagas,totalEquipe}, geracao{propria,indireta}, topLicenciados[] |
| `GET /seguros/cadastros?dia=YYYY-MM-DD&page=1&perPage=100` | **FONTE COMPLETA seguros** (varrer por dia). ⚠️ Deu HTTP 500 em dia vazio no teste — tratar erro e seguir para o próximo dia (não abortar o sync). |
| `GET /seguros/pendencias?tipo=todos&page=1&perPage=100` | items[]{id,cliente,licenciado,status,mensal,data}, total, counts |
| `GET /seguros/financeiro` | carteiraMensal, vigentes, primeiraPaga{n,valor}, primeiraPendente{n,valor} |
| `GET /seguros/cidades?periodo=geral&sort=total` | total, resumo{vigentes,novas}, items[] |
| `GET /seguros/licenciados?periodo=geral&sort=total&faixa=todos&page=1&perPage=100` | total, resumo{vigentes,novas}, items[] |
| `GET /crm/seguros` | array de 6 colunas Kanban seguros (COMPLEMENTO — trunca) |

---

## PÁGINA: Rotinas  (`/rotinas` — vo)

Tarefas/indicadores de acompanhamento (diária, semanal, mensal).

| Endpoint | Retorna |
|----------|---------|
| `GET /rotinas/diaria` | aniversariantes, novosDia, engajados, primeiroBoleto, vencendoHoje, inad1, inad30, inad60, novasDevolutivas |
| `GET /rotinas/semanal` | topPerformance, pro, avancos, novosSemAtivacao, esfriando, reeng30, reeng60, reeng90 |
| `GET /rotinas/mensal` | licencasVencendo, mesesProTotal, novosClientesMes, novosClientesPrev, novosLicenciadosMes, proMes, avancosMes |
| `GET /rotinas/devolutivas-novas` | items[]{iddevolutiva,cliente,cidade,uf,campo,obs,impeditiva,data}, total |

---

## PÁGINA: CRM  (`/crm` — vo)

Kanban unificado dos 3 produtos (arrastar cards por estágio).

| Endpoint | Retorna |
|----------|---------|
| `GET /crm/green` | array 9 colunas: aguardando_assinatura, aguardando, devolutiva, reprovado, validado, adimplente, menos_30d, inadimplente, cancelado. Card: codigo, nome, cidade, uf, kwh, distribuidora, fornecedora, celular, data, devolutiva, atraso, diasAtraso |
| `GET /crm/telecom` | array 4 colunas: aguardando, portabilidade, … |
| `GET /crm/seguros` | array 6 colunas: cotacao, vistoria, … |

> ⚠️ Kanban trunca colunas grandes — bom para status financeiro/estágio, mas a
> lista completa vem dos `cadastros?dia=`.

---

## PÁGINA: Mapa da Rede  (`/mapa-rede` — vo)

Downline completa do consultor (quem está abaixo dele na rede).

| Endpoint | Retorna |
|----------|---------|
| `GET /network-map/data?month=YYYY-MM` | array de membros (30 campos): nivel, idconsultor, nome, celular, cidade, uf, gp, gi, bonificavel, qualificavel, dataAtivo, graduacao, licenciadosDiretos, clientesAtivos, greenPointsNoMes, … |
| `GET /network-map/head?month=YYYY-MM` | root{...} — cabeça da rede (o próprio consultor). **`month` é obrigatório** (sem ele: 400). |

---

## PÁGINA: Extrato de Pontos  (`/extrato-pontos` — vo)

Extrato de kWh / green points por cliente.

| Endpoint | Retorna |
|----------|---------|
| `GET /extrato-kwh/gp/{idconsultor}` | array por cliente: codigoCliente, nomeCliente, kwhContratado, kwhGerado, statusKwh, devolutiva, andamento |

---

## PÁGINA: Financeiro  (`/financeiro` — vo)

Resumo financeiro do licenciado.

| Endpoint | Retorna |
|----------|---------|
| `GET /financeiro-licenciado/resumo` | ⚠️ Deu HTTP 500 no teste (erro interno da API, não do worker). Tratar com retry/tolerância; pode variar por consultor. |
| `GET /clientes-green/financeiro` | (fallback usado nesta tela) emProducao, pagos, disponivel, vencidosTotal, injecao |

---

## PÁGINAS DE CARREIRA: Pré-Sênior, Pro Maker, Rede Líder

`/pre-senior`, `/pro-maker`, `/rede-lider` (vo).

**Não possuem endpoint de dados dedicado na API.** Testados vários caminhos
(`/graduacao/*`, `/carreira/*`, `/qualificacao/*`, `/metas/*`, `/painel/*`) —
**todos retornam 404**. São telas de **conteúdo de carreira/metas** montadas a
partir dos dados que já vêm de:

- `GET /painel/producao` (pontos bonificáveis/qualificáveis, diretos ativos)
- `GET /consultant` (graduação atual)
- `GET /rotinas/mensal` (meses PRO, avanços)

Ou seja: para exibir progresso de carreira, usar esses três endpoints — não há
rota específica por nível.

---

## Resumo rápido: qual endpoint alimenta cada página

| Página | Endpoints-chave |
|--------|-----------------|
| Painel | `/painel/producao`, `/painel/eventos`, `/painel/licencas-expirando`, `/dashboard/daily-analysis`, `/dashboard/customers-by-region`, `/consultant` |
| Clientes Green | `/clientes-green/{overview,cadastros,financeiro,cidades,licenciados,devolutivas,boletos}`, `/crm/green` |
| Telecom | `/telecom/{resumo-mes,cadastros,faturas,pendencias,financeiro,cidades,licenciados}`, `/crm/telecom` |
| Seguros | `/seguros/{overview,cadastros,pendencias,financeiro,cidades,licenciados}`, `/crm/seguros` |
| Rotinas | `/rotinas/{diaria,semanal,mensal,devolutivas-novas}` |
| CRM | `/crm/{green,telecom,seguros}` |
| Mapa Rede | `/network-map/{data,head}?month=` |
| Extrato Pontos | `/extrato-kwh/gp/{idconsultor}` |
| Financeiro | `/financeiro-licenciado/resumo` (+ `/clientes-green/financeiro`) |
| Pré-Sênior / Pro Maker / Rede Líder | (sem rota própria) `/painel/producao` + `/consultant` + `/rotinas/mensal` |

---

## Erros/observações registrados no mapeamento (2026-07-06)

- `/seguros/cadastros?dia=` → **500** em dia sem cadastro. Não abortar o sync;
  tratar como "dia vazio" e continuar.
- `/financeiro-licenciado/resumo` → **500** (erro interno da API). Reintentar.
- `/network-map/head` → exige `month=YYYY-MM` (sem ele, 400).
- Páginas de carreira → sem endpoint (404 em todos os caminhos testados).
