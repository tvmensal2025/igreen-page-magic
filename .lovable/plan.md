# Apagar a Vendedora — Auditoria + Plano Seguro

## Veredito da auditoria

**NÃO pode apagar agora.** Apagar `_shared/vendedora/` neste momento quebra produção em ~10 lugares. Faltam extrações reais — não só shims.

## O que JÁ está no Cérebro (pode apagar com segurança depois)


| Arquivo vendedora | Status                                |
| ----------------- | ------------------------------------- |
| `types.ts`        | shim → `cerebro/comum/types.ts` ✅     |
| `gateway.ts`      | shim → `cerebro/comum/gateway.ts` ✅   |
| `rag.ts`          | shim → `cerebro/comum/rag.ts` ✅       |
| `templates.ts`    | shim → `cerebro/comum/templates.ts` ✅ |


## O que NÃO foi migrado (lógica única, ainda viva)


| Arquivo            | Linhas | Onde precisa virar antes de apagar                                                        |
| ------------------ | ------ | ----------------------------------------------------------------------------------------- |
| `orchestrator.ts`  | 541    | É o `runVendedoraV2` inteiro — chamado por todos os webhooks                              |
| `extractors.ts`    | 209    | Extrai nome/valor/email do inbound — Cérebro hoje usa `entendimento.ts` (overlap parcial) |
| `closer.ts`        | 148    | Finaliza captura (portal_submitting) — Cérebro não tem equivalente                        |
| `memory.ts`        | 112    | Lê/grava `customer_memory` + resumo — Cérebro não chama isso direto                       |
| `perfilador.ts`    | 69     | Classifica perfil/sentimento/urgência — Cérebro não tem                                   |
| `critico.ts`       | 64     | QA da resposta — Cérebro tem `guarda.ts` (overlap, mas regras diferentes)                 |
| `state-machine.ts` | 39     | Decide etapa determinística — Cérebro tem `decisor-passo.ts` (overlap)                    |
| `state.ts`         | 44     | Lê/grava `fluxo_b_state` — Cérebro usa `estado.ts` mas em outra coluna                    |
| `index.ts`         | 44     | Reexporta `runVendedoraV2`                                                                |


## Quem chama `runFluxoBAI`/`runVendedoraV2` hoje

1. `whapi-webhook/handlers/bot-flow.ts:645`
2. `evolution-webhook/handlers/bot-flow.ts:642`
3. `process-followups/index.ts:171` (nudge)
4. `fluxo-b-ai/index.ts` (edge dedicada — chamada por ai-followup-cron, ai-closer-cron, bot-stuck-recovery)
5. `ai-sales-agent/index.ts` (edge legada)

Os webhooks `index.ts` têm gate `cerebro_ativo` → quando ON, early-return com `responderComCerebro` SEM cair na vendedora. Quando OFF, cai no bot-flow → vendedora.

## Plano em 3 ondas (cada uma deployável e reversível)

### Onda A — Cérebro responde 100% no caminho principal (sem apagar nada)

1. Migration SQL: `UPDATE consultants SET cerebro_ativo='on'` + `ALTER COLUMN ... SET DEFAULT 'on'`.
2. Remover o gate `cerebro_ativo` dos 2 webhooks: `responderComCerebro` SEMPRE roda; `try/catch` fail-soft — se cérebro lançar, loga `cerebro_error` e devolve uma resposta determinística curta (NÃO cai mais na vendedora).
3. `process-followups`: trocar `runFluxoBAI` por chamada direta ao Cérebro com `nudgeHook`. (Hoje o Cérebro não tem entrypoint de nudge — criar `cerebro/nudge-hook.ts` reaproveitando `resposta-hook.ts`.)
4. Validar 1h em produção: zero `cerebro_error`, zero `outbound_message_log` duplicado, `cerebro_monitor_canario.mode='apply'` em 100% dos turnos.

### Onda B — Extrair o que falta para o Cérebro

5. Portar `closer.ts` → `cerebro/finalizador.ts` (finalize-capture / portal_submitting).
6. Portar `perfilador.ts` → `cerebro/perfilador.ts` (ou inlinear em `entendimento.ts`).
7. Reaproveitar `extractors.ts` dentro de `entendimento.ts` (já tem overlap — auditar campo a campo).
8. `memory.ts`: o Cérebro já lê `customer_memory` via `cerebro/comum/`. Confirmar paridade ou portar funções faltantes.
9. Atualizar `ai-summarize-conversation`, `ai-extract-memory`, `ai-sales-agent`, `ai-closer-cron`, `ai-followup-cron`, `bot-stuck-recovery` para NÃO importar nada de `vendedora/`. Onde só usam `gateway`/`rag`/`templates`/`types` (shims), trocar import para `cerebro/comum/`.

### Onda C — Apagar

10. Apagar diretório `_shared/vendedora/` inteiro.
11. Apagar `_shared/fluxo-b-ai.ts`.
12. Apagar edge function `fluxo-b-ai/` (e remover do `supabase/config.toml`, cancelar cron se houver).
13. Apagar edge function `ai-sales-agent/` se já não for chamada de lugar nenhum (`rg ai-sales-agent` na src/).
14. Limpar flags mortas em `_shared/feature-flag.ts` (`cerebro_ativo` se decidirmos remover o toggle).
15. Atualizar docs `mem/features/ai-orchestrator-architecture.md`, `mem/whatsapp/flow-engine-v3-rollout.md`, steering files.

## Sinais de rollback

- `cerebro_error` > 0 nos edge logs → reverter Onda A com 1 `UPDATE consultants SET cerebro_ativo='off'`.
- `outbound_message_log` com 2 envios mesmo `message_id` → bug de early-return; reverter webhook.
- `cerebro_sinal_alerta_coincidencia` enchendo → cérebro divergindo da vendedora; pausar Onda B até investigar.

## O que precisa de DECISÃO sua antes de eu começar

**(1)** Posso começar pela **Onda A passo 1+2** agora (migration + remover gate dos webhooks com fail-soft determinístico, SEM portar nudge ainda)? É o passo que tira a vendedora do caminho principal sem apagar código.

**(2)** Ou prefere que eu faça **Onda B inteira primeiro** (portar closer/perfilador/extractors/memory) e só depois ativar Cérebro 100% + apagar? Mais lento mas mais seguro.

**(3)** Em qualquer cenário: confirma que `process-followups` (nudge de reaquecimento) PODE ficar 24h sem rodar enquanto eu porto `nudge-hook.ts` pro Cérebro? Se não, preciso manter `_shared/fluxo-b-ai.ts` vivo até a Onda B terminar.  
  
pode aplicar tudo