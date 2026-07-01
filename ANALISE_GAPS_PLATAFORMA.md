# Análise de gaps: o que ainda falta capturar/ajustar (iGreen)

Data: 01/07/2026 · Base: lista COMPLETA de endpoints extraída do app (fechada).

## Método
Extraí TODOS os endpoints que o portal realmente usa (dos bundles JS). A lista
abaixo é definitiva — não há endpoint "escondido" além destes.

## 1. Devolutivas — PARCIAL, dá pra melhorar (prioridade ALTA)

Hoje capturamos: campo `devolutiva` no cliente + `/customer-devolutivas/{id}`.

O portal tem **duas fontes** melhores que ainda não usamos por completo:
- `/clientes-green/devolutivas?categoria=` — lista por categoria
  (`problemas_fatura`, `debitos`, `erro_documento`, `testemunha`, `outros`)
  com `codigo, nome, cidade, uf, licenciado, motivo, categoria`.
- **`/rotinas/devolutivas-novas?mes=`** — devolutivas NOVAS do mês, com campos
  que não gravamos: `iddevolutiva, campo, obs, impeditiva (bool), data, propria`.

**Gap:** não guardamos `categoria`, `impeditiva`, `campo` (qual documento deu
problema) nem histórico datado. Isso é o que o consultor mais precisa para agir.

**Ajuste proposto:** tabela `igreen_customer_devolutivas`
(consultant_id, idcliente, iddevolutiva, categoria, campo, motivo/obs,
impeditiva, data, propria) + alimentar a coluna `devolutiva` do customer com o
texto limpo. Vira alerta/tarefa ("cliente X: fatura não anexada — impeditiva").

## 2. Anexos / documentos / contrato — NÃO EXISTE na API (confirmado)

Testei `/anexos`, `/documentos`, `/contrato`, `/fatura` em várias formas: todos
404. O portal **não expõe** os arquivos que o cliente enviou (RG, conta de luz)
nem o PDF do contrato. O único arquivo disponível é o **boleto/fatura**
(`urlboleto`, `urlinvoice` em `/clientes-green/boletos`) — que já capturamos.

**Conclusão:** não dá para "anexar" documentos do cliente vindos do portal —
eles não estão na API. Só o PDF do boleto. (Os documentos que temos hoje vêm do
fluxo do bot/OCR, não do portal.)

## 3. Cashback — NÃO capturado (prioridade MÉDIA)

`/cashback/resumo?origem=GREEN|TELECOM|SEGUROS` funciona e traz:
`gerado {registros,clientes,valor}, usado, saldo, ranking[{idcliente,nome,
cidade,uf,indicados,valor}]`.

**Gap:** não capturamos cashback nenhum. É dinheiro que o consultor gera por
indicação. Vale gravar o resumo por origem em `igreen_consultant_metrics`
(3 colunas de saldo) + o ranking de quem mais indicou.

## 4. Licenças expirando — NÃO capturado (prioridade ALTA p/ retenção)

`/painel/licencas-expirando` traz `counts {aVencer, vencida, expirada}` + itens
por graduação. Licença vencida = licenciado para de ganhar. É alerta crítico de
retenção da rede.

**Ajuste:** já gravamos `alertas.licencas` no `painel/overview` dentro de
`igreen_consultant_metrics.raw_json`; falta expor como alerta/tarefa acionável.

## 5. Boletos — capturado, mas subaproveitado (prioridade ALTA)

Já gravamos `igreen_customer_boletos`. O que falta é USAR:
- Alertas de **boleto vencendo/vencido** por cliente (já temos `dias_atraso`,
  `vencimento`, `status`, `url_boleto`).
- Reenvio do boleto pelo WhatsApp (temos `url_boleto` em PDF).

## 6. Faturas Telecom — capturado parcial

Gravamos `fatura_valor/status` do telecom. `/telecom/faturas` tem a lista
completa mensal (a_vencer/vencido/pago) — poderia virar cobrança de telecom.

## 7. Rotinas de CEO — capturado (raw), não exposto (prioridade MÉDIA)

Já gravamos `rotina_diaria/semanal/mensal` em `igreen_consultant_metrics`.
Falta transformar em **tarefas/alertas** na plataforma:
- Diária: aniversariantes, novos sem ativação, boletos vencendo hoje, inad 1/30/60.
- Semanal: esfriando, reengajamento 30/60/90, novos sem ativação.
- Mensal: licenças vencendo, novos clientes/licenciados, pró do mês.

## 8. Painel do Líder / rede — capturado (raw), pouco exposto

`/painel/*` (overview, produção, team, inativos, onboarding, top-expansão,
eventos, ranking-movements) e `/network-map/{id}/*` (detalhe, diretos,
node-cards, contato). Base rica para um dashboard de gestão de rede.

## 9. Pro-builder / análises — não capturado (prioridade BAIXA)

`/pro-builder`, `/analise-pro/summary`, `/analise-retencao/summary`,
`/estatisticas-pro`. Métricas de acompanhamento de metas (Pró). Nice-to-have.

---

## Priorização recomendada (o que ajustar primeiro)

| # | Ajuste | Valor | Esforço |
|---|---|---|---|
| 1 | **Devolutivas detalhadas** (categoria/impeditiva/campo) + alertas | Alto | Médio |
| 2 | **Alertas de boleto vencendo** (energia + telecom) via WhatsApp | Alto | Médio |
| 3 | **Licenças expirando** → alerta de retenção da rede | Alto | Baixo |
| 4 | **Rotinas → tarefas** (aniversariante, esfriando, reengajamento) | Alto | Médio |
| 5 | **Cashback por origem** em métricas + ranking indicações | Médio | Baixo |
| 6 | **Cross-sell** (energia → telecom/seguros no bot) | Médio | Médio |
| 7 | Dashboard de gestão de rede (painel do líder) | Médio | Alto |
| 8 | Pro-builder / análises de retenção | Baixo | Médio |

## O que NÃO é possível (para alinhar expectativa)
- Baixar documentos/RG/conta/contrato do cliente pelo portal — a API não expõe.
- Extrato de comissão/pagamento do consultor — não há endpoint (`/financeiro`
  é agregado de status de clientes, não de dinheiro do consultor).


---

## STATUS (01/07/2026) — implementado com TOGGLES

**Tudo começa DESLIGADO.** O consultor ativa cada recurso no card
"Automações iGreen" (aba Acompanhamento). Tabela `igreen_automation_settings`.

### Captura (toggle liga/desliga o que o sync coleta)
- `capture_boletos`, `capture_devolutivas`, `capture_telecom`,
  `capture_seguros`, `capture_cashback`.
- O worker `/sync-all` recebe `only=[...]` conforme os toggles → só coleta o
  que está ligado (base: customers/network/metrics sempre).

### Novas tabelas
- `igreen_customer_devolutivas` — categoria, campo, motivo, impeditiva, data,
  propria (RLS por dono). Fonte: `/rotinas/devolutivas-novas` + categorias.
- Cashback → colunas em `igreen_consultant_metrics` (green/telecom + json).

### Alertas (toggle) → geram itens em `bot_handoff_alerts`
- `alert_boletos_vencendo` — boleto vencido/disponível por cliente (com PDF).
- `alert_devolutivas` — devolutivas (prioriza impeditivas).
- `alert_licencas_expirando` — retenção da rede.

### WhatsApp proativo (toggle) — flags prontas, disparo a implementar
- `auto_wa_boleto_vencendo`, `auto_wa_aniversariante`, `cross_sell_bot`:
  a preferência é salva, mas o ENVIO automático ainda não está ligado (por
  segurança). Próximo passo quando você quiser ativar disparo real.

### Front
- `AutomacaoIgreenCard` (switches por recurso) + `automationSettings.ts` (hook).
- `MultiprodutoCard` (telecom/seguros). Tudo na aba Acompanhamento.
- `tsc` + `vite build` → exit 0. RLS ativo em todas as tabelas novas.
