# 03 — Inventário de funções — Workers

**Método:** AST TypeScript (ScriptKind.JS) sobre `.mjs/.js/.ts` dos workers.
**Data:** 2026-07-16

## Resumo

| Métrica | Valor |
|---|---:|
| Arquivos varridos | 39 |
| Funções catalogadas | 274 |
| Export named | 35 |
| Internas | 239 |
| Async | 103 |

| Worker | Arquivos | Funções |
|---|---:|---:|
| worker-portal-2 | 29 | 163 |
| worker-club | 8 | 34 |
| worker-igreen-sync | 1 | 73 |
| compress-worker | 1 | 4 |

## worker-portal-2 (163 funções)

- **package:** `worker-portal-2-igreen` @ 1.0.0
- **main:** `server.mjs`
- **scripts:** start, dev
- **deps:** @supabase/supabase-js, bullmq, dotenv, express, playwright-chromium, ws

| Arquivo | Nome | Linhas | Tipo | Export | Async | Deps |
|---|---|---|---|---|---|---|
| worker-portal-2/_audit-bonus.mjs | rules | 4-14 | function | interna | sim | - |
| worker-portal-2/_audit-healthcheck.mjs | step | 10-25 | function | interna | sim | - |
| worker-portal-2/_probe-cadastro-fluxo.mjs | interesting | 21-23 | function | interna | nao | otp_captcha |
| worker-portal-2/_probe-cadastro-fluxo.mjs | dump | 70-98 | function | interna | sim | playwright|session_or_screenshot |
| worker-portal-2/_probe-cadastro-fluxo.mjs | clickIf | 146-161 | function | interna | sim | playwright |
| worker-portal-2/_probe-fatura-real-ui.mjs | waitForApi | 74-83 | function | interna | sim | playwright |
| worker-portal-2/_probe-fatura-real-ui.mjs | shot | 85-91 | function | interna | sim | playwright|session_or_screenshot |
| worker-portal-2/_probe-fatura-real-ui.mjs | clickSafe | 93-109 | function | interna | sim | playwright |
| worker-portal-2/_probe-fatura-real-ui.mjs | waitBillApi | 191-200 | function | interna | sim | playwright |
| worker-portal-2/_truth-real-cadastro.mjs | fetchUrlAsFile | 31-40 | function | interna | sim | - |
| worker-portal-2/_truth-real-cadastro.mjs | sb | 42-48 | function | interna | sim | supabase|secret_auth |
| worker-portal-2/ai-audit.mjs | analyzeWithGemini | 17-62 | function | named | sim | supabase|secret_auth |
| worker-portal-2/ai-audit.mjs | checkAuditHealth | 68-99 | function | named | sim | supabase|secret_auth |
| worker-portal-2/ai-audit.mjs | sanitize | 106-137 | function | named | nao | - |
| worker-portal-2/ai-audit.mjs | runAuditPipeline | 143-213 | function | named | sim | supabase |
| worker-portal-2/ai-audit.mjs | getAuditCount | 219-231 | function | named | sim | supabase |
| worker-portal-2/portal-errors.mjs | countInvoiceLegibleFields | 94-97 | function | named | nao | - |
| worker-portal-2/portal-errors.mjs | classifyPortalError | 120-184 | function | named | nao | - |
| worker-portal-2/portal-errors.mjs | buildExtractionResult | 249-277 | function | named | nao | - |
| worker-portal-2/portal-errors.mjs | evaluateIaGate | 295-400 | function | named | nao | - |
| worker-portal-2/portal-errors.mjs | normalizePhone | 404-406 | function | named | nao | - |
| worker-portal-2/portal-errors.mjs | normalizeInstallation | 409-411 | function | named | nao | - |
| worker-portal-2/portal-errors.mjs | normalizeEmail | 414-416 | function | named | nao | - |
| worker-portal-2/portal-phone.mjs | digitsOnlyPhone | 15-17 | function | named | nao | - |
| worker-portal-2/portal-phone.mjs | toNationalPhoneDigits | 19-27 | function | named | nao | - |
| worker-portal-2/portal-phone.mjs | toWhatsappCanonical | 29-33 | function | named | nao | - |
| worker-portal-2/portal-phone.mjs | formatBrLandline | 35-40 | function | named | nao | - |
| worker-portal-2/portal-phone.mjs | isValidBrNationalPhone | 42-47 | function | named | nao | - |
| worker-portal-2/portal-phone.mjs | resolvePortalWhatsapp | 49-59 | function | named | nao | - |
| worker-portal-2/portal2-api-client.mjs | signRequest | 33-42 | function | named | nao | secret_auth |
| worker-portal-2/portal2-api-client.mjs | _ensurePage | 51-67 | function | interna | sim | playwright |
| worker-portal-2/portal2-api-client.mjs | closeBrowser | 69-73 | function | named | sim | playwright |
| worker-portal-2/portal2-api-client.mjs | _fetch | 347-392 | function | interna | sim | playwright|secret_auth |
| worker-portal-2/portal2-api-client.mjs | _fetchMultipart | 398-464 | function | interna | sim | playwright|secret_auth |
| worker-portal-2/portal2-api-client.mjs | documentLookup | 472-481 | function | interna | sim | - |
| worker-portal-2/portal2-api-client.mjs | viacep | 503-511 | function | interna | sim | - |
| worker-portal-2/portal2-api-client.mjs | resolveConcessionaria | 547-625 | function | interna | sim | - |
| worker-portal-2/portal2-api-client.mjs | resolveConcessionariaByCep | 641-659 | function | interna | sim | - |
| worker-portal-2/portal2-api-client.mjs | cadastrarCliente | 890-1270 | function | interna | sim | - |
| worker-portal-2/portal2-api-client.mjs | runValidate | 928-951 | function | interna | sim | - |
| worker-portal-2/portal2-api-client.mjs | tryUploadOne | 1049-1077 | function | interna | sim | - |
| worker-portal-2/portal2-api-client.mjs | fileFromPath | 1341-1350 | function | named | nao | - |
| worker-portal-2/probe-doc-field.mjs | signRequest | 32-41 | function | interna | nao | secret_auth |
| worker-portal-2/probe-doc-field.mjs | fetchFront | 52-57 | function | interna | sim | supabase|secret_auth |
| worker-portal-2/probe-doc-field.mjs | main | 59-112 | function | interna | sim | playwright |
| worker-portal-2/probe-extraction-mode.mjs | fetchCustomer | 113-136 | function | interna | sim | supabase|secret_auth |
| worker-portal-2/probe-extraction-mode.mjs | fetchIgreenId | 139-148 | function | interna | sim | supabase|secret_auth |
| worker-portal-2/probe-extraction-mode.mjs | runExtractor | 153-160 | function | interna | sim | - |
| worker-portal-2/probe-extraction-mode.mjs | main | 176-291 | function | interna | sim | - |
| worker-portal-2/probe-extractor.mjs | fetchCustomer | 68-91 | function | interna | sim | supabase|secret_auth |
| worker-portal-2/probe-extractor.mjs | fetchIgreenId | 94-103 | function | interna | sim | supabase|secret_auth |
| worker-portal-2/probe-extractor.mjs | main | 107-210 | function | interna | sim | - |
| worker-portal-2/server.mjs | authRequired | 65-71 | function | interna | nao | secret_auth |
| worker-portal-2/server.mjs | sendValidationLinkToCustomer | 102-110 | function | interna | sim | - |
| worker-portal-2/server.mjs | sendFacialLinkToCustomer | 116-124 | function | interna | sim | - |
| worker-portal-2/server.mjs | sendCorrectionRequestToCustomer | 135-139 | function | interna | sim | - |
| worker-portal-2/server.mjs | _sendMessageToCustomer | 145-213 | function | interna | sim | supabase|secret_auth |
| worker-portal-2/server.mjs | processLead | 216-536 | queue_worker | interna | sim | bullmq|playwright|supabase|otp_captcha |
| worker-portal-2/server.mjs | buildRedisConn | 539-552 | queue_worker | interna | nao | bullmq|redis |
| worker-portal-2/server.mjs | initQueue | 558-588 | queue_worker | interna | sim | bullmq|playwright|redis |
| worker-portal-2/server.mjs | _downloadToFile | 836-853 | function | interna | sim | - |
| worker-portal-2/server.mjs | _resolveCustomerFile | 857-864 | function | interna | sim | - |
| worker-portal-2/server.mjs | ensureDocumentsAttachedAndGate | 881-937 | function | interna | sim | supabase |
| worker-portal-2/server.mjs | fetchDadosFromSupabase | 940-1176 | function | interna | sim | supabase|object_storage |
| worker-portal-2/server.mjs | main | 1407-1440 | queue_worker | interna | sim | bullmq|supabase|otp_captcha|secret_auth |
| worker-portal-2/server.mjs | shutdown | 1444-1450 | function | interna | sim | - |
| worker-portal-2/test/best-effort-persist.test.mjs | persistExtractionSuccessBestEffort | 88-97 | test | interna | sim | supabase |
| worker-portal-2/test/best-effort-persist.test.mjs | persistErrorBestEffort | 100-105 | test | interna | sim | supabase |
| worker-portal-2/test/best-effort-persist.test.mjs | processLeadSuccessSlice | 113-123 | test | interna | sim | supabase|otp_captcha |

## worker-club (34 funções)

- **package:** `worker-club-igreen` @ 1.0.0
- **main:** `server.mjs`
- **scripts:** start, dev, test, probe:auth, dryrun
- **deps:** @supabase/supabase-js, bullmq, dotenv, express, playwright-chromium, ws

| Arquivo | Nome | Linhas | Tipo | Export | Async | Deps |
|---|---|---|---|---|---|---|
| worker-club/club-api-client.mjs | _ensurePage | 55-79 | function | interna | sim | playwright |
| worker-club/club-api-client.mjs | closeBrowser | 81-85 | function | named | sim | playwright |
| worker-club/club-api-client.mjs | _fetch | 103-176 | function | interna | sim | playwright|secret_auth |
| worker-club/club-api-client.mjs | loginConsultor | 179-201 | function | interna | sim | - |
| worker-club/club-api-client.mjs | getToken | 203-207 | function | interna | sim | - |
| worker-club/club-api-client.mjs | listPlanos | 210-212 | function | interna | sim | - |
| worker-club/club-api-client.mjs | lookupCep | 218-238 | function | interna | sim | - |
| worker-club/club-api-client.mjs | listEstados | 241-245 | function | interna | sim | - |
| worker-club/club-api-client.mjs | buildPayloadPf | 250-270 | function | interna | sim | - |
| worker-club/club-api-client.mjs | cadastrarPf | 279-307 | function | interna | sim | dryRun |
| worker-club/club-errors.mjs | classifyClubError | 20-65 | function | named | nao | - |
| worker-club/club-normalize.mjs | onlyDigits | 21-23 | function | named | nao | - |
| worker-club/club-normalize.mjs | formatCpf | 25-29 | function | named | nao | - |
| worker-club/club-normalize.mjs | isValidCpf | 32-46 | function | named | nao | - |
| worker-club/club-normalize.mjs | formatCep | 48-52 | function | named | nao | - |
| worker-club/club-normalize.mjs | formatCelular | 59-69 | function | named | nao | - |
| worker-club/club-normalize.mjs | isValidCelular | 71-78 | function | named | nao | - |
| worker-club/club-normalize.mjs | formatDateBr | 84-114 | function | named | nao | - |
| worker-club/club-normalize.mjs | normalizeUf | 122-135 | function | named | nao | - |
| worker-club/club-normalize.mjs | ufToIbgeId | 137-140 | function | named | nao | - |
| worker-club/club-normalize.mjs | isValidEmail | 142-148 | function | named | nao | - |
| worker-club/club-normalize.mjs | montarPayloadClubPf | 154-227 | function | named | nao | - |
| worker-club/club-normalize.mjs | maskPii | 230-241 | function | named | nao | - |
| worker-club/server.mjs | authRequired | 60-66 | function | interna | nao | secret_auth |
| worker-club/server.mjs | buildRedisConn | 68-82 | function | interna | nao | redis |
| worker-club/server.mjs | updateCustomerClub | 85-96 | function | interna | sim | supabase |
| worker-club/server.mjs | processLead | 98-144 | function | interna | sim | dryRun |
| worker-club/server.mjs | initQueue | 150-178 | queue_worker | interna | sim | bullmq|redis |
| worker-club/server.mjs | shutdown | 289-295 | function | interna | sim | - |

## worker-igreen-sync (73 funções)

- **package:** `igreen-sync-worker` @ 15.0.0
- **main:** `server.mjs`
- **scripts:** start, dev
- **deps:** playwright-chromium

| Arquivo | Nome | Linhas | Tipo | Export | Async | Deps |
|---|---|---|---|---|---|---|
| worker-igreen-sync/server.mjs | readResponseLike | 190-198 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | fetchPaged | 246-270 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | classifyPortalPage | 283-302 | function | interna | sim | playwright |
| worker-igreen-sync/server.mjs | describeScreenshot | 305-334 | function | interna | sim | otp_captcha|secret_auth |
| worker-igreen-sync/server.mjs | snapStep | 336-345 | function | interna | sim | playwright|session_or_screenshot |
| worker-igreen-sync/server.mjs | solveRecaptcha | 348-374 | function | interna | sim | otp_captcha |
| worker-igreen-sync/server.mjs | rotateTorCircuit | 384-422 | function | interna | sim | session_or_screenshot |
| worker-igreen-sync/server.mjs | preflightPortalCheck | 427-450 | function | interna | sim | playwright |
| worker-igreen-sync/server.mjs | loginWithPlaywright | 466-705 | function | interna | sim | playwright|otp_captcha|session_or_screenshot|secret_auth |
| worker-igreen-sync/server.mjs | getOrCreateSession | 707-772 | function | interna | sim | playwright |
| worker-igreen-sync/server.mjs | withEmailOperationLock | 777-803 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | apiGet | 825-847 | function | interna | sim | playwright|secret_auth |
| worker-igreen-sync/server.mjs | discoverSinceMonth | 851-867 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | fetchKanbanGreen | 870-880 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | discoverCadastroDays | 888-907 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | fetchCadastrosByDays | 911-931 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | fetchCustomers | 942-1005 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | fetchNetwork | 1011-1043 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | fetchTelecomPayload | 1047-1135 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | fetchTelecom | 1137-1139 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | fetchProdutoCadastrosByDays | 1144-1181 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | fetchSegurosPayload | 1184-1248 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | fetchSeguros | 1250-1252 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | fetchBoletos | 1256-1268 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | fetchCustomerDetail | 1273-1276 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | apiGetOn | 1280-1292 | function | interna | sim | playwright|secret_auth |
| worker-igreen-sync/server.mjs | fetchCustomerFull | 1297-1312 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | enrichMany | 1317-1356 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | fetchDevolutivas | 1361-1389 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | fetchCashback | 1395-1405 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | fetchMetrics | 1410-1452 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | safe | 1412-1412 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | collectFullExtras | 1462-1545 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | probeEndpoints | 1659-1678 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | probeAll | 1683-1722 | function | interna | sim | secret_auth |
| worker-igreen-sync/server.mjs | respListener | 2144-2166 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | respListener | 2331-2377 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | visitAndInteract | 2385-2489 | function | interna | sim | playwright|session_or_screenshot |
| worker-igreen-sync/server.mjs | respListener | 2641-2667 | function | interna | sim | - |
| worker-igreen-sync/server.mjs | waitSpaMounted | 2671-2679 | function | interna | sim | playwright |

## compress-worker (4 funções)

- **package:** `compress-worker` @ 1.0.0
- **main:** `?`
- **scripts:** start
- **deps:** express, multer, minio

| Arquivo | Nome | Linhas | Tipo | Export | Async | Deps |
|---|---|---|---|---|---|---|

## Isolamento Portal 2 vs Club (checklist preliminar)

| Critério | Observação na fotografia/inventário |
|---|---|
| Código separado | Pastas distintas `worker-portal-2/` e `worker-club/` |
| Stack similar | Ambos: express + bullmq + playwright-chromium + supabase-js |
| Docs de domínio | Portal: `PORTAL-OFICIAL.md`; Club: `CLUB-OFICIAL.md`, `APP-LINKS-CLIENTE.md` |
| Interferência | **Necessita auditoria de env vars, filas Redis e tabelas** (etapa 12) |
| worker-igreen-sync | Legado sync VOffice/Tor — caminho paralelo a Portal 2 |
| compress-worker | MinIO/multer — mídia, não cadastro |
