# Catálogo Oficial de Endpoints — Portal iGreen (api-vo)

> Mapeado AO VIVO via Playwright (Chrome headed, login real) em 2026-07-06.
> Este é o mapa definitivo. Sempre buscar por estes endpoints e parâmetros.
> Base: `https://api-vo.igreenenergy.com.br/v1`

---

## ⚠️ DESCOBERTA CRÍTICA — por que o sync não pegava tudo

O worker antigo coletava clientes via **`/crm/green`** (Kanban). Testado ao vivo:

| Fonte | Clientes retornados |
|-------|--------------------|
| `/crm/green` (Kanban) | **159** ❌ |
| Total real da carteira (`resumo.cadastros`) | **571** ✅ |

O Kanban `/crm/green`:
1. **Trunca colunas grandes** — a coluna `reprovado` declara `qtd=72` mas só entrega 60 cards. Não aceita paginação (`page`/`perPage`/`status` são ignorados).
2. **Só mostra ~171 clientes diretos** — não traz a carteira histórica completa.

**Solução comprovada:** varrer **`/clientes-green/cadastros?dia=YYYY-MM-DD`** dia-a-dia
recupera **exatamente 571 clientes únicos** (100%), casando com o total oficial.

Distribuição real por status (571): reprovado 286, validado 208, assinatura 64,
cancelado 7, devolutiva 5, aguardando 1.

---

## FONTE PRINCIPAL DE CLIENTES (green) — 100%

### `/clientes-green/cadastros?dia=YYYY-MM-DD&status=todos&search=&page=1&perPage=100`
- **Parâmetro `dia` é OBRIGATÓRIO** (formato `YYYY-MM-DD`). `mes=` e ranges (`de/ate`, `inicio/fim`) dão **400**.
- Para pegar TUDO: varrer dia-a-dia desde a data de ativação do consultor até hoje.
- Pagina dentro do dia com `page`/`perPage` (máx 100) caso um dia tenha >100 cadastros.
- Resposta: `{ data: { items: [...], total, counts: {todos,validado,aguardando,devolutiva,assinatura,cancelado,reprovado} } }`
- **Não trunca** (diferente do Kanban).

> Otimização: usar `/clientes-green/overview?mes=YYYY-MM` → `cadastrosPorDia[]` para
> saber quais dias têm cadastro e pular dias vazios (reduz nº de requests).

### `/crm/green` (Kanban — usar só como COMPLEMENTO, não como fonte única)
- Retorna colunas `[{id,label,qtd,kwh,cards:[...]}]`. Colunas: aguardando_assinatura,
  aguardando, devolutiva, reprovado, validado, adimplente, menos_30d, inadimplente, cancelado.
- Card: `{codigo,nome,cidade,uf,kwh,distribuidora,fornecedora,celular,data,devolutiva,atraso,diasAtraso}`.
- **Trunca colunas grandes.** Bom para status financeiro (adimplente/menos_30d/inadimplente)
  que o `cadastros` não separa, mas NÃO é a fonte completa.

---

## CLIENTES GREEN — demais endpoints

| Endpoint | Params | Retorna |
|----------|--------|---------|
| `/clientes-green/boletos` | `status=todos&injecao=todos&tipo=todos&search=&page=N&perPage=100` | Boletos por cliente (paginado, `total`). Item: idcliente, nome, cidade, uf, licenciado, total, valorFornecedora, valorDistribuidora, vencimento, mesReferencia, status, diasAtraso, injecao, kwhCompensado, contaUnica, fornecedora, tipoPagamento, urlinvoice, urlboleto, direto |
| `/clientes-green/boletos/{idcliente}` | — | Ficha detalhada do cliente (cpf, instalacao, concessionaria, dataAtivo, situacao) |
| `/clientes-green/devolutivas` | `categoria=todos&search=&page=N&perPage=100` | Devolutivas por cliente. Item: codigo, nome, cidade, uf, licenciado, motivo, categoria. (`total` presente) |
| `/clientes-green/devolutivas/resumo` | `search=` | Resumo agregado de devolutivas |
| `/clientes-green/devolutivas-resolvidas` | — | Devolutivas já resolvidas |
| `/clientes-green/licenciados` | `periodo=geral&sort=total&faixa=todos&search=&page=N&perPage=100` | **Licenciados da rede green + resumo total.** `data.resumo = {cadastros:571, validados:208, mwh}`. Item: idLicenciado, nome, cidade, uf, graduacao, graduacaoExpansao, total, kwh, assin{n,kwh}, valid, aguard, devol, cancel, reprov. **periodo=geral obrigatório p/ histórico; sort∈{crescimento,total,validados}; faixa∈{todos,1-4,5-9,10-19,20+}** |
| `/clientes-green/cidades` | `periodo=geral&sort=total&search=` | Clientes por cidade (64). Item: cidade, uf, total, ativos, licenc, aguard, devol, cancel, reprov |
| `/clientes-green/overview` | `mes=YYYY-MM` | Funil do mês: resumo{totalCadastros,mwh}, funil{validados,aguardando,devolutivas,agAssinatura,reprovados,cancelados,comEnergia}, cadastrosPorDia[], aniversariantesHoje |
| `/clientes-green/financeiro` | — | `{emProducao, pagos, disponivel, vencidosTotal, injecao{com,sem,kwhTotal}}` |

---

## TELECOM

| Endpoint | Params | Retorna |
|----------|--------|---------|
| `/crm/telecom` | — | Kanban telecom (mesma limitação do green — trunca) |
| `/telecom/cadastros` | `dia=YYYY-MM-DD&status=todos&search=&page=N&perPage=100` | **Fonte completa** (varrer por dia igual green). `dia` obrigatório |
| `/telecom/faturas` | `status=todos&search=&page=N&perPage=100` | Faturas. Item: idcnxtelecom, numero, cliente, cidade, uf, licenciado, valor, mesReferencia, status. (`total`) |
| `/telecom/pendencias` | `tipo=todos&search=&page=N&perPage=100` | Pendências. Item: idcnxtelecom, numero, cliente, cidade, uf, licenciado, tipo, motivo, data. (`total`) |
| `/telecom/licenciados` | `periodo=geral&sort=total&faixa=todos&search=&page=N&perPage=100` | Licenciados telecom + resumo{conexoes,novas}. Item: idLicenciado, nome, cidade, uf, total, ativas, pendentes, portab, confirmadas, canceladas |
| `/telecom/cidades` | `periodo=geral&sort=total&search=` | Telecom por cidade |
| `/telecom/resumo-mes` | `mes=YYYY-MM` | `{mes,novas,portabConfirmada,portabPendente,semPortab,canceladas,licenciados}` |
| `/telecom/financeiro` | — | Resumo financeiro telecom |

---

## SEGUROS

| Endpoint | Params | Retorna |
|----------|--------|---------|
| `/crm/seguros` | — | Kanban seguros (trunca) |
| `/seguros/cadastros` | `dia=YYYY-MM-DD&search=&page=N&perPage=100` | **Fonte completa** (varrer por dia). `dia` obrigatório |
| `/seguros/pendencias` | `tipo=todos&search=&page=N&perPage=100` | Pendências. Item: id, cliente, licenciado, status, mensal, data. (`total`) |
| `/seguros/licenciados` | `periodo=geral&sort=total&faixa=todos&search=&page=N&perPage=100` | Licenciados seguros + resumo{vigentes,novas}. Item: idLicenciado, nome, cidade, uf, total, vigentes, processando, canceladas, cotacoes, pagas |
| `/seguros/cidades` | `periodo=geral&sort=total&search=` | Seguros por cidade |
| `/seguros/overview` | — | `kpis{apolicesVigentes,novasMes,cotacoes,pagas,totalEquipe}`, geracao{propria,indireta}, topLicenciados[] |
| `/seguros/financeiro` | — | Resumo financeiro seguros |

---

## REDE / PAINEL / ROTINAS / MÉTRICAS

| Endpoint | Params | Retorna |
|----------|--------|---------|
| `/network-map/data` | `month=YYYY-MM` | **Rede completa (downline).** 30 campos por membro: nivel, idconsultor, nome, celular, cidade, uf, gp, gi, bonificavel, qualificavel, dataAtivo, graduacao, graduacaoExpansao, licenciadosDiretos, licenciadosDiretosAtivos, clientesAtivos, diretosPro, pro, patrocinador, devolutivas, agValid, greenPointsNoMes, greenPointsAnual, gpMes, giMes, greenTelecomMes, livreMes, placasMes, clubMes, expansaoMes |
| `/network-map/head` | — | Cabeça da rede (consultor) |
| `/painel/producao` | — | Produção |
| `/painel/eventos` | — | Eventos |
| `/painel/licencas-expirando` | (varia — deu 400 sem params certos; investigar) | Licenças expirando |
| `/rotinas/diaria` | — | Rotina diária (tarefas) |
| `/rotinas/semanal` | — | Rotina semanal |
| `/rotinas/mensal` | — | Rotina mensal |
| `/dashboard/daily-analysis` | — | Análise diária (187 pontos) |
| `/dashboard/customers-by-region` | — | Clientes por região (23) |
| `/extrato-kwh/gp/{idconsultor}` | — | Extrato kWh de green points (116 itens) |
| `/financeiro-licenciado/resumo` | — | Resumo financeiro do licenciado |
| `/consultant` | — | Dados do consultor logado |
| `/consultant/activation-code` | — | Código de ativação |

---

## REGRAS DE PARÂMETROS (validadas via erros 400 da API)

- **`cadastros`** (green/telecom/seguros): exige `dia=YYYY-MM-DD`. Não aceita `mes` nem range.
- **`licenciados`**: `periodo ∈ {mes, geral}`, `sort ∈ {crescimento, total, validados}`, `faixa ∈ {todos, 1-4, 5-9, 10-19, 20+}`. Use `periodo=geral` para histórico total.
- **`cidades`**: `periodo ∈ {mes, geral}`, `sort` idem. Use `periodo=geral`.
- **`perPage` máximo = 100.** Valores maiores retornam no máx 100.
- Listas paginadas trazem `data.total` — usar para saber quando parar.

---

## ESTRATÉGIA DE COLETA 100% (resumo para o worker)

1. **Clientes green**: `/clientes-green/overview?mes=X` para achar dias com cadastro,
   depois varrer `/clientes-green/cadastros?dia=X` (todos os meses desde a ativação).
   Complementar com `/crm/green` para status financeiro (adimplente/inadimplente).
2. **Boletos**: `/clientes-green/boletos` paginado.
3. **Devolutivas**: `/clientes-green/devolutivas` + `/rotinas/devolutivas-novas`.
4. **Telecom**: varrer `/telecom/cadastros?dia=X` + `/telecom/faturas` + `/telecom/pendencias`.
5. **Seguros**: varrer `/seguros/cadastros?dia=X` + `/seguros/pendencias`.
6. **Rede**: `/network-map/data?month=X` (12 meses de histórico).
7. **Licenciados**: `/clientes-green|telecom|seguros/licenciados?periodo=geral`.
8. **Métricas**: painel/rotinas/overviews/financeiro.
