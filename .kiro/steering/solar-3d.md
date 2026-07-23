---
inclusion: fileMatch
fileMatchPattern:
  - "src/features/solar-3d/**"
  - "supabase/functions/solar-*/**"
  - "supabase/functions/_shared/solar/**"
  - "src/components/superadmin/SolarModulePanel.tsx"
  - "**/migrations/*solar*"
  - "experiments/solar-3d-ai/**"
---

# Solar 3D — telhado (Google Solar)

Conexão Placas: análise remota + viewer 3D/2D + snapshot em proposta + widget público.

## Onde
- Front: `src/features/solar-3d/` · rotas `/admin/solar-design`, `/admin/solar-design/:id`
- Edges: `solar-roof-analyze|public|image|hd|context`, `solar-design-get|public`, `solar-geocode`
- Shared: `_shared/solar/` (`google-solar-client`, `analyze-service`, `economics-br`)
- Flags: `consultants.solar_3d_enabled`, `solar_public_widget_enabled`
- Tabelas: `solar_roof_analyses`, `solar_design_snapshots`, `solar_api_usage_log`, `solar_public_rate_limit`
- FK: `proposals.solar_snapshot_id`

## FAÇA
Reusar `_shared/solar/*` · respeitar flags + rate limit · mock se sem `GOOGLE_SOLAR_API_KEY`

## NÃO FAÇA
Ligar widget público em massa · expor `solar-hd-probe` sem rate · misturar com portal/cadência WA
