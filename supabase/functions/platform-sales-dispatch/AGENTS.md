# AGENTS — platform-sales-dispatch

SuperAdmin · venda da plataforma a consultores.

## Regras

- Tabelas próprias: `platform_sales_*`.
- Isolado de cadência / Cérebro / pós-venda de **clientes**.
- dryRun default; LIVE só com SA + bot_global.

## Demo pós-venda (após D0 WA)

- CTA 2 botões (`ps_demo_yes` / `ps_demo_later`) → `demo_flow_state=cta_sent`
- Menu 1–8 = texto numerado (Whapi max 3 botões)
- Inbound: `_shared/platform-sales-demo-handler.ts` no `whapi-webhook` (early, após dedup)
- Roteiros: `pos_venda_default_media` + `applyOutboundTemplateVars` (nome demo Maria)
