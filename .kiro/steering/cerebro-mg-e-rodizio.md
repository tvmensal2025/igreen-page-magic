---
inclusion: fileMatch
fileMatchPattern:
  - "supabase/functions/facebook-mg-city-rotator/**"
  - "supabase/functions/facebook-auto-pause/**"
  - "supabase/functions/campaign-brain-rank/**"
  - "supabase/functions/rodizio-metrics-broadcast/**"
  - "supabase/functions/_shared/brain-*.ts"
  - "supabase/functions/_shared/ad-copy-bank.ts"
  - "supabase/functions/_shared/campaign-waste-guard.ts"
  - "supabase/functions/_shared/rodizio-*.ts"
  - "supabase/functions/facebook-create-campaign/rodizio-pool.ts"
  - "src/components/admin/ads/CampaignBrain*"
  - "src/components/admin/ads/CampaignRodizio*"
  - "src/components/whatsapp/RodiziosBroadcastPanel.tsx"
  - "docs/cerebro-e-rodizio-avisos.md"
---

# Cérebro MG + avisos de rodízio

Doc: #[[file:docs/cerebro-e-rodizio-avisos.md]]

## Cérebro
- 1 âncora (UDI) + até N `MG-ROT-*`; config `consultant_ad_settings.brain_config` (`brain-config.ts`)
- Autopilot: `facebook-auto-pause` (waste) → `facebook-mg-city-rotator` (`ensure_active_slots`)
- Escala âncora: 48h **só mede** CPL; degrau ~15% / anti-spam ~4h (`brain-budget-scale.ts`) — **sem** trava 48h entre subidas
- Aviso escala → consultor (`notifyAnchorBudgetScale`), não parceiro
- `brain_scale_*` **proibido** em `MG-ROT-*` e âncora UDI
- CTWA sem cidade; copy `_shared/ad-copy-bank.ts`; não reescrever criativo já ativo
- Waste: `campaign-waste-guard.ts` prefixo `AUTO_PERF_PAUSE:` — health/rotator **não** reativam

## Avisos parceiro
1. Pool via RPC `configure_rodizio_pool`
2. Novas pools: intervalo **180 min** + quiet **21h–09h** (só INSERT)
3. Meta ACTIVE → cron `rodizio-metrics-broadcast`
4. 1× aprovada (`approval_notified_at`); métricas reais; 1× pausa (`paused_notified_at`)
5. Elegível: pool + `notification_phone` + `rodizio_metrics_enabled` + `is_active`

## Proibido
Inventar métricas; reenviar aprovada; mudar intervalo de pools atuais sem pedido; protocol/keyword no WA; massa nova sem pedido.
