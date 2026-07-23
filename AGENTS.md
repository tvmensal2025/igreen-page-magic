# AGENTS.md — instruções para o agente (Kiro / qualquer IDE)

Markdown puro (padrão [AGENTS.md](https://agents.md/)). Sem YAML de inclusion — o Kiro **sempre** carrega este arquivo.

Responda em **pt-BR**. Você NÃO recebe automaticamente as `.cursor/rules` do Cursor; use `.kiro/steering/`.

## Como usar este pacote de documentação

1. **Sempre carregado:** `regras-duras`, `armadilhas`, `product`, `tech`, `structure`, `idioma` — leia primeiro se estiver em dúvida.
2. **Sob demanda:** todos os demais arquivos em `.kiro/steering/`. Ative com `#nome` no chat, ou o Kiro pode ativar sozinho via `inclusion: auto`.
3. **Mapa rápido tarefa→arquivo:** `#mapa-tarefas`.
4. **Glossário de siglas do projeto:** `#glossario`.
5. **Antes de qualquer edição real de código, siga o Protocolo abaixo.**

## Setup / checks

- Dev: `npm run dev` · Build: `npm run build` · Types: `npm run typecheck` · Test: `npm test`
- Deploy edges: ver `#deploy` / `.kiro/steering/deploy.md` (GitHub Actions em `tvmensal2025/igreen-page-magic`)

## Protocolo antes de editar (obrigatório)

1. **Classifique o domínio** do pedido — um só destes:
   `WA` · `cadência A/B/C` · `portal` · `Club` · `sync carteira` · `Meta/rodízio` · `CRM` · `voz/SMS` · `ads UI` · `front/tema` · `wallet` · `pós-venda` · `esteira multi-produto` · `motor flow v3` · `solar 3D` · `suporte remoto`
2. **Carregue o steering do domínio** (tabela abaixo) + `#helpers-canonicos` + `#banco` se mexer em dados.
3. **Reuse helper canônico** — nunca reimplementar nome do cliente, nome do consultor, classificação CRM/lead, telefone BR, cadência stage map, campanha UUID, kill switch.
4. **Não apagar** migrations, toggles, guardas, flags, edges “mortas”. Se estiver errado, **conserte**.
5. **Não ligar** motor ou envio em massa novo sem pedido explícito do usuário; E2E com envio real → `dryRun` primeiro.
6. **Kill switch:** `app_settings.bot_global_enabled` via `_shared/bot/global-flag.ts` (`isBotGloballyEnabled`) + UI `BotGlobalKillSwitch`. Rollback: `live_dispatch` → `daily_reheat.enabled` → `cadence_engine` → `bot_global`.

## Árvore de decisão rápida

| Pergunta que o usuário está fazendo | Ative primeiro |
|---|---|
| “por que o lead não recebeu / recebeu errado?” | `#fluxos` `#armadilhas` `#banco` |
| “mude texto/áudio da cadência B ou C” | `#fluxos` `#helpers-canonicos` + `src/lib/multichannelCadenceTexts.ts` |
| “cadastro no portal falhou” | `#portal2-fluxo-canonico` `#fluxos` |
| “Club deu erro” | `#club-api-oficial` |
| “carteira/consumo iGreen não bateu” | `#igreen-sync-oficial` |
| “rodízio / atribuição de campanha errada” | `#cerebro-mg-e-rodizio` `#fluxos` (jornada 1) |
| “anúncio Meta / métricas / waste” | `#ads-contraste` `#cerebro-mg-e-rodizio` |
| “consultor sem saldo / Stripe” | `#wallet-stripe` |
| “mídia (áudio/imagem/vídeo) não subiu” | `#minio-storage` |
| “bot ignorou etapa / motor v3” | `#flow-engine-v3` `#armadilhas` |
| “mudar rota, tema, cor, sidebar” | `#rotas-ui` `#nomes-e-tema` |
| “edge/CORS/JWT/cron auth” | `#security-auth` `#edge-functions` `#convencoes` |
| “code review / novo arquivo” | `#convencoes` `#structure` |
| “deploy / GitHub Actions” | `#deploy` |
| “onde fica o schema/coluna X” | `#banco` |
| “esteira de venda vs pós-venda WA” | `#esteira-multiproduto` `#pos-venda` |
| “telhado solar 3D” | `#solar-3d` |
| “suporte remoto / código de acesso” | `#remote-support` |

## Regras invioláveis (resumo — detalhe em `#regras-duras`)

- **Whapi é canal primário**, Evolution é legado; `whatsapp_instances.needs_reconnect` **não** significa Zap offline.
- **Campanha/rodízio = UUID** (`facebook_campaigns.id` → `customers.source_campaign_id`), nunca cidade/texto/keyword.
- **CRM em análise ≠ lead em conversa ≠ Meta em análise** — sempre usar `src/lib/crmVsLeadAnalysis.ts`.
- **Nome do cliente** só quando fonte for confiável (`safeFirstNameForAddress`). Na dúvida, sem “Oi Nome”.
- **Nome do consultor ao lead** via `resolvePublicConsultantLabel` (nunca `display_name || name` cru).
- **Protocolo `2026-####`** existe só no banco/admin — nunca appendar em mensagem WA.
- **Portal 2 é o único cadastro vivo** (Portal 1 morto 2026-06); Club e Sync têm workers separados.
- **Caps outreach A/B/C** (`daily_reheat_settings`):
  - **A = ilimitado** (inbound, bypass total, não conta no global)
  - **B = `cap_b`** (default 150) — reengajamento
  - **C = `cap_c`** (default 50) — RECALL_*
  - **Global B+C = `cap_global_outreach`** (default 200) — teto anti-ban
  - Excedeu → adia p/ próxima manhã BRT (nunca descarta). Alertas 60/85/100 % em `automation_skip_log`.

## Steering — índice completo

Todos ficam em `.kiro/steering/`. `always` já vem carregado; `auto` é ativado por regra; `manual` só quando você chamar com `#`.

| Arquivo | Modo | Quando usar |
|---|---|---|
| `regras-duras` | always | Regras invioláveis com sinônimos “FAÇA/NÃO FAÇA” |
| `armadilhas` | always | Sintoma → correção; leia antes de “consertar” algo |
| `product` | always | Personas, jornadas, o que o produto **não** é |
| `tech` | always | Stack, integrações preferidas, o que não introduzir |
| `structure` | always | Onde colocar cada tipo de arquivo |
| `idioma` | always | Sempre pt-BR |
| `mapa-tarefas` | auto | Tarefas comuns → arquivos exatos a editar |
| `glossario` | manual | Siglas e termos internos (Fluxo B, Sofia, Cérebro, A/B/C…) |
| `helpers-canonicos` | auto | Helpers `_shared` e `src/lib` — reuse antes de reimplementar |
| `banco` | auto | Tabelas críticas, chaves, padrões de query |
| `edge-functions` | auto | Padrões edge Deno |
| `fluxos` | auto | Jornadas end-to-end (CTWA → WA → portal → Club → pós-venda) |
| `portal2-fluxo-canonico` | fileMatch portal | Cadastro iGreen oficial |
| `club-api-oficial` | fileMatch club | Club worker |
| `igreen-sync-oficial` | fileMatch sync | Sync carteira (Playwright) |
| `cerebro-mg-e-rodizio` | auto | Escala Meta + waste + broadcast horário do rodízio |
| `rodizio-parceiros-campanha` | fileMatch wizard ads / rodizio | Mecânica do rodízio de PARCEIROS por campanha (RPC `rodizio_assign_lead`) |
| `parceiros-referral` | fileMatch parceiros / qr-phrase / keyword-matcher | Cadastro parceiro, keyword, `short_code`, matching webhook, `notifyPartnerNewLead` |
| `ads-contraste` | auto | UI Ads, waste guard, métricas |

| `wallet-stripe` | fileMatch wallet | Carteira, Stripe, comissão |
| `pos-venda` | fileMatch pos-venda | Pós-venda WA D30–120 |
| `esteira-multiproduto` | fileMatch esteira | Sales / sale_stage_* (≠ pós-venda) |
| `flow-engine-v3` | fileMatch engine v3 | Motor de fluxo novo |
| `minio-storage` | auto | Upload mídia SigV4 + fallback Storage |
| `nomes-e-tema` | auto | Naming e tema dual light/dark |
| `convencoes` | auto | TS strict, erros, auth, CORS, UI |
| `rotas-ui` | auto | Rotas React Router e páginas |
| `deploy` | auto | GitHub Actions, deploy de edges |
| `security-auth` | auto | Auth edges, CORS, verify_jwt |
| `solar-3d` | fileMatch solar | Telhado Google Solar |
| `remote-support` | fileMatch remote | Suporte remoto |

## Se algo faltar

- **Documentação incorreta ou defasada:** conserte o `.kiro/steering/*.md` **na mesma edição** e registre em `AUDITORIA-STEERING.md`.
- **Regra nova estabelecida em conversa com o usuário:** proponha adicionar a `regras-duras` ou `armadilhas` — não deixe a regra viver só no chat.
- **Padrão implícito no código sem doc:** se o Kiro errar por causa disso, isso é lacuna de steering — documente.
