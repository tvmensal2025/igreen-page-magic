---
inclusion: auto
name: cerebro-mg-e-rodizio
description: Cérebro MG Meta + waste + avisos rodízio. Use em Ads/escala/rodízio.
---

# Cérebro MG + avisos de rodízio

**Doc oficial (canônica):** #[[file:docs/CEREBRO-ADS-OFICIAL.md]]  
Operacional/rodízio: #[[file:docs/cerebro-e-rodizio-avisos.md]] · rule: #[[file:.cursor/rules/cerebro-campanhas-mg.mdc]]  
Política curta: #[[file:docs/CEREBRO-ADS-POLITICA-CONGELADA-2026.md]] · script `scripts/analysis/cerebro_ads_2026_analysis.py`

## Cérebro
- **Oficial 2026:** `geo_mode=radius_sede` + `max_explorers=0` (1 CTWA raio na sede). Editável na UI: Central Anúncios → Cérebro → engrenagem → Controles.
- Legado: 1 âncora + até N `MG-ROT-*` só se `geo_mode=cities_mg_rot`
- Config por consultor: `consultant_ad_settings.brain_config` (não hardcode)
- `require_initial_message=true` → create bloqueia sem frase CTWA
- Autopilot: `facebook-auto-pause` (waste) → `facebook-mg-city-rotator` **só com diff**; em `radius_sede` não semeia MG-ROT
- Autopilot só se `brain_config.autopilot === true` (null ≠ ligado)
- Escala âncora: 48h mede CPL; degrau ~15% / ~4h — **sem** trava 48h entre subidas
- Conversas Meta = `pickMetaConversations` (1 action_type canônico). **Nunca** somar `started`+`first_reply`+`total_connection` (incidente 2026-07-24: CPL R$6,50 aparecia R$2 e budget subia)
- `brain_scale_*` **proibido** em `MG-ROT-*` e âncora UDI
- Waste: `AUTO_PERF_PAUSE:`; se `paused_by_ai_at` já setado → **não** re-pausar
- Health/rotator **não** reativam waste — só Play do consultor
- Salvar config **não** cria campanha; criar = Express/wizard Publicar

## Idempotência Meta (incidente 2026-07-23)
POST cego de targeting/age a cada 30 min **resetava aprendizado** (“anúncio reiniciando”).

**Regra:** só PATCH Graph se valor atual ≠ desejado.
- `age_min_preferred` no DB já = alvo → **não** chamar Graph
- `patchAdsetAgeRange` faz GET e skip se já ok (`age_range_noop` vs `age_range_patch`)
- Aviso WA “Cérebro MG — N praças” **só** se slot/budget/status mudou
- `updated_at` só quando houve patch real

Tick **pode:** pausar waste; ativar/pausar exploradora se slot mudou; alinhar budget se diverge; escala com anti-spam.  
Tick **não pode:** reescrever targeting/idade/criativo “por garantia”; clonar campanha ativa; notificar em loop noop.

## Avisos parceiro
1. Pool via RPC `configure_rodizio_pool`
2. Novas pools: **180 min** + quiet **21h–09h** (só INSERT)
3. Meta ACTIVE → `rodizio-metrics-broadcast`
4. 1× aprovada / métricas reais / 1× pausa
5. Elegível: pool + `notification_phone` + `rodizio_metrics_enabled` + `is_active`

## Proibido
Inventar métricas · reenviar aprovada · mudar intervalo de pools atuais sem pedido · protocol/keyword no WA · **POST cego de targeting/age/criativo em campanha ativa** · massa nova sem pedido
