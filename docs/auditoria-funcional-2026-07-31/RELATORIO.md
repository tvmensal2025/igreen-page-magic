# Relatório de Revisão Funcional e Casos de Borda — 31/07/2026

Auditoria read-only sobre o código real (arquivo:linha), em 4 frentes paralelas + validação automatizada.

## 0. Validação automatizada (executada nesta rodada)

| Verificação | Resultado |
|---|---|
| `tsc/tsgo --noEmit` (typecheck) | exit 0 — 0 erros |
| Vitest (frontend/libs) | 84 arquivos, **662 testes OK**, 0 falhas (6 skips) |
| Deno (edge functions) | 1584 testes OK na última rodada completa |

Testes verdes = contrato de código correto. Não cobrem infra externa (Velip, Whapi/Evolution, Meta, Easy Panel).

---

## 1. DASHBOARD / CRM / CLIENTES / BASE DE CLIENTES

| Função | Local | Casos de borda checados | Status |
|---|---|---|---|
| refresh de sessão | `useAnalytics.ts:84` | JWT expirando, falha de refresh | VALIDADO (erro engolido, sem log) |
| `fetchScopedRows` paginado | `useAnalytics.ts:105` | >10k linhas, erro RPC | VALIDADO |
| merge carteira iGreen | `useAnalytics.ts:225` | `.in()` grande (batches 300), duplicidade | VALIDADO |
| `avgKw`, `conversionRate`, `pctChange` | `useAnalytics.ts:341/400/456` | divisão por zero | VALIDADO |
| `weeklyNewCustomers` | `useAnalytics.ts:379` | data futura / clock skew | VALIDADO (descarta em silêncio) |
| perfil ausente | `useAnalytics.ts:150` | consultor sem `igreen_id` | **PROBLEMA** — dashboard zera sem aviso |
| `fetchDeals` | `useKanbanDeals.ts:25` | erro Supabase/RLS | **PROBLEMA CRÍTICO** — `error` ignorado |
| filtro origem no Kanban | `useKanbanDeals.ts:29` | `igreen_sync` nunca vira card | VALIDADO (regra canônica) |
| leads sintéticos | `useKanbanDeals.ts:44` | duplicação ao paginar | VALIDADO |
| `moveDeal` | `useKanbanDeals.ts:109` | deal inexistente, erro de update, rollback | VALIDADO |
| `reclassifyAsReal` | `useKanbanDeals.ts:165` | insert duplicado | VALIDADO (regex frágil) |
| `resolveNames` | `useKanbanDeals.ts:88` | lista grande sem batch | PROBLEMA (médio) |
| `sendAutoMessages` | `KanbanBoard.tsx:63` | sem instância, sem jid, msgs off | VALIDADO (4 guardas) |
| `handleDrop`/`confirmDrop` | `KanbanBoard.tsx:136` | mesma coluna, drop nulo | VALIDADO |
| filtro "meus clientes" | `CustomerManager.tsx:97` | settings ainda carregando | **PROBLEMA ALTO** — mostra todos até carregar |
| dedupe telecom | `CustomerManager.tsx:170` | telefone vazio colide na chave | PROBLEMA ALTO |
| queries telecom/seguros | `CustomerManager.tsx:103` | `.limit(2000)` sem paginação | PROBLEMA MÉDIO |
| `handleSyncIgreen` | `CustomerManager.tsx:225` | WAF, credencial inválida, timeout, cooldown | VALIDADO |
| pós-sync async | `CustomerManager.tsx:255` | unmount durante espera | PROBLEMA MÉDIO |
| `normalizePhone` / `mapStatus` | `customerUtils.ts:103/117` | 8 ou 13+ dígitos; status novo do portal | PROBLEMA MÉDIO/BAIXO |

## 2. FINANCEIRO / VENDA DA PLATAFORMA / SUPERADMIN / PRODUTOS E VENDAS / CONFIGURAÇÕES

| Função | Local | Casos de borda | Status |
|---|---|---|---|
| `wallet-create-topup` | :14-62 | sem Stripe key, sem auth, valor fora de R$50–5.000 | VALIDADO |
| `wallet-manual-credit` approve | :64-121 | duplo clique / replay do mesmo `request_id` | **PROBLEMA CRÍTICO** — update sem `.eq("status","pending")` → crédito duplicado (confirmado na leitura) |
| `wallet-manual-credit` reject | :54-62 | rejeitar pedido já aprovado | PROBLEMA MÉDIO |
| webhook Stripe (checkout) | :31-80 | assinatura inválida (401), falha ao ler fee | VALIDADO; idempotência depende da RPC |
| webhook Stripe (refund) | :84-109 | transação original ausente | **PROBLEMA ALTO** — estorno ignorado sem alerta |
| kill switch no dispatch | `platform-sales-dispatch:265` | falha de leitura de `app_settings` | **PROBLEMA ALTO** — fail-open |
| supressão de contato | `platform-sales-dispatch:414` | DNC no loop de envio | VALIDADO (confirmado: `assertCanContact` é chamado) |
| auth do dispatcher | :179-191 | sem JWT / não superadmin | VALIDADO (401/403) |
| `BotGlobalKillSwitch` | `.tsx:65/106` | erro de leitura, RLS bloqueando update (0 linhas) | VALIDADO (não mostra estado falso) |
| suporte remoto accept/verify/end | edge `remote-support-*` | duplo aceite, brute force de código, expiração, autorização | VALIDADO; broadcast falho trava sessão (MÉDIO) e `SESSION_MAX_DURATION_MS` sem watchdog (MÉDIO) |
| esteira `reorderStages` | `produtos/esteira/api.ts:90` | falha no meio da reordenação | PROBLEMA MÉDIO (não transacional) |
| esteira `setStageStatus` | :148 | pular etapas fora de ordem | PROBLEMA MÉDIO |
| anexos upload/remove | :183/215 | rollback best-effort, órfãos no bucket | PROBLEMA BAIXO |

## 3. WHATSAPP / AGENDAMENTOS / CAPTAÇÃO / PARCEIRO

| Função | Local | Casos de borda | Status |
|---|---|---|---|
| `isBotGloballyEnabled` | `_shared/bot/global-flag.ts:17` | linha ausente, erro RPC, cache 5s | VALIDADO (fail-open **por decisão**) |
| dedupe inbound | `_shared/bot/dedupe.ts:45` | `message_id` nulo, erro de rede | VALIDADO (fail-open documentado) |
| `checkSendQuota` | `_shared/anti-ban.ts:32` | erro RPC → fail-closed, ramp, recovery | VALIDADO |
| auto-limpeza `disconnect_fatal` | `anti-ban.ts:44` | status desatualizado após ban | PROBLEMA MÉDIO |
| `awaitOutboundSendQuota` | `anti-ban.ts:132` | espera 25s por mensagem em lote | PROBLEMA MÉDIO (performance) |
| canal por consultor | `channel-sender.ts:91/374` | Whapi só superadmin, instância bloqueada, failover | VALIDADO |
| `send-scheduled-messages` | index.ts:31 | claim com SKIP LOCKED, retry 3x, DNC, canal ausente | VALIDADO |
| bypass de quota Whapi | :199-225 | `rpc_error` genérico também bypassa | PROBLEMA BAIXO |
| timeline de agendamentos | `agendamentosHub.ts:296` | 8 fontes, dedupe reheat×cadência (2h) | VALIDADO |
| `capture-extract` | index.ts:27 | ownership antes de efeito, JSON inválido da IA | VALIDADO; auto-apply ≥0.85 sem trilha de auditoria (MÉDIO) |
| `finalize-capture` | index.ts:128 | idempotência, origem `igreen_sync`, docs ilegíveis, IDOR | VALIDADO |
| aviso WhatsApp do finalize | :106-122 | fallback Whapi sem `checkSendQuota` | PROBLEMA MÉDIO |
| `ocr-review-timeout` | index.ts:27 | dispatch falho não retentado | PROBLEMA BAIXO |
| rodízio atômico | `_shared/rodizio-assign.ts:81` | pool vazia, conflito de campanha, tenant | VALIDADO |
| portal `/p/:token` | `PartnerBannerPortalPage.tsx:28` | token vazio, not_found, noindex, PII mascarada | VALIDADO |
| criar parceiro | `useReferralPartners.ts:55` | colisão de `short_code` (retry 3x) | VALIDADO |

## 4. ANÚNCIOS / LINKS / MATERIAIS / ÁUDIO / LIGAÇÕES / ACADEMIA / AJUDA

| Função | Local | Casos de borda | Status |
|---|---|---|---|
| waste guard campanha/ad | `campaign-waste-guard.ts:43/73` | spend em centavos, 0 conversas, 0 cliques | VALIDADO; idade mínima só no caller (MÉDIO) |
| import Meta | `meta-ads-import:44/96` | 5xx com backoff, 401/403 sem retry, conta desconectada (412) | VALIDADO; **sem tratamento de 429** (MÉDIO) |
| Links dashboard | `LinksDashboard.tsx:89/175` | >1000 linhas paginadas, zero visitas | VALIDADO |
| resolver consultor por slug | `LinksTab.tsx:76` | falha silenciosa | PROBLEMA BAIXO |
| materiais | `MaterialsTab.tsx:19` | catálogo vazio | PROBLEMA BAIXO |
| `admin-send-material` | index.ts:39 | telefone 10–13 dígitos, URL inválida, quota 423, instância ausente | VALIDADO |
| TTS ElevenLabs | `wa-audio-stitch.ts:149` | texto 2–500, key ausente, timeout 90s, áudio <256 bytes | VALIDADO |
| cache de stitch | :339-430 | frescor vs intro/corpo | VALIDADO (alta complexidade) |
| normalização Velip | `velip.ts:59` | 9º dígito, fixo 12 dígitos | PROBLEMA MÉDIO (fixo pode virar chamada morta) |
| SMS em lote | `voice-sms-send:147` | lote >200 bloqueado; **DNC limitado a 5000** | PROBLEMA MÉDIO |
| render SMS | :29 | sem nome, link wa.me | VALIDADO |
| Academia | `useAcademyProgress.ts:32` | limpar cache / trocar de aparelho | **PROBLEMA ALTO** — progresso só em `localStorage` |
| Central de Ajuda | `AjudaPage.tsx:28` | erro no fetch → fallback estático | VALIDADO |

---

## 5. Problemas priorizados (ação recomendada)

### P0 — corrigir já
1. `useKanbanDeals.fetchDeals` ignora `error` → Kanban vazio silencioso em falha de RLS/rede.
2. `wallet-manual-credit`: aprovar sem checar `status='pending'` permite crédito duplicado.
3. `platform-sales-dispatch`: kill switch fail-open quando a leitura de `app_settings` falha.

### P1 — alto
4. `CustomerManager` mostra todos os clientes enquanto `myClientsSettings` carrega.
5. Estorno Stripe sem transação original é ignorado sem alerta.
6. Dedupe de telecom colide em telefone vazio.
7. Academia sem persistência em banco (perda de progresso/certificado).
8. `voice-sms-send`: supressão DNC truncada em 5000 registros.

### P2 — médio
9. `resolveNames` sem batch; `.limit(2000)` em telecom/seguros; pós-sync sem cleanup.
10. `reorderStages` não transacional; `setStageStatus` sem ordem de etapas.
11. Auto-limpeza de `disconnect_fatal`; `awaitOutboundSendQuota` bloqueante.
12. Fallback Whapi do `finalize-capture` fora do anti-ban; `capture-extract` sem trilha de auditoria.
13. Import Meta sem tratar 429; idade mínima do waste guard só no caller.
14. Suporte remoto: broadcast falho trava sessão; sem watchdog de expiração.

### P3 — baixo (dívida/UX)
`normalizePhone`/`mapStatus` silenciosos, regex de erro do Postgres, CORS amplo do dispatch, falhas silenciosas em Links/Materiais/Ajuda, templates de SMS só no `localStorage`, órfãos de storage na esteira.

## 6. Cobertura e lacunas
Não auditados linha a linha nesta rodada: `wa-audio-stitch.ts` 500–1329, `velip.ts` 452–627, `meta-ads-import` 120–278, `helpCatalog.ts`, `academyCatalog.ts` e as policies RLS da esteira de vendas. Nenhuma alteração de código foi feita nesta auditoria.
