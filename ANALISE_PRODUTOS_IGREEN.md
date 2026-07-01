# Análise: captura de clientes por produto (iGreen)

Data: 01/07/2026 · Verificado ao vivo no portal (consultor 124170).

## Resposta direta: HOJE só pega ENERGIA

A implementação atual captura **apenas clientes de energia** (`/crm/green`).
Telecom e Seguros **não** estão sendo ingeridos como carteira. Confirmado no
código (`worker-igreen-sync` só chama `/crm/green`).

## O que existe no portal (testado)

| Produto | Endpoint carteira | Clientes (teste) | Capturado hoje? |
|---|---|---|---|
| **Energia (Green)** | `/crm/green` | 159 | ✅ Sim |
| **Telecom** | `/crm/telecom` + `/telecom/*` | 6 | ❌ Não |
| **Seguros** | `/crm/seguros` + `/seguros/*` | 5 | ❌ Não |
| **Expansão** | `/crm/expansao` | 10 (licenciados, não clientes) | parcial (é rede) |
| Placas / Solar / Livre / Club | — | **404 (sem CRM próprio)** | n/a |

**Conclusão sobre placas/solar/livre/club:** o portal novo **não expõe carteira
separada** para esses. "Placas", "Livre" e "Solar" são variações de energia
(entram na carteira Green); "Club" e "Club PJ" não têm endpoint de clientes.
Ou seja: não há o que capturar além de green + telecom + seguros.

## Estruturas (campos por produto)

**Telecom** (`/crm/telecom` → colunas: aguardando, portabilidade, ativado, cancelado):
```
id, cliente, cidade, uf, numero (linha), data, status(coluna)
```
Faturas (`/telecom/faturas`): idcnxtelecom, cliente, cidade, uf, licenciado,
valor, mesReferencia, status (pago/a_vencer/vencido).
Resumo (`/telecom/resumo-geral`): ativas, total, canceladas, portConfirmada,
portPendente, carteiraMensal.

**Seguros** (`/crm/seguros` → colunas: vigente, processando, cancelada, etc.):
```
id, segurado, modelo, placa, fipe, mensal, status(coluna)   ← seguro de veículo
```
Resumo (`/seguros/resumo-geral`): vigentes, total, canceladas, carteiraMensal.
Overview: kpis, geracao, topLicenciados.

## Onde gravar (a plataforma já suporta)

O catálogo `products` já tem: `conexao-telecom` (family telecom) e
`conexao-seguros` (family seguros). O modelo multiproduto usa `sales`
(venda de um produto por consultor) + `customers`.

**Decisão recomendada:** telecom e seguros têm dados bem diferentes de energia
(linha/portabilidade; apólice/placa/FIPE). Melhor **não** forçar em `customers`
(que é modelado para energia/WhatsApp). Opções:

- **Opção A (recomendada):** tabelas dedicadas `igreen_telecom_customers` e
  `igreen_seguros_customers` (espelho da carteira, RLS por consultor), + resumo
  em `igreen_consultant_metrics` (já grava clientesDetalhe green/telecom/seguros).
- **Opção B:** gravar como linhas em `sales` (family telecom/seguros) ligando ao
  catálogo `products`. Bom para visão de comissão, ruim para detalhe operacional.

## O que MAIS podemos fazer (além de capturar tudo)

1. **Carteira multiproduto por cliente:** cruzar telefone/nome para saber quais
   clientes têm mais de um produto (energia + telecom + seguros) → oportunidade
   de venda cruzada (cross-sell).
2. **Alertas financeiros multiproduto:** boleto de energia vencendo +
   fatura de telecom a vencer + seguro pendente → um só painel de cobrança.
3. **Painel "Minha Carteira" unificado:** total de clientes por produto,
   MRR (receita recorrente): energia (kWh), telecom (carteiraMensal), seguros
   (carteiraMensal) — o portal já dá `carteiraMensal` de telecom e seguros.
4. **Sugestão de cross-sell no bot:** cliente de energia validado sem telecom →
   bot oferece Telecom; sem seguro → oferece Seguros.
5. **Metas por produto:** telecom (portabilidades pendentes), seguros
   (primeira parcela pendente) viram tarefas/rotinas.
6. **Ranking de licenciados por produto** (`/telecom/licenciados`,
   `/seguros/licenciados`) — quem mais vende cada produto na rede.

## Recomendação de implementação (Fase 3 multiproduto)

1. Worker: adicionar `fetchTelecom()` (`/crm/telecom` + `/telecom/faturas`) e
   `fetchSeguros()` (`/crm/seguros`) ao `/sync-all`.
2. Edge: persistir em `igreen_telecom_customers` / `igreen_seguros_customers`
   (novas tabelas) e alimentar `clientes_telecom`/`clientes_seguros` em
   `igreen_consultant_metrics` (já existe).
3. Front: aba/cartões "Telecom" e "Seguros" na carteira, + cross-sell.


---

## STATUS (01/07/2026) — ✅ Opção A implementada

- **Migrations:** `igreen_telecom_customers` e `igreen_seguros_customers`
  (RLS por dono, escrita só service_role).
- **Worker (v16+):** `fetchTelecom()` (`/crm/telecom` + `/telecom/faturas`) e
  `fetchSeguros()` (`/crm/seguros`); novos endpoints `/sync-telecom`,
  `/sync-seguros`, e incluídos no `/sync-all`.
- **Edge:** `persistTelecom()` / `persistSeguros()` gravam as tabelas; modos
  `sync_telecom`/`sync_seguros` e integrados ao `sync_all` (cron diário pega tudo).
- **Front:** `multiprodutoHooks.ts` + `MultiprodutoCard` (contagem por status +
  receita mensal recorrente) no topo do painel de Acompanhamento.
- `tsc --noEmit` e `vite build` → exit 0.

Cross-sell no bot (energia → oferecer telecom/seguros) fica como próximo passo
opcional, quando você quiser ativar disparo proativo.
