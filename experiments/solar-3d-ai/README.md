# experiments/solar-3d-ai — Sandbox (vazio por enquanto)

# experiments/solar-3d-ai — implementado (ver src/features/solar-3d)

Pasta de spike + fixtures. Código de produção em `src/features/solar-3d/`.

## Ativar em produção

1. `supabase db push` (migration `20260624120000_solar_3d_module.sql`)
2. Secrets: `GOOGLE_SOLAR_API_KEY` (ou `GOOGLE_MAPS_API_KEY`)
3. Deploy functions: `solar-geocode`, `solar-roof-analyze`, `solar-design-get`, `solar-design-public`, `solar-roof-public`, `solar-roof-context`
4. SQL: `UPDATE consultants SET solar_3d_enabled = true WHERE id = '...'`
5. Captação pública: `solar_public_widget_enabled = true`

Modo mock (sem Google): `SOLAR_USE_MOCK=true` nas edge functions.

