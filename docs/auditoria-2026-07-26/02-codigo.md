# 02 — Código: qualidade, complexidade, duplicação

## God-files & risco de manutenção

### Tier crítico (>3000 LOC)

| Arquivo | Risco | Recomendação |
|---|---|---|
| `whapi-webhook/handlers/bot-flow.ts` (7012) | Alto | Débito consciente. NÃO reescrever sem E2E dryRun completo. |
| `evolution-webhook/handlers/bot-flow.ts` (6737) | Alto | Espelho do Whapi. Duplicação intencional para paridade. |
| `evolution-webhook/index.ts` (3661) | Alto | Idem. |
| `whapi-webhook/handlers/conversational/index.ts` (3626) | Alto | Cérebro/Sofia. |
| `whapi-webhook/index.ts` (3505) | Alto | Entry point, roteador. |
| `evolution-webhook/handlers/conversational/index.ts` (3455) | Alto | Espelho conversacional. |

**Observação-chave:** os 4 arquivos Whapi + Evolution (`bot-flow.ts` e `conversational/index.ts`) somam **~20.830 linhas** com paridade intencional. Já mapeado em `AUD-006` (aceito fora do pacote em `docs/auditoria-completa/16-relatorio-final.md`).

### Tier alerta (1500–3000 LOC)

- `src/lib/multichannelCadenceTexts.ts` (2996) — texto+áudio A/B/C. Ver `src/lib/AGENTS.md`.
- `sync-igreen-customers/index.ts` (2591) — worker externo faz o trabalho, edge só orquestra; tamanho vem de mapeamento de campos.
- `MultichannelTextsPanel.tsx` (2565) — painel admin.
- `facebook-create-campaign/index.ts` (2431) — orquestrador Meta.
- `ReheatCyclePizza.tsx` (2349) — pizza A/B/C (crítica UX).
- `AgendamentosHub.tsx` (1910) — central de agendamentos.
- `cadence-tick/index.ts` (1696) — motor. Aceitável dado a complexidade de gates.

## Duplicação Whapi ↔ Evolution

Estratégia atual: **duplicação intencional** para paridade. Helpers canônicos em `_shared/bot/` (step-interaction, holder-match, confirmation-formatters, flow-predicates) — mudanças de comportamento devem ir no `_shared`, não nos handlers.

Verificações realizadas:
- `whapi-webhook/AGENTS.md`: “**não reescrever sem pedido**” — confirmado.
- `evolution-webhook/AGENTS.md`: “Qualquer mudança de comportamento: espelhar em `whapi-webhook`” — confirmado.

## `_shared` crescimento

- 423 arquivos (+41 vs baseline 2026-07-24 = 382).
- Crescimento saudável desde que reforçado pela regra “estenda o helper canônico e seus testes; não copie a lógica para handlers nem crie um segundo helper concorrente” (`_shared/bot/AGENTS.md`).

**Risco:** sem inventário automático, é fácil surgir helper concorrente. Recomendação P2: script `scripts/audit-shared-orphans.mjs` que liste helpers `_shared` sem consumidor.

## Testes

- 77 arquivos de teste em `src/`.
- Cobertura documentada 471 pass / 6 skip (Onda 1, 2026-07-16). Não foi re-executada nesta auditoria (auditoria de leitura pura).
- **Recomendação P2:** rodar `npm test` em CI para monitorar drift.

## `verify_jwt = false`: 90 ocorrências

Cresceu de ~60 (auditoria 2026-07-16) para **90**. Cada edge com `verify_jwt=false` **precisa** validar autorização em código (`assertCronAuth`, `assertBotOutboundAllowed`, secret na URL, HMAC). Auditoria detalhada em `06-seguranca.md`.

## Diretórios de scratch/legado

| Diretório | Estado | Ação |
|---|---|---|
| `.tmp/` | 20+ arquivos experimentais | P2: revisar, mover úteis para `scripts/`, remover resto |
| `docs/archive/` | Rotulado como arquivo histórico | OK — manter |
| `docs/auditoria-completa/` | Auditoria 2026-07-16, marcada `STATUS.md` = snapshot histórico | OK |
| `docs/auditoria/` | Anterior | Verificar se é redundante com este novo |
| `experiments/solar-3d-ai/` | Spike | OK — spike documentado |

## Complexidade ciclomática

Não foi medida quantitativamente (sem `eslint-plugin-sonarjs` ou `radon`). Análise qualitativa:

- `cadence-tick/index.ts` — múltiplos gates encadeados (kill, toggle, cliente-guard, DNC, janela, cap A/B/C/global, cross-channel, nome seguro). Alta complexidade justificada por regra dura.
- `whapi-webhook/index.ts` — roteador multi-tenant com kill switch, dedupe, cérebro, funil A. Alta complexidade justificada.
- `flow-builder/FlowDiagram.tsx` (2250) — editor visual React Flow, alta complexidade esperada.

**Recomendação P2:** adicionar `eslint-plugin-sonarjs` para monitorar complexidade em novos PRs (não em bloco, para não gerar 500+ warnings).

## Boas práticas confirmadas

- Helpers canônicos usados nos motores críticos (`cadence-tick`, `whapi-webhook`).
- `AGENTS.md` distribuídos por diretório (`whapi-webhook/`, `evolution-webhook/`, `cadence-tick/`, `_shared/bot/`, `src/lib/`, etc.) — princípio Context7 “nearest wins”.
- `types.ts` gerado, nunca editado à mão (confirmed via topologia).
- Kill switch central + rollback em cascata documentado.
