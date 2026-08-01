# AGENTS.md — instruções para o agente (Kiro / qualquer IDE)

Markdown puro (padrão [AGENTS.md](https://agents.md/)). Sem YAML de inclusion — o Kiro **sempre** carrega este arquivo.

Responda em **pt-BR**. Você NÃO recebe automaticamente as `.cursor/rules` do Cursor; use `.kiro/steering/`.

## Como usar este pacote de documentação

1. **Sempre carregado:** `regras-duras`, `armadilhas`, `product`, `tech`, `structure`, `idioma`, **`cerebro-fluxo-b`** — leia primeiro se estiver em dúvida.
2. **Sob demanda:** todos os demais arquivos em `.kiro/steering/`. Ative com `#nome` no chat, ou o Kiro pode ativar sozinho via `inclusion: auto`.
3. **Mapa rápido tarefa→arquivo:** `#mapa-tarefas`.
4. **Glossário de siglas do projeto:** `#glossario`.
5. **Antes de qualquer edição real de código, siga o Protocolo abaixo.**

## Setup / checks

- Dev: `npm run dev` · Build: `npm run build` · Types: `npm run typecheck` · Test: `npm test`
- Deploy edges: ver `#deploy` / `.kiro/steering/deploy.md` (GitHub Actions em `tvmensal2025/igreen-page-magic`)

## Protocolo antes de editar (obrigatório)

1. **Classifique o domínio** do pedido — um só destes:
   `WA` · `cadência A/B/C` · `portal` · `Club` · `sync carteira` · `Meta/rodízio` · `CRM` · `voz/SMS` · `ads UI` · `front/tema` · `wallet` · `pós-venda` · `esteira multi-produto` · `motor flow v3` · `solar 3D` · `suporte remoto` · `cross-sell` · `agendamentos` · `Cérebro/Fluxo B`
2. **Carregue o steering do domínio** (tabela abaixo) + `#helpers-canonicos` + `#banco` se mexer em dados. Em dúvida: `.kiro/steering/mapa-dominios.json` + `#evidencia-prod`.
3. **Reuse helper canônico** — nunca reimplementar nome do cliente, nome do consultor, classificação CRM/lead, telefone BR, cadência stage map, campanha UUID, kill switch.
4. **Não apagar** migrations, toggles, guardas, flags, edges “mortas”. Se estiver errado, **conserte**.
5. **Não ligar** motor ou envio em massa novo sem pedido explícito do usuário; E2E com envio real → `dryRun` primeiro.
6. **Kill switch:** `app_settings.bot_global_enabled` via `_shared/bot/global-flag.ts` (`isBotGloballyEnabled`) + UI `BotGlobalKillSwitch`. Rollback: `live_dispatch` → `daily_reheat.enabled` → `cadence_engine` → `bot_global`.
   - Exceção documentada: **pós-venda** ignora `bot_global` (usa `pos_venda_auto_messages` + `pos_venda_manual`). Ver `#pos-venda` / `#evidencia-prod`.

## Árvore de decisão rápida

| Pergunta que o usuário está fazendo | Ative primeiro |
|---|---|
| “por que o lead não recebeu / recebeu errado?” | `#erros-operacionais` `#fluxos` `#armadilhas` `#banco` `#evidencia-prod` |
| “Velip sem crédito / SMS não chegou / ligação falhou” | `#erros-operacionais` `#voz-sms` |
| “IA parou / OCR / Easy Panel / Supabase não abre” | `#erros-operacionais` (+ `#wa-webhook` / `#portal2-fluxo-canonico` / `#deploy`) |
| “me avisa quando falhar / alerta WhatsApp” | `#erros-operacionais` §0b · edge `super-admin-alerts` · `_shared/superadmin-alert.ts` |
| “auditoria final Opus / varredura completa plataforma” | `#auditoria-final-opus` · `.cursor/commands/auditoria-final-plataforma.md` · `docs/PROMPT-AUDITORIA-FINAL-OPUS.md` |
| “auditoria design / cores / botões / velocidade / Web Vitals” | `#auditoria-design-velocidade` · `.cursor/commands/auditoria-design-velocidade.md` · `docs/PROMPT-AUDITORIA-DESIGN-VELOCIDADE-OPUS.md` |
| “mude texto/áudio da cadência B ou C” | `#fluxos` `#helpers-canonicos` + `src/lib/multichannelCadenceTexts.ts` |
| “webhook Whapi / Evolution / dedupe / ACK” | `#wa-webhook` |
| “Sofia / Cérebro / Fluxo B / simulador / Grupo A vs IA” | `#cerebro-fluxo-b` (always) · armadilha #36 |
| “ligar Cérebro / modal automações / opt-in” | `#cerebro-fluxo-b` · `src/lib/consultantAutomationPrefs.ts` (`CEREBRO_OPT_IN`) · `ConsultantAutomationPrefsModal` |
| “voz / SMS / Velip / DNC” | `#voz-sms` |
| “hub de agendamentos / agenda manual” | `#agendamentos-hub` |
| “cross-sell / telecom / seguros no card” | `#cross-sell` |
| “cadastro no portal falhou” | `#portal2-fluxo-canonico` `#fluxos` |
| “Club deu erro” | `#club-api-oficial` |
| “carteira/consumo iGreen não bateu” | `#igreen-sync-oficial` |
| “rodízio / atribuição de campanha errada” | `#cerebro-mg-e-rodizio` `#rodizio-parceiros-campanha` `#fluxos` |
| “anúncio Meta / métricas / waste” | `#ads-contraste` `#cerebro-mg-e-rodizio` · `docs/CEREBRO-ADS-OFICIAL.md` |
| “consultor sem saldo / Stripe” | `#wallet-stripe` |
| “mídia (áudio/imagem/vídeo) não subiu” | `#minio-storage` |
| “bot ignorou etapa / motor v3” | `#flow-engine-v3` `#armadilhas` |
| “mudar rota, tema, cor, sidebar” | `#rotas-ui` `#nomes-e-tema` |
| “edge/CORS/JWT/cron auth” | `#security-auth` `#edge-functions` `#convencoes` |
| “RPC anon / SECURITY DEFINER” | `#security-auth` + `.kiro/steering/RPC-ANON-DEFINER-INVENTARIO.md` |
| “code review / novo arquivo” | `#convencoes` `#structure` |
| “deploy / GitHub Actions” | `#deploy` |
| “onde fica o schema/coluna X” | `#banco` |
| “números reais de prod / advisors” | `#evidencia-prod` |
| “posso seguir uma spec .kiro/specs?” | `.kiro/specs/STATUS.md` |
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
- **Cérebro ≠ Grupo A ≠ cadência A/B/C:** funil cadastro determinístico manda; Cérebro só laterais (opt-in `cerebro_ativo` default off). Ver `#cerebro-fluxo-b` / armadilha #36.

## Steering — índice completo

Todos ficam em `.kiro/steering/`. `always` já vem carregado; `auto` é ativado por regra; `manual` só quando você chamar com `#`.

| Arquivo | Modo | Quando usar |
|---|---|---|
| `ads-sql-pendente` | always | Hardening Ads **aplicado** (2026-07-25); arquivo guarda o que NÃO religar sem pedido |
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
| `cerebro-mg-e-rodizio` | auto | Escala Meta + waste + rodízio · canônica `docs/CEREBRO-ADS-OFICIAL.md` |
| `rodizio-parceiros-campanha` | fileMatch wizard ads / rodizio | Mecânica do rodízio de PARCEIROS por campanha (RPC `rodizio_assign_lead`) |
| `parceiros-referral` | fileMatch parceiros / qr-phrase / keyword-matcher | Cadastro parceiro, keyword, `short_code`, matching webhook, `notifyPartnerNewLead` |
| `ads-contraste` | auto | UI Ads, waste guard, métricas |
| `wallet-stripe` | fileMatch wallet | Carteira, Stripe, comissão |
| `pos-venda` | fileMatch pos-venda | Pós-venda WA D30–D210 + retentativa |
| `wa-webhook` | fileMatch whapi/evolution webhook | Contrato inbound Whapi + paridade Evolution |
| `cerebro-fluxo-b` | always | Cérebro × Fluxo B × **Grupo A** (como deve funcionar) |
| `erros-operacionais` | auto | Playbook falhas: Velip crédito/SMS/voz, IA muda, OCR, Easy Panel, Supabase, caps |
| `voz-sms` | fileMatch voice-* / voz UI | Velip, DNC, cross-channel IK/UNDELIV |
| `agendamentos-hub` | fileMatch AgendamentosHub / send-scheduled | Timeline multi-motor; agenda sem quiet hours |
| `cross-sell` | fileMatch crossSell* | Card manual + sombra Cérebro — NÃO massa |
| `esteira-multiproduto` | fileMatch esteira | Sales / sale_stage_* (≠ pós-venda) |
| `flow-engine-v3` | fileMatch engine v3 | Motor de fluxo novo |
| `minio-storage` | auto | Upload mídia SigV4 + fallback Storage |
| `mapa-dominios.json` | manual | Inventário máquina-legível domínio→código→steering |
| `EVIDENCIA-PROD` | manual | Snapshot prod + advisors (números auditados) |
| `AUDITORIA-STEERING` | manual | Histórico de rounds do pack |
| `auditoria-final-opus` | manual | Prompt auditoria final completa (Opus/Kiro) — `#auditoria-final-opus` |
| `auditoria-design-velocidade` | manual | Prompt design+velocidade UI (Opus/Kiro) — `#auditoria-design-velocidade` |
| `nomes-e-tema` | auto | Naming e tema dual light/dark |
| `convencoes` | auto | TS strict, erros, auth, CORS, UI |
| `rotas-ui` | auto | Rotas React Router e páginas |
| `deploy` | auto | GitHub Actions, deploy de edges |
| `security-auth` | auto | Auth edges, CORS, verify_jwt |
| `solar-3d` | fileMatch solar | Telhado Google Solar |
| `remote-support` | fileMatch remote | Suporte remoto |

Specs: leia `.kiro/specs/STATUS.md` antes de seguir qualquer design antigo (várias são Evolution-first / archived).

Nested `AGENTS.md` (Context7: nearest wins):
`whapi-webhook/` · `evolution-webhook/` · `cadence-tick/` · `pos-venda-auto-progress/` · `sync-igreen-customers/` · `_shared/bot/` · `_shared/cerebro/` · `bulk-scheduler/` · `finalize-capture/` · `send-scheduled-messages/` · `voice-dialer-webhook/` · `src/lib/` · `src/components/whatsapp/`.

Protocolo Kiro sugerido no chat: antes de editar, leia `#mapa-dominios` + `#evidencia-prod` (e o steering do domínio).

## Se algo faltar

- **Documentação incorreta ou defasada:** conserte o `.kiro/steering/*.md` **na mesma edição** e registre em `AUDITORIA-STEERING.md`.
- **Regra nova estabelecida em conversa com o usuário:** proponha adicionar a `regras-duras` ou `armadilhas` — não deixe a regra viver só no chat.
- **Padrão implícito no código sem doc:** se o Kiro errar por causa disso, isso é lacuna de steering — documente.
