# Revalidação Integral de Funcionalidades e Casos de Borda — 31/07/2026

Auditoria **somente leitura** sobre o código sincronizado com `origin/main` em `db4bf394817bbcb17316e56ab7de5f53e3c60cc5`
(323 commits integrados nesta sessão, 283 arquivos alterados desde `5a5a7cc84`).

Nenhum arquivo de produto foi alterado. Nenhum envio real (WhatsApp/SMS/voz), deploy, migration ou toggle foi acionado.

## Legenda de status

| Status | Significado |
|---|---|
| **TESTADO** | Coberto por suíte automatizada executada nesta rodada |
| **VALIDADO (leitura)** | Guarda/comportamento confirmado no código, com arquivo:linha |
| **RESSALVA** | Funciona, mas com risco residual documentado |
| **NÃO VERIFICÁVEL** | Depende de produção/infra externa indisponível nesta sessão |

---

## 0. Validação automatizada executada agora

| Verificação | Comando | Resultado |
|---|---|---|
| Tipos (frontend + libs) | `npm run typecheck` | **exit 0 — 0 erros** |
| Testes unitários/PBT front | `npm run test` | **84 arquivos, 663 testes OK**, 6 skips, 0 falhas |
| Lint | `npm run lint` | **0 erros**, 1525 warnings (todos `no-explicit-any`) |
| Build de produção | `npm run build` | **sucesso em 1m13s** |
| Edge functions (seleção CI) | `deno test` (lista do CI) | **419 testes OK, 0 falhas** |
| Edge functions (varredura ampla) | `deno test supabase/functions/` | **1585 testes OK, 0 falhas** |
| Drift docs Cursor ↔ Kiro | `scripts/check-agent-docs-drift.sh` | **NÃO EXECUTÁVEL local** — `ripgrep` ausente; o script aborta com exit 1 (fail-closed correto) |

Testes verdes provam contrato de código. **Não** cobrem Velip, Whapi, Meta, Stripe, Easy Panel nem RLS aplicada em produção.

---

## 1. DASHBOARD

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Sessão/refresh de token | `useAnalytics.ts` | JWT expirando, falha de refresh | VALIDADO (leitura) |
| Leitura paginada com escopo | `useAnalytics.ts` | volume alto, erro de RPC | VALIDADO (leitura) |
| Merge da carteira iGreen | `useAnalytics.ts` | `.in()` em lotes, duplicidade | VALIDADO (leitura) |
| Médias e variações | `useAnalytics.ts` | divisão por zero, base vazia | VALIDADO (leitura) |
| Cache de clientes sem PII | `Admin.tsx:310-332` e `:400-414` | hidratação por sessionStorage sem telefone/CPF/e-mail | VALIDADO (leitura) |
| Cancelamento de fetch concorrente | `Admin.tsx:337-347`, `:474` | troca rápida de aba, unmount | VALIDADO (leitura) |
| Deep-link `?tab=` e eventos de navegação | `Admin.tsx` (`useEffect` de `location.search`) | aba inválida, alias legado, limpeza da query | VALIDADO (leitura) |
| Gate de aprovação | `Admin.tsx:511-513` | consultor não aprovado vê só links públicos | VALIDADO (leitura) |
| Consumo dos KPIs | `adminDashboardSurface.ts` | aba persistida inválida | TESTADO (suíte front) |

Ressalva mantida: consultor sem `igreen_id` zera indicadores da carteira sem aviso explícito (P3, UX).

## 2. CRM (leads)

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Carga do funil | `useKanbanDeals.ts:29-46` | **erro de rede/RLS agora exibe toast e não esvazia o quadro** | VALIDADO (leitura) |
| Paginação 400/página | `useKanbanDeals.ts:92-96` | `hasMore`, offset, append | VALIDADO (leitura) |
| Leads sintéticos de teste | `useKanbanDeals.ts:57-90` | duplicação ao paginar, origem não elegível | VALIDADO (leitura) |
| Resolver nomes por telefone | `useKanbanDeals.ts:110-122` | **lotes de 300 + interrupção em erro** | VALIDADO (leitura) |
| Mover/rejeitar negócio | `useKanbanDeals.ts:134+` | deal inexistente, sintético, rollback | VALIDADO (leitura) |
| Classificação dos três "em análise" | `crmVsLeadAnalysis.ts` | `status=pending` ambíguo, DNC, Meta | **TESTADO** (front + Deno) |
| Cliente de carteira fora de A/B/C | `clienteCadenceGuard.ts` / `_shared/cliente-cadence-guard.ts` | carteira, aprovado, pós-venda ativo | **TESTADO** (ambos os lados) |

## 3. CLIENTES — ativos, progressão e conversão

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Kanban pós-venda / clientes ativos | `PosVendaKanban.tsx` (via `Admin.tsx:666-668`) | destaque por `initialCustomerId`, consumo do highlight | VALIDADO (leitura) |
| Progressão de marcos D30–D210 | `pos-venda-auto-progress/index.ts` | marco já enviado, ordem, retentativa | VALIDADO (leitura) |
| Exclusão do pós-venda | `pos-venda-auto-progress/index.ts:127-131` | `pos_venda_invalid=true` nunca dispara | VALIDADO (leitura) |
| Colisão de telefone do sync | `pos-venda-auto-progress/index.ts:141-151`, `:212-216` | duas linhas com mesmo Zap → `skipped_duplicate_phone` idempotente | VALIDADO (leitura) |
| Cockpit de conversão | `ConversaoCockpit.tsx`, `conversao/score.ts`, `stepLabels.ts` | score sem dados, rótulo de step desconhecido | **TESTADO** |
| Drawer de conversão do lead | `ConversaoLeadDrawer.tsx` | lead sem histórico | VALIDADO (leitura) |

## 4. BASE DE CLIENTES

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Filtro "meus clientes" | `CustomerManager.tsx:99-109` | **enquanto as regras carregam, retorna vazio em vez de vazar a base** | VALIDADO (leitura) |
| União energia + telecom/seguros | `CustomerManager.tsx:218-222` | **dedupe ignora telefone < 10 dígitos (fim da colisão por vazio)** | VALIDADO (leitura) |
| Cadeia de filtros (tipo, licenciado, distribuidora, cidade) | `CustomerManager.tsx:370-386` | valor ausente, rótulo composto vazio | VALIDADO (leitura) |
| Sync da carteira iGreen | `CustomerManager.tsx` + `igreenSync.ts` | WAF, credencial inválida, timeout, cooldown | VALIDADO (leitura) |
| Import/export | `CustomerImportExport.tsx` | planilha vazia, coluna ausente | VALIDADO (leitura) |
| Normalização de telefone e status | `customerUtils.ts` | 8/13 dígitos; `mapStatus` não trata toda "assinatura" como pendência (correção no HEAD) | **TESTADO** (`phone.test.ts`) |
| Resolução de cliente vs lead no inbound | `_shared/inbound-customer-resolve.ts` | linha sombra do sync, colisão `igreenCode` | **TESTADO** (suíte Deno) |

## 5. FINANCEIRO

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Painel de boletos/alertas | `financeiro/FinanceiroPanel.tsx`, `useAlertasBoletosCount.ts` | sem boletos, vencimento no limite | VALIDADO (leitura) |
| Recarga Stripe | `wallet-create-topup/index.ts` | sem chave, sem JWT, valor fora da faixa | VALIDADO (leitura) |
| Crédito manual | `wallet-manual-credit/index.ts:68-86` | **duplo clique/replay bloqueado: reserva `status=pending→approved` antes de creditar; 2ª chamada recebe 409** | VALIDADO (leitura) |
| Rejeição de pedido | `wallet-manual-credit/index.ts:56-66` | rejeitar já aprovado → 409 | VALIDADO (leitura) |
| Papel exigido no crédito manual | `wallet-manual-credit/index.ts:26-32` | sem JWT (401), sem papel admin (403) | VALIDADO (leitura) |
| Webhook Stripe | `wallet-stripe-webhook/index.ts:24-28` | assinatura inválida via `constructEventAsync` | VALIDADO (leitura) |
| Estorno/chargeback | `wallet-stripe-webhook/index.ts:84-122` | **estorno órfão agora alerta o superadmin (crítico) em vez de ser engolido** | VALIDADO (leitura) |
| Quitação de débito antes do saldo | `wallet-manual-credit/index.ts:100-130` | débito maior que crédito, carteira inexistente | VALIDADO (leitura) |

## 6. VENDA DA PLATAFORMA (SuperAdmin)

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Gate de acesso na aba | `Admin.tsx:795-800` | consultor comum vê "Acesso restrito" | VALIDADO (leitura) |
| Autorização do dispatcher | `platform-sales-dispatch/index.ts:188-191` | sem JWT (401), não superadmin (403) | VALIDADO (leitura) |
| Kill switch | `platform-sales-dispatch/index.ts:265-274` | **fail-closed: falha de leitura → 503 `kill_switch_unreadable`; desligado → 403** | VALIDADO (leitura) |
| Supressão de contato | `platform-sales-dispatch/index.ts:419-423` | DNC/canal morto por canal (WhatsApp/SMS/voz) | VALIDADO (leitura) |
| CORS restrito por origem | `platform-sales-dispatch/index.ts:42-46` | origem estranha recebe `null` | VALIDADO (leitura) |

## 7. SUPERADMIN

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Kill switch global | `BotGlobalKillSwitch.tsx` | erro de leitura, update sem efeito por RLS | VALIDADO (leitura) |
| Alertas operacionais | `super-admin-alerts/index.ts:109-110` | cron autenticado; sem telefone/token silencia com métrica | VALIDADO (leitura) |
| Saúde de infraestrutura | `InfraHealthPanel.tsx`, `WhatsAppInstanceHealthCard.tsx` | Whapi sem AUTH; Evolution `needs_reconnect` não é tratado como queda | VALIDADO (leitura) |
| Migração de storage | `StorageMigrationPanel.tsx` (novo) | execução parcial, item já migrado | RESSALVA (sem teste automatizado) |
| Reset administrativo de telefone | `20260729032000_admin_hard_reset_phone_soft_delete_dnc.sql:59-61` | **exige `admin` ou super admin; anônimo levanta `unauthorized`** | VALIDADO (leitura) |
| Bloqueio de devtools / modo estrito | `DevToolsBlockToggle.tsx`, `ResolverStrictModeToggle.tsx` | toggle ausente | VALIDADO (leitura) |
| Suporte remoto | `remote-support-accept/index.ts` + `RemoteSupportProvider.tsx` | duplo aceite, código expirado, CORS por allowlist | VALIDADO (leitura) |

## 8. PRODUTOS E VENDAS

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Esteira multiproduto | `features/produtos/esteira/{api,logic}.ts` | ordem de etapas, status inválido | **TESTADO** (`logic.test.ts`) |
| Reordenação de etapas | `esteira/api.ts` | falha no meio da reordenação | RESSALVA (não transacional) |
| Anexos | `esteira/api.ts` | rollback best-effort, órfão no bucket | RESSALVA (P3) |
| Orçamento/proposta pública | `ProposalPublicPage.tsx`, `proposal-public-get`, `proposal-respond` | token inválido/expirado, resposta duplicada | VALIDADO (leitura) |
| Cross-sell | `acompanhamento/crossSellConfig.ts`, `crossSellRule.ts` | elegibilidade, sem consumidor | **TESTADO** (card/manual, sem massa) |
| Agregações de acompanhamento | `acompanhamento/aggregate.ts` | base vazia, valores nulos | **TESTADO** (16 casos) |
| Captura de produto | `produtos/captura/schemas.ts` | payload inválido | **TESTADO** (15 casos) |

## 9. CAPTAÇÃO

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Painel e tiles de documentos | `CaptacaoPanel.tsx`, `CaptureDocumentTiles.tsx` | doc ausente, reenvio | VALIDADO (leitura) |
| Upload de documento | `lib/captacao/uploadCaptureDoc.ts` (novo) | falha de upload, tipo inesperado | RESSALVA (sem teste dedicado) |
| URL de mídia da conversa | `captacao/conversationMediaUrl.ts` | URL ausente/expirada | **TESTADO** (5 casos) |
| Extração por IA (OCR) | `capture-extract/index.ts` | ownership antes do efeito, JSON inválido, retries | VALIDADO (leitura) |
| Gate de documentos do Portal 2 | `_shared/cerebro/__tests__/gate-documentos-portal2.test.ts` | doc incompleto não avança | **TESTADO** |
| Conta de luz de valor baixo | `_shared/bot/low-bill-reentry.ts` (novo) | reentrada sem duplicar passo | **TESTADO** (`low-bill-reentry_test.ts`) |
| Finalização do cadastro | `finalize-capture/index.ts` | idempotência, origem `igreen_sync`, IDOR | VALIDADO (leitura) |
| RPCs de captação | `20260731011000_revoke_anon_captacao_rpcs_ownership.sql:15-17` | **anon revogado; só dono ou super admin; service_role preservado** | VALIDADO (leitura) |

## 10. PARCEIRO

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Cadastro/edição de parceiro | `parceiros/PartnerForm.tsx`, `useReferralPartners.ts` | colisão de `short_code` com retry | VALIDADO (leitura) |
| Rodízio por campanha | `_shared/rodizio-assign.ts`, RPC `rodizio_assign_lead` | pool vazia, concorrência, campanha por UUID | VALIDADO (leitura) |
| Atribuição determinística | `_shared/deterministic-campaign-resolver.ts` | ordem ad_id → campanha → ctwa → protocolo | **TESTADO** (suíte Deno) |
| Portal do parceiro `/p/:token` | `PartnerBannerPortalPage.tsx` + RPC `get_partner_banner_portal` | token < 8 chars → `invalid_token`; inativo → `not_found` | VALIDADO (leitura) |
| Dados expostos no portal | `20260730203000_partner_portal_wa_phone_vivo.sql` | retorna agregados e keyword; **sem nome/telefone de cliente** | VALIDADO (leitura) |
| Telefone WhatsApp do consultor | mesma migration, cascata linhas 55-83 | usa chip realmente conectado; nunca `notification_phone` | VALIDADO (leitura) |
| Ciclo/KPIs do portal | `lib/partnerPortalCycle.ts` (novo) | ciclo sem leads, virada de data BRT | **TESTADO** (`partnerPortalCycle.test.ts`) |
| Banner VIVO `/rfd/130392` | `BannerLiveRedirectPage.tsx` | iniciais + ID numérico; ordem antes do catch-all | VALIDADO (leitura) |
| Alertas de banner | `partner-banner-alerts-cron/index.ts:31-32` | cron autenticado, cooldown, abaixo do limiar | VALIDADO (leitura) |

## 11. WHATSAPP

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Kill switch global | `_shared/bot/global-flag.ts` | linha ausente, erro de RPC (fail-open **por decisão**) | **TESTADO** |
| Dedupe de inbound | `_shared/bot/dedupe.ts` (`webhook_message_dedup`) | `message_id` nulo, replay | **TESTADO** |
| Idempotência de outbound | `_shared/channels/*`, `evolution-api_idempotency_test.ts` | reenvio do mesmo evento | **TESTADO** |
| Quota anti-ban | `_shared/anti-ban.ts` | erro de RPC → fail-closed; ramp; recuperação | VALIDADO (leitura) |
| Canal do consultor + failover | `_shared/channel-sender.ts`, `channel-sender-failover_test.ts` (novo) | Whapi primário, instância bloqueada, fallback | **TESTADO** |
| Telefone WA do consultor | `_shared/consultant-wa-phone.ts` + `consultant-wa-phone_test.ts` (novo) | chip Whapi vs Evolution insalubre | **TESTADO** (200 linhas de teste) |
| Gate de conexão na UI | `whatsapp/WhatsAppConnectGate.tsx` (novo) | sem Zap conectado bloqueia ação | VALIDADO (leitura) |
| Namespace de passos | `whapi-webhook/handlers/step-namespace_test.ts` | UUID legado, `flow:`, valores hostis, ping-pong | **TESTADO** (20 casos) |
| Ordem dos motores | `whapi-webhook/index.ts` | V3 sombra → Cérebro → bot-flow legado | VALIDADO (leitura) |
| Grupo A determinístico vs Cérebro | `fluxo-a-bypass` + `classifyCadastroInput` | input esperado não vai para a IA; dúvida livre vai | **TESTADO** (suítes cerebro) |
| Cliente de carteira no inbound | `_shared/cliente-canal-novidades.ts` | não entra no funil de lead | **TESTADO** |
| Kill switch Evolution | `src/test/evolution-kill-switch-{guard,e2e}.test.ts` | desligado não envia | **TESTADO** (13 casos) |
| Mídia | `_shared/media-storage.ts`, `minioUpload.ts` | MinIO fora → fallback Storage; nunca data-URL no banco | VALIDADO (leitura) |

## 12. AGENDAMENTOS

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Timeline multi-motor | `lib/agendamentosHub.ts` | 8 fontes, dedupe reheat×cadência | **TESTADO** (11 casos) |
| Envio agendado | `send-scheduled-messages/index.ts` | claim `SKIP LOCKED`, retry, DNC, canal ausente | VALIDADO (leitura) |
| Agenda humana sem quiet hours | mesma edge | horário noturno não bloqueia agenda humana | VALIDADO (leitura) |
| Canal do agendamento | `lib/scheduleChannel.ts` | canal indisponível | **TESTADO** |
| Painéis do hub | `AgendamentosGrupoAPanel/Motor/ZeroLead/TextosDialog` | lista vazia, texto sem variável | VALIDADO (leitura) |
| Caps de outreach | `cadence-tick/index.ts:1090-1110` | alertas 60/85/100% em `automation_skip_log` | VALIDADO (leitura) |
| Adiamento por quota | `cadence-tick/index.ts:530-541` | **`awaitOutboundSendQuota` + `softDefer`: espera o slot, não marca pessoa como falha** | VALIDADO (leitura) |

## 13. CENTRAL DE ANÚNCIOS

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Métricas Meta | `_shared/meta-insight-actions.ts` | **prioridade, nunca soma de `action_types`** | **TESTADO** |
| Import Meta | `meta-ads-import/index.ts:56-65` | **429 respeita `Retry-After`; 401/403 sem retry; conta desconectada** | VALIDADO (leitura) |
| Waste guard | `_shared/campaign-waste-guard.ts` + `_test.ts` | gasto em centavos, zero conversa/clique | **TESTADO** |
| Elegibilidade de escala | `lib/brainScaleEligibility.ts` | sem âncora/foto | **TESTADO** |
| Wizard e criativos | `ads/steps/StepCreative.tsx`, `adImageLibrary.ts`, `adVideoLibrary.ts` (novo) | mídia inválida, biblioteca vazia | VALIDADO (leitura) |
| Proteção de fetch de imagem | `_shared/safe-image-fetch.ts` | SSRF/host interno | **TESTADO** (CI hardening) |
| Autonomia do Cérebro Ads | `_shared/ad-automation-policy.ts` | `targeting_patch`/`create_object` fora do cron | **TESTADO** |
| Ativação com saldo | `_shared/validate-campaign-activation.ts` | saldo insuficiente/débito | VALIDADO (leitura) |
| Contraste de status na UI | `ads-contraste` + componentes de chip | estado sem cor legível | VALIDADO (leitura) |

## 14. LINKS

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Painel de links e visitas | `LinksTab.tsx`, `LinksDashboard.tsx` | paginação, zero visita | VALIDADO (leitura) |
| Resolver consultor por slug | `LinksTab.tsx` | slug inexistente (falha silenciosa) | RESSALVA (P3) |
| QR / panfleto | `PanfletoModal.tsx`, `PartnerQrCode.tsx`, `flyer*` (novos) | rótulo vazio, telefone sem formato | VALIDADO (leitura) |
| Link curto do parceiro | `partnerShortLink.ts` + edge `qr-redirect` | code ausente, keyword genérica | VALIDADO (leitura) |
| Cópia de link | `Admin.tsx:476` | clipboard indisponível | RESSALVA (sem tratamento de erro) |

## 15. MATERIAIS

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Catálogo | `MaterialsTab.tsx` | catálogo vazio | RESSALVA (P3, aviso fraco) |
| Envio de material | `admin-send-material/index.ts` | telefone 10–13 dígitos, URL inválida, quota 423 | VALIDADO (leitura) |
| Dedupe de biblioteca | `lib/dedupeMediaLibrary.ts` | itens repetidos | **TESTADO** |

## 16. ESTÚDIO DE ÁUDIO

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Gravação/geração | `admin/AudioStudio` | permissão de microfone negada | VALIDADO (leitura) |
| TTS | `_shared/wa-audio-stitch.ts`, `tts-proxy` | texto fora do limite, chave ausente, timeout, áudio curto | VALIDADO (leitura) |
| Junção e cache de áudio | `_shared/wa-audio-stitch_test.ts` | frescor de intro/corpo | **TESTADO** |
| Melhoria de texto para voz | `lib/ttsEnhanceV3.ts` | texto vazio, símbolos | **TESTADO** (12 casos) |
| Áudios de nome (Sofia) | `AdminSofiaNameAudios.tsx`, `regen-a2-audio` | nome sem fonte confiável | VALIDADO (leitura) |
| Nome seguro em áudio | `_shared/customer-display-name.ts` | fonte `whatsapp_profile` não vira saudação | **TESTADO** |

## 17. LIGAÇÕES (voz/SMS)

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Discador e webhook | `voice-dialer-cron`, `voice-dialer-webhook` | IK/EK/CK/BK → auto-DNC; NA → retry | VALIDADO (leitura) |
| SMS em lote | `voice-sms-send/index.ts:167-180` | **supressão DNC por lotes de 100 sobre os destinatários — fim do truncamento em 5000** | VALIDADO (leitura) |
| Entrega ≠ aceite | `voice_sms_log.delivery_status` | `sent` não é `DELIVRD`; `Blocked text#270` permanente | VALIDADO (leitura) |
| Cobertura DNC no outbound | `src/test/outbound-dnc-coverage.test.ts` | canal bloqueado | **TESTADO** |
| Supressão cross-channel | `services/contactSuppression.ts` | telefone morto em outro canal | VALIDADO (leitura) |
| Áudio personalizado | `_shared/voice-dialer/call-stitch.ts` | sem nome confiável → só corpo | VALIDADO (leitura) |
| Autenticação do tick | `20260731070000_voice_dialer_tick_auth_headers.sql` | cron sem header correto | VALIDADO (leitura) |
| Painel de números inválidos | `InvalidPhonesPanel.tsx` | lista vazia | VALIDADO (leitura) |
| Saldo Velip | — | API v2 não expõe saldo; **não existe pause automática** | NÃO VERIFICÁVEL (painel Velip) |

## 18. ACADEMIA

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Progresso de aula | `useAcademyProgress.ts:44-96` | **persistido em `academy_progress` + cache local, com merge pelo melhor resultado** | VALIDADO (leitura) |
| Troca de aparelho / limpeza de cache | mesmo arquivo | progresso não se perde mais (era P1) | VALIDADO (leitura) |
| Não regressão de progresso | `useAcademyProgress.ts:118-131` | só grava quando avança | VALIDADO (leitura) |
| Prova repetida | `setExamResult` | mantém melhor nota e aprovação | VALIDADO (leitura) |
| Usuário deslogado | `upsertRemote` | fica só no cache local | VALIDADO (leitura) |
| Catálogo | `academyCatalog.ts` | ID desconhecido | RESSALVA (não auditado linha a linha) |

## 19. CENTRAL DE AJUDA

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Página de ajuda | `AjudaPage.tsx` | erro de fetch → fallback estático | VALIDADO (leitura) |
| Editor do tour | `AdminTourEditor.tsx`, `TourProvider.tsx` | passo apontando para elemento ausente | VALIDADO (leitura) |
| Suporte por chat | `SupportChatButton.tsx` | oculto por padrão no shell | VALIDADO (leitura) |
| Catálogo de ajuda | `helpCatalog.ts` | busca sem resultado | RESSALVA (não auditado linha a linha) |

## 20. CONFIGURAÇÕES

| Função | Local | Casos de borda validados | Status |
|---|---|---|---|
| Dados do consultor | `DadosTab.tsx`, `useConsultantForm.ts` | foto inválida, salvar sem alteração | VALIDADO (leitura) |
| Identidade e nome da IA | `Admin.tsx:117-149` | evita sobrescrever nome novo com valor velho | VALIDADO (leitura) |
| Prefs de automação | `useConsultantAutomationPrefs.ts`, `consultantAutomationPrefs.ts` | sem linha = tudo desligado; opt-in do Cérebro | **TESTADO** (`automationTemplates.unit.test.ts` + Deno) |
| Conexão WhatsApp | `WhatsAppConnectionSettingsCard.tsx`, `useWhapiHealth.ts` | trocar chip só após desconectar; health por AUTH | VALIDADO (leitura) |
| Conexão/sync iGreen | `IGreenConnectionCard.tsx`, `IGreenSyncStatusBar.tsx` | credencial inválida, sync em andamento | VALIDADO (leitura) |
| Bônus por tier | `BonusTiersAdminCard.tsx`, `entradaBonusTiers.ts` | faixa vazia, tier sem distribuidora | **TESTADO** (5 casos) |
| Troca de senha | `ChangePasswordCard.tsx` | senha fraca, divergente | VALIDADO (leitura) |
| Recuperação de senha | `send-password-reset/index.ts`, `passwordReset.ts`, `ResetPassword.tsx` | resposta genérica anti-enumeração; rate limit 3/15min; fallback nativo | RESSALVA (ver F-02) |

---

## 21. Findings desta rodada

Nenhum **P0** e nenhum **P1** novo foi encontrado. Todos os P0/P1 da auditoria anterior foram confirmados fechados no código (§22).

| ID | Sev. | Área | Achado | Evidência |
|---|---|---|---|---|
| F-01 | **P3** (reclassificado) | Parceiro | RPC `get_partner_banner_portal` é `anon` **por desenho** e sem rate limit. Risco baixo confirmado: token é `randomUUID` de 24 hex (**96 bits**, `PartnerBannersPanel.tsx:297`) e a PII vem mascarada por `mask_first_name` / `mask_phone_br`. Sondagem é inviável; rate limit é higiene | `20260730203000_…wa_phone_vivo.sql:27-38` e `:131-134` |
| F-02 | **P3** (reclassificado) | Auth | `send-password-reset` aceita `redirectTo` para qualquer subdomínio `*.lovable.app`/`.dev`/`lovableproject.com`. **Exploração não fecha na prática**: o retorno usa PKCE `?code=` (`ResetPassword.tsx:4`) e a troca exige o `code_verifier` do navegador original; o allowlist de Redirect URLs do projeto Supabase é uma segunda barreira. Fica como endurecimento defensivo | `send-password-reset/index.ts:20-36` |
| F-03 | P2 | Financeiro | `wallet-create-topup` e `wallet-manual-credit` usam `Access-Control-Allow-Origin: *`. Risco contido porque exigem JWT (e papel admin no crédito manual), mas divergem do padrão `buildCors` | `wallet-manual-credit/index.ts:5-8`; `wallet-create-topup/index.ts:6-9` |
| F-04 | P2 | Produtos | `reorderStages` da esteira segue não transacional: falha no meio deixa ordem parcial | `features/produtos/esteira/api.ts` |
| F-05 | P2 | CI | Nenhum job executa `npm run build`, Playwright/E2E ou testes dos três workers Node; o Deno do CI cobre uma seleção, não as ~210 edges (a varredura ampla desta sessão passou, mas não é obrigatória no CI) | `.github/workflows/ci.yml` |
| F-06 | P3 | Dashboard/Links/Materiais | Falhas silenciosas de UX: consultor sem `igreen_id` zera KPIs; slug inexistente e catálogo vazio sem aviso claro; `copyLink` sem tratamento de erro do clipboard | `Admin.tsx:466-469`; `LinksTab.tsx`; `MaterialsTab.tsx` |
| F-07 | P3 | Qualidade | 1525 warnings `no-explicit-any` mascaram tipagem fraca em serviços sensíveis (ex.: `smartPublish`, `resetConversation`) | saída de `npm run lint` |
| F-08 | P3 | Superadmin | `StorageMigrationPanel` (novo) não tem teste automatizado para execução parcial/reentrada | `superadmin/StorageMigrationPanel.tsx` |

## 22. Achados anteriores — confirmação de fechamento

| Item original | Sev. original | Situação agora | Prova |
|---|---|---|---|
| Kanban esvaziava em erro de RLS/rede | P0 | **FECHADO** | `useKanbanDeals.ts:35-46` |
| Crédito manual duplicável | P0 | **FECHADO** | `wallet-manual-credit/index.ts:68-86` |
| Kill switch do dispatch fail-open | P0 | **FECHADO** | `platform-sales-dispatch/index.ts:265-274` |
| Base inteira exposta durante carregamento | P1 | **FECHADO** | `CustomerManager.tsx:99-109` |
| Estorno Stripe órfão ignorado | P1 | **FECHADO** | `wallet-stripe-webhook/index.ts:109-121` |
| Dedupe telecom colidindo em telefone vazio | P1 | **FECHADO** | `CustomerManager.tsx:220-222` |
| Academia só em `localStorage` | P1 | **FECHADO** | `useAcademyProgress.ts:44-96` |
| DNC do SMS truncado em 5000 | P1 | **FECHADO** | `voice-sms-send/index.ts:167-180` |
| `resolveNames` sem lote | P2 | **FECHADO** | `useKanbanDeals.ts:110-122` |
| Import Meta sem tratar 429 | P2 | **FECHADO** | `meta-ads-import/index.ts:56-65` |
| Quota anti-ban marcando pessoa como falha | armadilha #37 | **FECHADO** | `cadence-tick/index.ts:530-541` |
| Pós-venda duplicando por colisão de telefone | armadilha #43 | **FECHADO** | `pos-venda-auto-progress/index.ts:141-151` |

## 23. Invariantes de negócio reconferidos

| Regra | Status | Prova |
|---|---|---|
| Whapi primário; Evolution `needs_reconnect` não é queda | OK | `channel-sender.ts`, `WhatsAppInstanceHealthCard.tsx` |
| Três "em análise" separados | OK | **TESTADO** `crmVsLeadAnalysis` (front + Deno) |
| Campanha/rodízio por UUID | OK | `deterministic-campaign-resolver.ts` (testado) |
| Nome do cliente só com fonte confiável | OK | `customer-display-name.ts` (testado) |
| Nome público do consultor sem slug | OK | `resolvePublicConsultant.ts`, `consultant-public-label.ts` |
| Protocolo nunca na mensagem WA | OK | `_shared/protocol.ts` + `protocol_test.ts` |
| Caps A ilimitado / B / C / global, com adiamento | OK | `cadence-tick/index.ts:1090-1110` |
| Cliente de carteira fora de A/B/C | OK | **TESTADO** nos dois lados |
| Pós-venda independe de `bot_global` | OK | `pos-venda-auto-progress` usa toggles próprios |
| Agenda humana sem quiet hours | OK | `send-scheduled-messages` |
| Prefs por consultor bloqueiam mesmo com global ON | OK | `consultant-automation-prefs` |
| Cron protegido por `assertCronAuth` | OK nas edges novas | `super-admin-alerts:109`, `partner-banner-alerts-cron:31` |
| Sem `service_role` no frontend | OK | busca em `src/**` sem resultado |

## 24. Lacunas que impedem declarar 100% validado

1. **Sem evidência de produção.** O servidor MCP do Supabase está ativo mas **não expõe ferramentas** nesta sessão: nada de `execute_sql`, `get_advisors`, `get_logs` ou `list_edge_functions`. Pelo protocolo, sem isso **não há GO pleno**.
2. **Sem smoke de UI autenticada.** Nenhuma sessão logada disponível; nenhuma tela foi percorrida em navegador.
3. **Sem verificação de infraestrutura externa.** Health de Portal 2, Club, Sync, MinIO, Whapi, Velip, Meta e Stripe não foi consultado.
4. **Drift de documentação não executado localmente** por falta de `ripgrep` (roda no CI).
5. **Cobertura estática, não comportamental** em: `StorageMigrationPanel`, `uploadCaptureDoc`, `helpCatalog`, `academyCatalog` e trechos longos de `wa-audio-stitch.ts` e `velip.ts`.
6. **RLS real não exercitada.** As políticas foram lidas nas migrations, não testadas contra o banco.

## 25. Veredito

**GO COM RESSALVAS** para operação, condicionado a validação em produção.

O núcleo crítico — dinheiro, kill switches, autorização, anti-ban, DNC, separação lead/cliente e funil determinístico — está íntegro no código, com 663 testes de front, 1585 de edge, tipos limpos e build funcional. Não há P0/P1 aberto.

As ressalvas são de endurecimento (F-01 a F-03), robustez (F-04, F-08) e cobertura de pipeline (F-05), além da ausência de evidência de produção descrita em §24.

## 26. Prioridade sugerida (máximo 5, sem scope creep)

Ordem revisada após conferir entropia do token, mascaramento de PII e fluxo PKCE:
F-01 e F-02 caíram para P3 — são superfícies **públicas por desenho**, com credencial forte
e dados mascarados, não brechas exploráveis.

1. **F-05** — adicionar `npm run build` e a varredura ampla `deno test supabase/functions/` ao CI.
   É o único item que evita regressão futura entrar sem ninguém ver.
2. **F-04** — tornar `reorderStages` atômico (pipeline embaralhado é visível ao consultor).
3. **F-03** — trocar CORS `*` das duas edges de carteira por `buildCors` (padronização; risco contido por JWT).
4. **F-08** — teste de reentrada para `StorageMigrationPanel`.
5. **F-02 / F-01** — endurecimento defensivo, sem urgência.

**Acima de todos:** a lacuna de validação de §24 (produção, RLS real, health dos workers)
pesa mais que qualquer item desta lista.

Nada aqui foi implementado: decisão do humano.
