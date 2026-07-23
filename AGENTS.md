# AGENTS.md — instruções para o agente (Kiro / qualquer IDE)

Markdown puro (padrão [AGENTS.md](https://agents.md/)). Sem YAML de inclusion — o Kiro **sempre** carrega este arquivo.

Responda em **pt-BR**. Você NÃO recebe automaticamente as `.cursor/rules` do Cursor; use `.kiro/steering/`.

## Setup / checks
- Dev: `npm run dev` · Build: `npm run build` · Types: `npm run typecheck` · Test: `npm test`
- Deploy edges: ver `#deploy` / `.kiro/steering/deploy.md` (GitHub Actions em `tvmensal2025/igreen-page-magic`)

## Protocolo antes de editar
1. Domínio: WA | cadência | portal | Club | sync | Meta/rodízio | CRM | voz | ads UI | front
2. Reuse helper canônico — ver `#helpers-canonicos`
3. Não apagar migrations/toggles/guardas; não ligar massa/motor novo sem pedido
4. Envio real → preferir `dryRun`

## Always-on (já injetados pelo Kiro)
`regras-duras` · `armadilhas` · `product` · `tech` · `structure` · `idioma` · `helpers-canonicos`

## Sob demanda (digite `#nome` ou `/` no Kiro)
| Steering | Quando |
|---|---|
| `#banco` `#edge-functions` `#fluxos` | Schema, edges, jornadas |
| `#portal2-fluxo-canonico` `#club-api-oficial` `#igreen-sync-oficial` | Workers iGreen |
| `#cerebro-mg-e-rodizio` `#ads-contraste` `#wallet-stripe` | Ads / Cérebro / carteira |
| `#pos-venda` `#flow-engine-v3` `#minio-storage` | Pós-venda WA, motor v3, mídia |
| `#solar-3d` `#remote-support` | Telhado Google Solar, suporte remoto |
| `#nomes-e-tema` `#convencoes` `#rotas-ui` `#deploy` | Nomes/tema, código, UI, deploy |
| `#security-auth` | Auth edges / CORS / verify_jwt |

## Kill switch
`app_settings.bot_global_enabled` → `_shared/bot/global-flag.ts` → UI `BotGlobalKillSwitch`  
Rollback: `live_dispatch` → `daily_reheat.enabled` → `cadence_engine` → `bot_global`
