# 09 — Testes, build e qualidade

**Data:** 2026-07-16  
**Modo:** comandos somente leitura (sem `--fix`, sem E2E em produção)

---

## 1. Comandos executados

| Comando | Exit | Resumo |
|---|---:|---|
| `npm run typecheck` | **0** | `tsc -b --noEmit` limpo |
| `npm run lint` | **0** | **0 errors**, **1378 warnings** (quase todos `no-explicit-any`) |
| `npm run test` | **0** | **61** arquivos pass / 1 skip; **471** testes pass / 6 skip |
| `npm run build` | **0** | Vite build ~1m 8s; chunk `three` ~841 kB |
| `npx playwright test --list` | **0** | **6** testes E2E em 5 arquivos (não executados) |

### Ruídos observados (não falharam o suite)

- jsdom `Not implemented: navigation` durante alguns testes (warning).
- Log `[useDiagramExport] export failed` em teste esperado.

### Lint

- 13 warnings “potentially fixable” com `--fix` — **não aplicados**.
- Edge functions fora do ESLint frontend (CI Deno separado).

---

## 2. Inventário de testes existentes

| Camada | Quantidade | Notas |
|---|---:|---|
| Vitest `src/**/*.{test,spec}.{ts,tsx}` | 62 arquivos / 477 testes | Inclui kill-switch, rodízio unit, captacao, solar, flow-builder |
| Deno `*_test.ts` em functions | ~101 arquivos | CI parcial (`_shared/channels`, engine, webhooks check) |
| Playwright E2E | 6 | Mobile audit, composer WA/captação, proposta token inválido |
| Worker Club | `worker-club/test/` | node --test |
| Integração rodízio | 6 skipped | `rodizio-next.integration.test.ts` |

---

## 3. Matriz de testes ausentes / fracos (fluxos críticos)

| Fluxo crítico | Unit | Integração | E2E | Situação |
|---|---|---|---|---|
| Login | parcial | — | — | Fraco |
| Isolamento entre consultores (RLS/IDOR) | exemplos caller-auth | — | — | Insuficiente vs produção |
| Entrada de lead (`lead-intake`) | — | — | — | Ausente |
| Rodízio assign atômico | unit + property front | skip integration | — | Bom no seletor; RPC SQL pouco coberta no Vitest |
| Envio manual | evolutionApi.test | — | composer check (lista) | Parcial |
| Automação vs manual | kill-switch tests | — | — | Bom kill-switch; fraco classificação origem |
| Pausa do bot | parcial | — | — | |
| Nunca mais contatar / DNC | — | — | — | **Ausente** (AUD-001/002 sem teste) |
| Agendamento / follow-up | agendamentosHub.test | — | — | Parcial |
| Webhook duplicado | Deno idempotency tests | — | — | Parcial CI |
| Mensagem fora de ordem | — | — | — | Ausente |
| Portal 2 worker | probes manuais | — | — | Sem suite CI |
| Worker Club | node test | — | — | dryRun coberto localmente? |
| OTP | — | — | — | Fraco |
| Meta Ads create/health | — | — | — | Ausente (AUD-004) |
| Stripe webhook | — | — | — | Ausente |
| Voz / DNC voz | — | — | — | Ausente |
| Proposta pública | — | — | soft E2E | Mínimo |
| Solar 3D | economics/proposal unit | — | — | Parcial |

---

## 4. Bundle / performance build (observação)

Maiores chunks: `three` 841 kB, `charts` 430 kB, `xlsx` 424 kB, `jspdf` 391 kB, `AdsCentralTab` 366 kB — lazy ok, mas Ads/WhatsApp/Captacao são pesados.

---

## 5. Impacto

- Qualidade de **compilação e suite Vitest** está saudável (exit 0).
- Cobertura dos fluxos de **segurança/DNC/webhooks enforce** é o principal gap — alinha com achados P0/P1.
- E2E Playwright existe mas é fino; não rodar contra produção (conforme regra).
