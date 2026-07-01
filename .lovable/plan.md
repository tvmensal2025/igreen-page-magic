## Diagnóstico

O worker no Easypanel (`worker-igreen-sync/server.mjs`) **já sabe puxar tudo o que o portal expõe hoje**. Endpoints ativos no `/sync-all` (1 login por consultor):


| Área                                                                          | Endpoint                                                                                                                           | Worker             | Edge grava em                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------- |
| Clientes (Kanban: aguardando/validado/**devolutiva**/**reprovado**/cancelado) | `/crm/green`                                                                                                                       | `fetchCustomers`   | `customers` + `igreen_customer_*` |
| Rede                                                                          | `/network-map/data`                                                                                                                | `fetchNetwork`     | `network_members`                 |
| Painel + rotinas                                                              | `/painel/{overview,producao}` · `/rotinas/{diaria,semanal,mensal}` · `/clientes-green/resumo-geral` · `/painel/licencas-expirando` | `fetchMetrics`     | `igreen_consultant_metrics`       |
| Boletos                                                                       | `/clientes-green/boletos` (+ detalhe por id)                                                                                       | `fetchBoletos`     | `igreen_customer_boletos`         |
| Telecom                                                                       | `/crm/telecom` + `/telecom/faturas`                                                                                                | `fetchTelecom`     | `igreen_telecom_customers`        |
| Seguros                                                                       | `/crm/seguros`                                                                                                                     | `fetchSeguros`     | `igreen_seguros_customers`        |
| Devolutivas ricas                                                             | `/rotinas/devolutivas-novas` + `/clientes-green/devolutivas`                                                                       | `fetchDevolutivas` | `igreen_customer_devolutivas`     |
| Cashback                                                                      | `/cashback/resumo?origem=GREEN                                                                                                     | TELECOM            | SEGUROS`                          |


**Reprovado/Devolutiva já vêm** no `/crm/green`: cada card traz `status_coluna` (`validado`, `devolutiva`, `reprovado`, `cancelado`…) e o campo `devolutiva` texto, mapeados em `persistCustomers` → `customers.status_coluna` + `customers.devolutiva`.

## Onde está o gargalo

Toda a tabela `igreen_automation_settings` tem `DEFAULT false`. A edge `sync-igreen-customers` só chama os `persist*` quando o toggle correspondente está ligado. Consultor novo entra e o sync grava **só clientes + rede + métricas**; boletos, devolutivas ricas, telecom, seguros, cashback e alertas ficam de fora até alguém abrir o card "Automações iGreen" e ativar manualmente. É esse "não puxa tudo" que você está sentindo.

Além disso vi 3 pontos operacionais menores:

1. Log do Easypanel que você mandou mostra `[warn] The current consensus has no exit nodes` no Tor. Se persistir, os fetches saem por circuito interno e caem em 403/timeout. Precisamos um health-check periódico que reinicie o container quando o Tor não tiver saídas.
2. Se o toggle `capture_boletos` estiver desligado mas `alert_boletos_vencendo` ligado, a edge tenta gerar alerta sem dado — vira ruído. Precisamos amarrar o alerta ao respectivo capture (auto-enable).
3. O `probe-endpoints` do worker já lista rotas Pro (`/pro-builder`, `/analise-pro/summary`, `/analise-retencao/summary`, `/telecom/resumo-geral`, `/seguros/resumo-geral`, `/telecom/licenciados`, `/seguros/licenciados`), mas nunca foi disparado em produção. Sem esse retorno não dá para saber se compensa gravar dados Pro.

## O que vou fazer

### 1. Ligar captura completa por padrão (sem quebrar quem já configurou)

Migração aditiva: mudar o `DEFAULT` das colunas de **captura** e **alertas** para `true` e fazer um `UPDATE` seletivo só nas linhas onde **todos** os toggles de captura ainda estão `false` (indica consultor que nunca abriu a tela). Quem já mexeu mantém a escolha.

```sql
ALTER TABLE public.igreen_automation_settings
  ALTER COLUMN capture_boletos SET DEFAULT true,
  ALTER COLUMN capture_devolutivas SET DEFAULT true,
  ALTER COLUMN capture_telecom SET DEFAULT true,
  ALTER COLUMN capture_seguros SET DEFAULT true,
  ALTER COLUMN capture_cashback SET DEFAULT true,
  ALTER COLUMN alert_boletos_vencendo SET DEFAULT true,
  ALTER COLUMN alert_devolutivas SET DEFAULT true,
  ALTER COLUMN alert_licencas_expirando SET DEFAULT true;

UPDATE public.igreen_automation_settings
   SET capture_boletos=true, capture_devolutivas=true, capture_telecom=true,
       capture_seguros=true, capture_cashback=true,
       alert_boletos_vencendo=true, alert_devolutivas=true, alert_licencas_expirando=true
 WHERE capture_boletos=false AND capture_devolutivas=false AND capture_telecom=false
   AND capture_seguros=false AND capture_cashback=false;
```

Automação proativa no WhatsApp (`auto_wa_*`, `cross_sell_bot`) **permanece false** — nada dispara para cliente sem você mandar.

### 2. Fallback na edge: se não existir linha em `igreen_automation_settings`, tratar como "tudo ligado" para captura

Hoje se a linha não existe, `toggles = {}` e nada é gravado. Vou trocar o default in-code para `{ capture_*: true, alert_*: true, auto_wa_*: false, cross_sell_bot: false }` para eliminar a corrida entre criar o consultor e configurar toggles.

### 3. Consistência captura↔alerta

Na edge, se `alert_X` estiver on e `capture_X` off, forçar `capture_X = true` para aquela rodada (log em `raw_json._auto_enabled`). Sem migração destrutiva.

### 4. Health-check do Tor no worker

Adicionar rota `GET /health` já retornar `tor_exits: number` (parseando o log de bootstrap). No `sync-all`, se `apiGet` cair em 403/timeout duas vezes seguidas com Tor sem exits, retornar `error_code: "tor_no_exits"` para a edge marcar o run como transient (não spammar alerta).

### 5. UI: card "Automações iGreen"

Atualizar o texto de topo para "Tudo começa **ligado** para captura. Automações que enviam mensagem ao cliente continuam desligadas." e destacar visualmente o grupo "Captura de dados" como já ativo. Sem mudança de lógica além do label.

### 6. Rodar `probe-endpoints` uma vez em produção

Documentar o `curl` no `.tmp/igreen-endpoint-map.json` para termos a resposta real das rotas Pro. Se algum devolver payload útil, entra em issue separada — **não** promete ingestão nesta rodada (evita quebrar o `sync-all`).

## Arquivos afetados

- `supabase/migrations/<novo>_igreen_defaults_on.sql` — migração aditiva acima.
- `supabase/functions/sync-igreen-customers/index.ts` — defaults in-code (item 2) + auto-enable captura quando alerta (item 3).
- `worker-igreen-sync/server.mjs` — health-check com `tor_exits` e classificação `tor_no_exits` (item 4).
- `src/features/produtos/acompanhamento/AutomacaoIgreenCard.tsx` — apenas copy (item 5).
- `.tmp/igreen-endpoint-map.json` — resultado do probe (item 6, sem código de produção).

## Impacto e risco

- **Zero mudança no motor de fluxo (D/CEMIG), webhooks, portal-worker.**
- Consultores que já configuraram manualmente ficam intactos (o `UPDATE` só afeta linhas 100% zeradas).
- Volume de escrita aumenta em `igreen_customer_boletos`, `igreen_customer_devolutivas`, `igreen_telecom_customers`, `igreen_seguros_customers` — todas com upsert por chave natural, sem risco de duplicar.
- Alertas em `bot_handoff_alerts` também sobem, mas a dedup por `alert_type + idcliente` já existe.

## Perguntas antes de executar

1. Ligar defaults para **todos** os consultores existentes que ainda estão zerados, ou só para novos que forem criados daqui pra frente?  NOVOS DAQUI PARA FRENTE
2. O toggle `rotinas_tarefas` (que transforma aniversariantes/inativos em tarefas no seu painel) entra no pacote "ligado por padrão" ou fica manual? DEIXA O TOGGLE MANUAL, FUTURAMENTE EU ARRUMO