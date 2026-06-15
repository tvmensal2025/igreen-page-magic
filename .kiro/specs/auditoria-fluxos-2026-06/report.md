# Auditoria — Fluxos D / B / Cadastro

**Data:** 2026-06-14
**Escopo:** `whapi-webhook`, `fluxo-b-ai` (Cérebro IA), `_shared/cerebro/*`, `_shared/bot/*`, `_shared/pipeline-cadastro/*`, crons de saúde e workers Portal.
**Modo:** somente leitura (queries + logs + leitura de código). Nenhuma alteração feita.

---

## 1. Resumo executivo (semáforo)

| Bloco | Status | Comentário curto |
|---|---|---|
| **Fluxo D (Whapi/botões)** | 🟡 funcionando, conversão muito baixa | 1.053 leads/30d, só **4** chegaram a `cadastro_em_analise`/`finalizando` (~0,4%). 22 travados em `aguardando_humano`. |
| **Fluxo B (IA livre / "Cérebro")** | 🔴 sangrando leads silenciosamente | 919 leads em 7 dias na variant B (Nilma Tavares), **0** concluídos, **917 com `conversation_step=NULL`**, apenas 1 com `last_bot_reply_at` preenchido. Edge `fluxo-b-ai` sem invocações registradas. |
| **Pipeline de Cadastro (OCR/Portal2)** | 🔴 efetivamente parado | `portal2_audit_traces` zerado há 7 dias (último: 30/05). Nenhum trace de OCR/portal nos últimos dias. |
| **Telemetria do Cérebro** | 🔴 silenciosa | `ai_decisions`: 0 em 24h (último 13/06). `ai_costs`: 0 em 24h. `engine_logs`: último em 26/05. Cérebro foi codado mas não está sendo executado (gate de rollout off). |
| **Crons de saúde** | 🟢 rodando | `bot-stuck-recovery`, `bulk-scheduler`, `production-health-snapshot`, `process-followups` etc. todos com boot/shutdown limpos nos logs. |
| **Handoffs / takeover humano** | 🟡 alto volume | 87 alertas de handoff em 7 dias — sintoma do drop-off acima, não causa. |

> **TL;DR:** o webhook recebe mensagens (último inbound 14/06 22:44), mas a *resposta automática* (Cérebro + Portal2) está praticamente desligada. Os leads chegam, ninguém responde dentro do bot, conversa cai para humano ou morre. Antes de qualquer feature nova, é preciso destravar Fluxo B+Portal2.

---

## 2. Arquitetura observada

```text
WhatsApp inbound
   └── whapi-webhook  (1.909 LOC)
        ├── gates (kill-switch / paused / dedupe / cooldown / takeover)
        ├── flow_variant lookup (consultors[].active_variants → A/B/C/D/E/F/G)
        │
        ├── if variant=B  → bypass legacy, força engine=sys → runFluxoBAI()
        │                    (que internamente chama Cérebro/processarTurno)
        │
        ├── if variant=D  → bypass Cérebro, vai direto para engine=flow
        │                    runConversationalFlow() (bot_flow_steps + botões)
        │
        ├── engine v3 hook (dark mode — só observa)
        ├── Cérebro SOMBRA hook (dark — só registra)
        ├── Cérebro RESPOSTA hook (canary/on — gate em deveResponderComCerebro)
        │
        └── runBotFlow() / runConversationalFlow()  → sender (whapi-api)
             ├── pipeline-cadastro (OCR/doc/portal2) — para steps de cadastro
             └── worker-portal/worker-portal-2 (out-of-band, via fila)
```

**Pontos-chave do código** (`whapi-webhook/index.ts:1568-1830`):
- Variant B força engine=sys e roteia para Vendedora V2 / Cérebro
- Variant D bypassa o Cérebro pra preservar botões
- Existem hooks **paralelos** do engine v3 e do Cérebro (sombra), todos fail-open
- Auto-cura de step órfão entre variantes (linha 1594) — bom, mas indica histórico de bugs de variant mismatch

---

## 3. Fluxo D (Whapi com botões) 🟡

### O que funciona
- Webhook recebe e dedupa OK (último log `Whapi webhook received` às 22:44 hoje)
- Crons `flow-d-health-cron`, `flow-d-stuck-watchdog`, `bot-stuck-recovery` ativos
- Auto-cura de step órfão protege contra step UUID inválido em variant errada
- 84/1053 leads (~8%) tiveram `last_bot_reply_at` preenchido nos últimos 30d

### Problemas
| # | Sintoma | Evidência |
|---|---|---|
| D-1 | **Conversão pífia**: só ~0,4% chegam a estado final | Query `customers WHERE flow_variant='D' AND created_at>30d`: 996/1053 com `conversation_step=NULL`, 4 finalizando |
| D-2 | 22 leads travados em `aguardando_humano` | Mesma query |
| D-3 | 11 travados em `aguardando_conta`, 7 em `welcome` — provável que botão não foi disparado ou usuário não respondeu | Mesma query |
| D-4 | Não há `portal2_audit_traces` há **15 dias** — fluxo D não está chegando a executar OCR/Portal2 | `SELECT MAX(created_at) FROM portal2_audit_traces` = 2026-05-30 |
| D-5 | 7 variants ativas (A,B,C,D,E,F,G) em `bot_flows` — superfície de teste poluída | `SELECT variant, COUNT(*) FROM bot_flows GROUP BY ...` |

### Recomendações
1. Investigar por que `aguardando_conta` não está progredindo (provavelmente OCR/`capture-extract` não está sendo chamado — ver bloco Cadastro)
2. Auditar manualmente um lead em `aguardando_humano` e verificar se houve `bot_handoff_alerts` correspondente (87 handoffs/7d sugere que sim)
3. Arquivar/desativar variants E/F/G se forem testes obsoletos

---

## 4. Fluxo B ("Cérebro IA" / Vendedora V2) 🔴

### Arquitetura real
- Edge `fluxo-b-ai/index.ts` (136 LOC) é hoje só um **wrapper de teste** para o admin (modal "Testar lead simulado") — chama `processarTurno` em `_shared/cerebro/`
- O Cérebro real (`_shared/cerebro/`) tem **17 arquivos** (orchestrator, escritor, decisor-passo, guarda, entendimento, despacho-cadastro, sombra-hook, resposta-hook, etc.) — código denso e bem testado em `__tests__/`
- Em produção, o webhook chama o Cérebro via `responderComCerebro` (linha 1810) — **mas só em canary/on**, gate em `deveResponderComCerebro`

### Dados (catastróficos)
- **919 leads** em 7d com `flow_variant='B'` (consultora **Nilma Tavares**, único com variant B ativa)
- **917 (99,8%)** com `conversation_step = NULL` → Cérebro nunca avançou o estado
- **0** finalizados, **0** em `portal_submitting`/`aguardando_otp`
- Apenas **1** com `last_bot_reply_at` preenchido em 7 dias
- `ai_decisions`: **0 em 24h**, último em 13/06 (1 dia parado)
- `ai_costs`: **0 em 24h** → Cérebro literalmente não está gastando tokens
- `engine_logs`: último em **26/05** (20 dias parado)
- Edge `fluxo-b-ai`: **sem logs** (nem boot)

### Diagnóstico
O Cérebro está **codado, testado, mas desligado em produção**. O gate de rollout (`rollout_config.canary_percent=5`, `dark_min_hours=48`) sugere que está em dark/canary, e `deveResponderComCerebro` provavelmente nunca retorna true para esses leads.

Como variant B força `engine=sys` e bypassa o engine determinístico, mas o Cérebro também não responde → **lead fica órfão**: webhook recebe, gates passam, nenhuma resposta é enviada.

### Recomendações priorizadas
1. **🔴 URGENTE**: investigar `_shared/cerebro/resposta-hook.ts → deveResponderComCerebro` — qual é o critério? Por que não está liberando?
2. Verificar `consultants.use_engine_v3` da Nilma (= false hoje) e se há flag específica para Cérebro
3. Decidir: ou liga o Cérebro pra variant B, ou **muda a Nilma para variant D** enquanto o Cérebro não está pronto
4. Adicionar alarme: "lead em variant B sem `last_bot_reply_at` por >1h" deve gritar

---

## 5. Pipeline de Cadastro (OCR + Portal2) 🔴

### O que existe
- `_shared/pipeline-cadastro/registry.ts` (124 LOC) — registry de passos canônicos
- `_shared/bot/cadastro-intent.ts` (104 LOC) — detecção de intenção
- Edges: `capture-extract`, `finalize-capture`, `igreen-ingest-customers`, `igreen-ingest-xlsx`
- Workers: `worker-portal`, `worker-portal-2`, `worker-igreen-sync` (Dockerfiles versionados)
- Tabela `portal2_audit_traces` para observabilidade

### Sinais de parada
- `portal2_audit_traces`: **último trace 30/05**, zero nos últimos 7 dias
- `capture-extract` e `finalize-capture`: **sem logs** nos últimos minutos
- 11 leads variant D parados em `aguardando_conta` (nunca processados)
- 3 leads em `aguardando_doc_auto`, 1 em `aguardando_documento`, 1 em `aguardando_otp` — pipeline travado

### Hipóteses
- Workers Portal podem estar offline (não consigo verificar daqui — rodam fora do Supabase)
- Ou ninguém está enviando conta → não há o que processar (mas isso seria coerente com Fluxo B/D não pedindo conta)
- Ou `capture-extract` está sendo chamado mas falhando silenciosamente em fase anterior ao trace

### Recomendações
1. Verificar status dos containers `worker-portal-2` (fora do Lovable)
2. Forçar manualmente um `capture-extract` num lead em `aguardando_conta` e ver se gera trace
3. Adicionar log estruturado em `capture-extract` no início e fim para confirmar invocação

---

## 6. Tabela de funções edge auditadas

| Função | Status | Última atividade | Observação |
|---|---|---|---|
| `whapi-webhook` | 🟢 ativa | 22:44 hoje | Recebendo inbound normalmente |
| `whapi-proxy` | 🟢 ativa | 22:46 hoje | Boots/shutdowns frequentes |
| `evolution-proxy` | 🟢 ativa | logs OK | Listando contatos |
| `fluxo-b-ai` | ⚫ inerte | sem logs | Wrapper admin; produção usa Cérebro inline |
| `flow-d-stuck-watchdog` | ⚫ sem logs | — | Verificar se cron está scheduleado |
| `flow-d-health-cron` | ⚫ sem logs | — | Idem |
| `capture-extract` | ⚫ sem logs | — | Não está sendo invocado |
| `finalize-capture` | ⚫ sem logs | — | Idem |
| `bot-stuck-recovery` | 🟢 cron 5min | 22:30 hoje | "0 leads candidatos" sempre — gate ok |
| `bot-loop-watchdog` | 🟢 cron 5min | 22:48 | "scanned: 0" — sem loops |
| `bulk-scheduler` | 🟢 cron 20s | 22:51 | OK |
| `production-health-snapshot` | 🟢 cron 5min | 22:50 | OK |
| `process-followups` | 🟢 cron 5min | 22:50 | OK |
| `instance-health-cron` | 🟢 cron 5min | 22:50 | OK |
| `faq-reengagement-nudge` | 🟢 cron | 22:50 | OK |
| `ocr-review-timeout` | 🟢 cron 1min | 22:51 | OK |

⚫ = sem invocações recentes (pode estar correto se não há trigger, mas merece checar agenda)

---

## 7. Itens obsoletos / candidatos a arquivar

| Item | Por quê |
|---|---|
| Variants `E`, `F`, `G` em `bot_flows` (1 cada) | Provavelmente testes — confirmar com user |
| Comentário `fluxo-b-bypass` em `whapi-webhook` linha 1568-1592 | Vai sumir quando Cérebro estiver canônico |
| `fluxo-b-ai/index.ts` como wrapper admin | OK manter (usado pelo modal), mas documentar como "tester only" |
| Specs em `.kiro/specs/_done/*` | Já marcados como done — só revisar se sobrou algo solto |
| `fluxo-d-auditoria/report.md` antigo | Esta nova auditoria substitui — vale revisar e juntar |

---

## 8. Próximos passos sugeridos (ordem de prioridade)

1. **🔴 Cérebro silencioso na variant B** — abrir spec `cerebro-ativacao-fluxo-b` que:
   - Audita `deveResponderComCerebro` (gate de rollout)
   - Decide rollout: dark→canary→on para a consultora Nilma
   - Adiciona alarme "lead B sem resposta >1h"
2. **🔴 Portal2 parado** — verificar containers `worker-portal-2` e abrir spec `portal2-revival` se workers estiverem down
3. **🟡 Conversão Fluxo D** — auditoria manual dos 22 `aguardando_humano` + 11 `aguardando_conta` para entender ponto de queda real (talvez já coberto pela spec `captacao-fluxo-d-conversao`)
4. **🟢 Limpar variants** E/F/G de `bot_flows` se forem mortas
5. **🟢 Smoke test contínuo** — agendar `bot-e2e-runner` diariamente e alarmar em regressão

---

## 9. Apêndice — comandos para reproduzir

```sql
-- Distribuição de leads por variant e step (7d)
SELECT flow_variant, COALESCE(conversation_step,'(null)') step, COUNT(*) n
FROM customers WHERE created_at > now()-interval '7 days'
GROUP BY 1,2 ORDER BY 1, n DESC;

-- Última atividade dos motores
SELECT
 (SELECT MAX(created_at) FROM ai_decisions) last_decision,
 (SELECT MAX(at) FROM engine_logs) last_engine_log,
 (SELECT MAX(created_at) FROM portal2_audit_traces) last_portal,
 (SELECT MAX(created_at) FROM ai_costs) last_ai_cost;

-- Leads B sem resposta
SELECT id, phone, created_at, last_bot_reply_at, conversation_step
FROM customers WHERE flow_variant='B' AND last_bot_reply_at IS NULL
  AND created_at > now()-interval '7 days' ORDER BY created_at DESC LIMIT 10;
```
