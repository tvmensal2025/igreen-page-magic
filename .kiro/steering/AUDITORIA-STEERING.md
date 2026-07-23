---
inclusion: manual
---

# Auditoria do pack steering

Última atualização: **2026-07-23** (round 4).

## Estado atual

- **Always (6):** `idioma`, `regras-duras`, `armadilhas`, `product`, `tech`, `structure`
- **Auto:** `helpers-canonicos`, `banco`, `edge-functions`, `fluxos`, `nomes-e-tema`, `convencoes`, `rotas-ui`, `deploy`, `security-auth`, `ads-contraste`, `cerebro-mg-e-rodizio`, `minio-storage`, **`mapa-tarefas` (novo)**
- **Manual:** **`glossario` (novo)**, `AUDITORIA-STEERING`
- **fileMatch:** portal2 / club / sync / pós-venda / esteira / wallet / solar / remote / flow-engine-v3
- `AGENTS.md` reescrito com **árvore de decisão** + índice completo dos steering
- `projeto.md` seguiu removido (fundido em `product.md` desde round 3)

## Novidades cobertas nesta round

- **Caps outreach A/B/C** documentados em `regras-duras`, `banco`, `fluxos`, `AGENTS.md`, `mapa-tarefas`, `glossario`.
  - A = ilimitado (bypass) · B = `cap_b` (150) · C = `cap_c` (50) · Global B+C = `cap_global_outreach` (200).
  - Migration: `supabase/migrations/20260721000000_whapi_throttle_groups.sql`.
  - Motor: `supabase/functions/cadence-tick/index.ts` + `_shared/cadence-engine.ts::stageGroup`.
  - UI: `src/components/admin/ColdCadenceCapCard.tsx` (3 barras + edit inline).
  - Alertas: `automation_skip_log` (`outreach_cap_{b|c|g}_{60|85|100}pct`).
- **Cross-channel suppression** (voz `IK/EK/CK/BK` + 2× SMS `UNDELIV`/72h → DNC automática): `voice-dialer-webhook`, `checkPhoneDeadForChannel` em `cadence-tick`.
- **Janela horária BRT 08–20h** com trava `clamp_to_business_window_brt` (migration + gate no motor).
- **Logs de tick**: `boot` / `guards_ok` / `done` / `fatal` em `cadence-tick` para diagnosticar “shutdown mudo”.
- **Tema forçado light** (opcional a redocumentar em `nomes-e-tema` se voltar a mudar).

## Fatos conferidos no código

pós-venda · wallet líquido · MinIO · Club · sync · Portal extract · Whapi primário · `conversations` (não `messages`) · dedup canônico `webhook_message_dedup` · tema dual · V3 takeover só `on`/bool · rodízio UUID · `deterministic-campaign-resolver` (ad_id → fb_campaign_id → ctwa_clid → protocol → exact msg).

## Riscos residuais

- Pós-venda ignora `bot_global` (só toggle próprio) — fato do código; documentado em `#pos-venda`.
- Lead Ads sem `PAGE_ACCESS_TOKEN` pode descartar leads pagos silenciosamente — mitigar em `meta-leadads-webhook`.
- Nested `AGENTS.md` por subpasta e Biome analyzer — skip por ora.
- `ctwa_clid_mapping` sem alerta quando pool de rodízio vazio — considerar log em `automation_skip_log`.

## Convenção para próximas rounds

1. Toda regra nova estabelecida em conversa entra em `regras-duras` **ou** `armadilhas` no mesmo PR.
2. Todo caminho novo tarefa→arquivo entra em `mapa-tarefas`.
3. Toda sigla nova entra em `glossario`.
4. Este arquivo (`AUDITORIA-STEERING.md`) marca a data e resume o delta.
