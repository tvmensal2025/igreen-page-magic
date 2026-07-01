# Auditoria iGreen — o que capturamos hoje e o que ainda falta

## Contexto

Tentei logar no `escritorio.igreenenergy.com.br` daqui para varrer os endpoints ao vivo, mas o Cloudflare bloqueou o IP do sandbox (é justamente por isso que o `worker-igreen-sync` roda com Tor na VPS). A auditoria abaixo cruza o **código real** do worker/edge (fonte da verdade do que sincronizamos) com os relatórios `ANALISE_GAPS_PLATAFORMA.md` e `ANALISE_PRODUTOS_IGREEN.md`. O que precisa de olho no portal ao vivo eu proponho fazer via job dedicado no próprio worker Tor (item 6).

## Situação atual da captura (por área)


| Área                                  | Endpoint(s) portal                                                              | Capturado?                   | Onde grava                           |
| ------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------ |
| Clientes energia                      | `/crm/green`                                                                    | ✅                            | `customers` + `igreen_customer_*`    |
| Rede                                  | `/network-map/data?month=`                                                      | ✅                            | `igreen_network_members`             |
| Painel/rotinas                        | `/painel/*`, `/rotinas/{diaria,semanal,mensal}`, `/clientes-green/resumo-geral` | ✅ (raw)                      | `igreen_consultant_metrics.raw_json` |
| Boletos energia                       | `/clientes-green/boletos` + `/clientes-green/boletos/{id}`                      | ✅                            | `igreen_customer_boletos`            |
| Devolutivas                           | `/rotinas/devolutivas-novas`, `/clientes-green/devolutivas`                     | ✅                            | `igreen_customer_devolutivas`        |
| Cashback                              | `/cashback/resumo?origem=GREEN|TELECOM|SEGUROS`                                 | ✅ (colunas + json)           | `igreen_consultant_metrics`          |
| Telecom                               | `/crm/telecom` + `/telecom/faturas`                                             | ✅                            | `igreen_telecom_customers`           |
| Seguros                               | `/crm/seguros`                                                                  | ✅                            | `igreen_seguros_customers`           |
| Licenças expirando                    | `/painel/licencas-expirando`                                                    | ⚠️ só via `overview.alertas` | falta alerta acionável               |
| Cross-sell energia→telecom/seguros    | (derivado)                                                                      | ❌                            | não implementado                     |
| Pro-builder / análises                | `/pro-builder`, `/analise-pro/summary`, `/analise-retencao/summary`             | ❌                            | —                                    |
| Docs do cliente (RG, conta, contrato) | não expostos pela API                                                           | 🚫 confirmado 404            | n/a                                  |
| Extrato financeiro do consultor       | não existe endpoint                                                             | 🚫                           | n/a                                  |


Conclusão: **todos os endpoints com dado útil já estão sendo puxados**. O que resta são melhorias de **uso** (alertas, cross-sell, tarefas) e áreas Pro/análises que ainda não subimos.

## Plano proposto

### 1. Sanity check ao vivo (via worker Tor, sem tocar código)

- Rodar `POST /sync-all` no `worker-igreen-sync` de produção com a conta `rafael.ids@icloud.com` e comparar o retorno com a última linha em `igreen_consultant_metrics.raw_json`.
- Ler `/last-debug` do worker para confirmar que não há 403/429 nas rotas ativas.
- Objetivo: provar que nenhum endpoint atual está silenciosamente falhando.

### 2. Probe de descoberta de novos endpoints

- Adicionar um handler `POST /probe-endpoints` no worker (Tor + sessão logada) que testa uma allowlist de rotas candidatas (`/pro-builder`, `/analise-pro/summary`, `/analise-retencao/summary`, `/estatisticas-pro`, `/painel/licencas-expirando`, `/telecom/resumo-geral`, `/seguros/resumo-geral`, `/telecom/licenciados`, `/seguros/licenciados`).
- Retorna `{path, status, shape}` para cada.
- Roda uma vez por consultor Super Admin; resultado vai para um novo `.tmp/igreen-endpoint-map.json`.

### 3. Alerta de licença expirando (item aberto do gap doc)

- Nova coluna toggle `alert_licencas_expirando` já existe em `igreen_automation_settings`.
- Falta o job: edge `igreen-licencas-alerts` que lê `raw_json.alertas.licencas` (ou o novo `/painel/licencas-expirando` se o probe do item 2 confirmar) e cria itens em `bot_handoff_alerts` (prioriza `vencida > aVencer`).

### 4. Cross-sell energia → telecom/seguros no bot

- Novo helper `_shared/xsell/igreen-multiprod.ts`: cruza telefone do lead com `igreen_telecom_customers`/`igreen_seguros_customers` do mesmo consultor.
- No `pos-venda-auto-progress`, quando lead chega em `pv_aprovado` sem produto telecom, engata ramo opcional de oferta (usa mídia default se existir; senão texto neutro).
- Toggle: `cross_sell_bot` (já existe).

### 5. Ingestão Pro-builder / análises (só se probe confirmar payload útil)

- Se o item 2 mostrar dados úteis, adicionar `fetchProAnalytics()` ao worker e uma tabela `igreen_pro_metrics` (JSON por mês). Prioridade baixa.

### 6. Documentação

- Atualizar `ANALISE_GAPS_PLATAFORMA.md` marcando os itens que já foram fechados desde a última auditoria (devolutivas, cashback, boletos, multiproduto).
- Adicionar seção "verificado ao vivo em 01/07/2026 pela conta rafael.ids".

## Escopo técnico resumido

- Sem migrações destrutivas. Apenas `ALTER TABLE ADD COLUMN IF NOT EXISTS` em `igreen_consultant_metrics` (caso item 2 traga novos campos) e nova tabela opcional `igreen_pro_metrics` (RLS por dono, GRANT padrão).
- Sem mudanças no frontend nesta rodada (só backend + docs). Painel do consultor já mostra tudo que capturamos.
- Zero risco de quebrar fluxo D / CEMIG: nenhum toque em `_shared/engine/*` nem em webhooks.

## Perguntas antes de executar

1. Posso avançar com **todos os 6 itens**, ou você quer priorizar só o sanity check + alerta de licença (rápido, 1 dia) e deixar cross-sell/Pro-builder para depois? FACA TUDO, MAS ANALISE O CODIGO PARA NAO QUEBRAR
2. &nbsp;
3. O cross-sell (item 4) deve disparar automaticamente ao aprovar, ou só marcar oportunidade no CRM para o consultor decidir enviar? O CONSULTOR ENVIAR, SEM AUTOMATICO, IREMOS TESTAR FUTURAMENTE AJUSTAMOS