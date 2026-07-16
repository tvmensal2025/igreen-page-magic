# 01 — Inventário de funções — Frontend

**Método:** AST via TypeScript Compiler API (`typescript` do projeto), somente leitura.
**Escopo:** `src/**/*.{ts,tsx,js,jsx}`
**Data:** 2026-07-16

> Inventário programático. Campos de chamadores/autorização/idempotência serão enriquecidos nas etapas de auditoria por domínio. Nesta etapa: localização, tipo, exportação, async, deps heurísticas.

## Resumo

| Métrica | Valor |
|---|---:|
| Arquivos varridos | 891 |
| Funções/componentes/hooks catalogados | 3330 |
| Export default | 75 |
| Export named | 1033 |
| Internas | 2222 |
| Async | 844 |
| Hooks (`use*`) | 149 |
| Componentes (PascalCase em tsx) | 843 |

## Por domínio

| Domínio | Qtd funções |
|---|---:|
| components-admin | 1157 |
| features | 442 |
| components-whatsapp | 367 |
| hooks | 254 |
| components-captacao | 238 |
| lib | 210 |
| pages | 181 |
| services | 145 |
| components-superadmin | 110 |
| components-other | 94 |
| components-ui | 53 |
| tests | 43 |
| other | 19 |
| components-wallet | 6 |
| contexts | 6 |
| components-voz | 4 |
| integrations | 1 |

## Funções de alto interesse (I/O, storage, edge, realtime)

Total com deps heurísticas relevantes e/ou exportadas: **1001** (amostra top 200 abaixo; JSON completo em artefato temporário de build da auditoria).

| Arquivo | Nome | Linhas | Tipo | Export | Async | Deps | Risco* |
|---|---|---|---|---|---|---|---|
| src/components/admin/flow-builder/diagram-v2/FlowDiagramV2.tsx | Inner | 74-457 | component | interna | nao | web_storage\|timer | medio |
| src/components/layout/LayoutLockToggle.tsx | LayoutLockToggle | 10-76 | component | named | nao | web_storage\|timer | medio |
| src/components/licenciada/LicUrgencyBanner.tsx | LicUrgencyBanner | 3-84 | component | interna | nao | web_storage\|timer | medio |
| src/hooks/useViewportPersistence.ts | useViewportPersistence | 91-168 | hook | named | nao | web_storage\|timer | medio |
| src/main.tsx | nukeAndReload | 79-114 | function | interna | sim | web_storage\|timer | medio |
| src/main.tsx | applyUpdateWhenSafe | 201-237 | function | interna | nao | web_storage\|timer | medio |
| src/main.tsx | tryReload | 218-234 | function | interna | nao | web_storage\|timer | medio |
| src/components/admin/AIAgentTab/AudioRecorderInline.tsx | AudioRecorderInline | 12-118 | component | named | nao | timer\|upload_media | medio |
| src/components/admin/ads/ConnectFacebookCard.tsx | ConnectFacebookCard | 34-358 | component | named | nao | timer\|upload_media | medio |
| src/components/admin/ads/ExpressCampaignDialog.tsx | ExpressCampaignDialog | 32-383 | component | named | nao | timer\|upload_media | medio |
| src/components/admin/voz/AudioWhatsAppCampaignPanel.tsx | AudioWhatsAppCampaignPanel | 27-273 | component | named | nao | timer\|upload_media | medio |
| src/components/whatsapp/MessageComposer.tsx | MessageComposer | 41-291 | component | named | nao | timer\|upload_media | medio |
| src/components/whatsapp/voice/VoiceClipRecorder.tsx | VoiceClipRecorder | 27-95 | component | named | nao | timer\|upload_media | medio |
| src/lib/audioProcessing.ts | downloadBlob | 134-143 | function | named | nao | timer\|upload_media | medio |
| src/components/admin/OnboardingGate.tsx | OnboardingGate | 50-185 | component | named | nao | timer | medio |
| src/components/admin/academy/AcademyPlayer.tsx | AcademyPlayer | 74-438 | component | named | nao | timer | medio |
| src/components/admin/ads/campaign-wizard/hooks/useCopyLogic.ts | useCopyLogic | 28-142 | hook | named | nao | timer | medio |
| src/components/admin/ads/campaign-wizard/hooks/useRegionLogic.ts | useRegionLogic | 39-207 | hook | named | nao | timer | medio |
| src/components/admin/flow-builder/StepCoachPanel.tsx | StepCoachPanel | 58-215 | component | default | nao | timer | medio |
| src/components/captacao/BusinessResearchDialog.tsx | BusinessResearchDialog | 58-565 | component | named | nao | timer | medio |
| src/components/captacao/CaptureLeadCard.tsx | CaptureLeadCard | 29-546 | component | named | nao | timer | medio |
| src/components/captacao/game/LevelUpOverlay.tsx | LevelUpOverlay | 6-66 | component | named | nao | timer | medio |
| src/components/captacao/game/XpFloater.tsx | XpFloaterProvider | 26-70 | component | named | nao | timer | medio |
| src/components/captacao/game/XpToast.tsx | XpToast | 5-18 | component | named | nao | timer | medio |
| src/components/whatsapp/ConnectionPanel.tsx | ConnectionPanel | 151-611 | component | named | nao | timer | medio |
| src/features/onboarding/TourProvider.tsx | TourProvider | 14-126 | component | named | nao | timer | medio |
| src/features/produtos/acompanhamento/CrossSellCard.tsx | CrossSellCard | 100-292 | component | named | nao | timer | medio |
| src/features/remote-support/ActiveSessionBanner.tsx | ActiveSessionBanner | 47-277 | component | named | nao | timer | medio |
| src/features/remote-support/actionHandler.ts | executeCommand | 257-600 | function | named | sim | timer | medio |
| src/features/remote-support/screenShare.ts | createOperatorPeer | 272-394 | function | named | sim | timer | medio |
| src/features/remote-support/screenShare.ts | createRequesterPeer | 423-618 | function | named | sim | timer | medio |
| src/hooks/useAudioRecorder.ts | useAudioRecorder | 8-79 | hook | named | nao | timer | medio |
| src/hooks/useCaptureCombo.ts | useCaptureCombo | 47-102 | hook | named | nao | timer | medio |
| src/hooks/useCaptureGameState.ts | useCaptureGameState | 39-108 | hook | named | nao | timer | medio |
| src/hooks/useDiagramExport.ts | useDiagramExport | 140-260 | hook | named | nao | timer | medio |
| src/hooks/whatsapp/whatsappHealth.ts | createHealthControls | 26-56 | function | named | nao | timer | medio |
| src/hooks/whatsapp/whatsappHelpers.ts | sleep | 81-83 | function | named | nao | timer | medio |
| src/hooks/whatsapp/whatsappHelpers.ts | withTimeout | 85-98 | function | named | sim | timer | medio |
| src/hooks/whatsapp/whatsappStateChecks.ts | createStateChecks | 36-105 | function | named | nao | timer | medio |
| src/lib/audioProcessing.ts | encodeMp3 | 49-80 | function | named | sim | timer | medio |
| src/lib/captureSfx.ts | sfxCombo | 39-43 | function | named | nao | timer | medio |
| src/lib/captureSfx.ts | sfxLevelUp | 44-46 | function | named | nao | timer | medio |
| src/lib/captureSfx.ts | sfxVictory | 47-49 | function | named | nao | timer | medio |
| src/services/templateSender.ts | sendTemplate | 119-182 | function | named | sim | timer | medio |
| src/components/admin/AIAgentTab/MediaColumn.tsx | MediaColumn | 146-705 | component | named | nao | supabase.from\|upload_media | medio |
| src/components/admin/AIAgentTab/MediaColumn.tsx | uploadFiles | 184-251 | function | interna | sim | supabase.from\|upload_media | medio |
| src/components/admin/AIAgentTab/SlotCard.tsx | SlotCard | 40-181 | component | named | nao | supabase.from\|upload_media | medio |
| src/components/admin/AIAgentTab/SlotCard.tsx | uploadAudioBlob | 48-58 | function | interna | sim | supabase.from\|upload_media | medio |
| src/components/admin/AIAgentTab/SlotCard.tsx | handleRecorded | 60-90 | function | interna | sim | supabase.from\|upload_media | medio |
| src/components/admin/AIAgentTab/SlotsPanel.tsx | SuperAdminSlotsModal | 107-408 | component | interna | nao | supabase.from\|upload_media | medio |
| src/components/admin/AIAgentTab/SlotsPanel.tsx | uploadSlotVideo | 163-182 | function | interna | sim | supabase.from\|upload_media | medio |
| src/components/admin/AIAgentTab/SlotsPanel.tsx | uploadDefault | 267-293 | function | interna | sim | supabase.from\|upload_media | medio |
| src/components/admin/AudioStudio.tsx | setCachedTTS | 167-178 | function | interna | sim | supabase.from\|upload_media | medio |
| src/components/admin/AudioStudio.tsx | tryReuseExisting | 795-840 | function | interna | sim | supabase.from\|upload_media | medio |
| src/components/admin/AudioStudio.tsx | saveToLibrary | 892-960 | function | interna | sim | supabase.from\|upload_media | medio |
| src/components/admin/AudioStudio.tsx | uploadAudio | 894-914 | function | interna | sim | supabase.from\|upload_media | medio |
| src/components/admin/conversao/ConversaoLeadDrawer.tsx | onPickFile | 95-117 | function | interna | sim | supabase.from\|upload_media | medio |
| src/components/admin/conversao/FrasesPanel.tsx | FraseCard | 245-391 | component | interna | nao | supabase.from\|upload_media | medio |
| src/components/admin/conversao/FrasesPanel.tsx | onPickFile | 264-288 | function | interna | sim | supabase.from\|upload_media | medio |
| src/components/admin/financeiro/ExtratoPanel.tsx | ExtratoPanel | 38-273 | component | named | nao | supabase.from\|upload_media | medio |
| src/components/admin/flow-builder/FlowSimulator.tsx | handleFile | 203-226 | function | interna | sim | supabase.from\|upload_media | medio |
| src/components/admin/voz/VoiceCycleKitPanel.tsx | VoiceCycleKitPanel | 71-327 | component | named | nao | supabase.from\|upload_media | medio |
| src/components/captacao/CaptureDocumentTiles.tsx | handleFile | 166-189 | function | interna | sim | supabase.from\|upload_media | medio |
| src/components/superadmin/AIKnowledgePanel.tsx | removeDoc | 207-237 | function | interna | sim | supabase.from\|upload_media | medio |
| src/components/whatsapp/MediaLibraryPicker.tsx | MediaLibraryPicker | 158-402 | component | named | nao | supabase.from\|upload_media | medio |
| src/components/whatsapp/PosVendaSetupWizard.tsx | PosVendaSetupWizard | 92-666 | component | default | nao | supabase.from\|upload_media | medio |
| src/components/whatsapp/PosVendaSetupWizard.tsx | handleUpload | 257-300 | function | interna | sim | supabase.from\|upload_media | medio |
| src/features/produtos/esteira/api.ts | listAttachments | 184-192 | function | named | sim | supabase.from\|upload_media | medio |
| src/features/produtos/esteira/api.ts | uploadAttachment | 194-230 | function | named | sim | supabase.from\|upload_media | medio |
| src/hooks/useConsultantForm.ts | useConsultantForm | 34-182 | hook | named | nao | supabase.from\|upload_media | medio |
| src/hooks/useConsultantForm.ts | handleSave | 54-173 | function | interna | sim | supabase.from\|upload_media | medio |
| src/pages/AdminProtocolsPage.tsx | AdminProtocolsPage | 23-259 | component | default | nao | supabase.from\|upload_media | medio |
| src/services/adTemplates.ts | uploadAdTemplateImage | 107-116 | function | named | sim | supabase.from\|upload_media | medio |
| src/services/facebookAds.ts | uploadAdVideo | 296-309 | function | named | sim | supabase.from\|upload_media | medio |
| src/components/captacao/CaptureConversationFeed.tsx | CaptureConversationFeed | 90-393 | component | named | nao | supabase.from\|timer\|realtime | medio |
| src/components/superadmin/WorkerPhaseTimeline.tsx | WorkerPhaseTimeline | 51-322 | component | named | nao | supabase.from\|timer\|realtime | medio |
| src/features/remote-support/useRequesterSession.ts | useRequesterSession | 45-458 | hook | named | nao | supabase.from\|timer\|realtime | medio |
| src/hooks/useConsultantPresence.ts | useConsultantPresence | 26-126 | hook | named | nao | supabase.from\|timer\|realtime | medio |
| src/hooks/useMessages.ts | useMessages | 329-838 | hook | named | nao | supabase.from\|timer\|realtime | medio |
| src/components/admin/IGreenSyncStatusBadge.tsx | IGreenSyncStatusBadge | 27-113 | component | named | nao | supabase.from\|timer | medio |
| src/components/admin/ads/CampaignRodizioLeadsDialog.tsx | CampaignRodizioLeadsDialog | 32-455 | component | named | nao | supabase.from\|timer | medio |
| src/components/admin/ads/CampaignRodizioLeadsDialog.tsx | handleIntervalChange | 193-210 | function | interna | sim | supabase.from\|timer | medio |
| src/components/admin/conversao/ConfigPanel.tsx | ConfigPanel | 48-224 | component | named | nao | supabase.from\|timer | medio |
| src/components/admin/parceiros/hooks/useReferralPartners.ts | useReferralPartners | 24-137 | hook | named | nao | supabase.from\|timer | medio |
| src/components/captacao/CaptureStepsList.tsx | CaptureStepsList | 46-339 | component | named | nao | supabase.from\|timer | medio |
| src/components/captacao/CloseAttendanceBatchDialog.tsx | runBatch | 393-602 | function | interna | sim | supabase.from\|timer | medio |
| src/components/superadmin/SystemHealthPanel.tsx | SystemHealthPanel | 41-224 | component | named | nao | supabase.from\|timer | medio |
| src/components/whatsapp/BulkBlockSendPanel.tsx | BulkBlockSendPanel | 80-659 | component | named | nao | supabase.from\|timer | medio |
| src/components/whatsapp/BulkSendPanel.tsx | BulkSendPanel | 90-720 | component | named | nao | supabase.from\|timer | medio |
| src/components/whatsapp/InstanceHealth.tsx | InstanceHealth | 80-331 | component | named | nao | supabase.from\|timer | medio |
| src/components/whatsapp/KanbanBoard.tsx | KanbanBoard | 34-334 | component | named | nao | supabase.from\|timer | medio |
| src/components/whatsapp/KanbanBoard.tsx | sendAutoMessages | 63-134 | function | interna | sim | supabase.from\|timer | medio |
| src/components/whatsapp/bulk-pro/BulkProPanel.tsx | BulkProPanel | 95-795 | component | named | nao | supabase.from\|timer | medio |
| src/features/produtos/carteira-green/CarteiraGreenPanel.tsx | CarteiraGreenPanel | 22-198 | component | named | nao | supabase.from\|timer | medio |
| src/hooks/useDiagramLayout.ts | useDiagramLayout | 95-424 | hook | named | nao | supabase.from\|timer | medio |
| src/hooks/useWhatsApp.ts | useWhatsApp | 55-905 | hook | named | nao | supabase.from\|timer | medio |
| src/lib/igreenSync.ts | waitIgreenSyncFinished | 89-120 | function | named | sim | supabase.from\|timer | medio |
| src/pages/AjudaPage.tsx | AjudaPage | 15-121 | component | default | nao | supabase.from\|timer | medio |
| src/components/captacao/ClubStatusTracker.tsx | ClubStatusTracker | 28-130 | component | named | nao | supabase.from\|realtime | medio |
| src/components/whatsapp/AutoMessageLog.tsx | AutoMessageLog | 102-231 | component | named | nao | supabase.from\|realtime | medio |
| src/components/whatsapp/PendingApprovalDialog.tsx | PendingApprovalDialog | 54-827 | component | default | nao | supabase.from\|realtime | medio |
| src/hooks/useAdminAuth.ts | useAdminAuth | 37-135 | hook | named | nao | supabase.from\|realtime | medio |
| src/hooks/useCaptureSession.ts | useCaptureSession | 171-455 | hook | named | nao | supabase.from\|realtime | medio |
| src/hooks/useCaptureSuggestions.ts | useCaptureSuggestions | 14-51 | hook | named | nao | supabase.from\|realtime | medio |
| src/hooks/useOcrReviewQueue.ts | useOcrReviewQueue | 21-64 | hook | named | nao | supabase.from\|realtime | medio |
| src/hooks/useSalesFunnel.ts | useSalesFunnel | 41-89 | hook | named | nao | supabase.from\|realtime | medio |
| src/pages/Auth.tsx | Auth | 38-362 | component | interna | nao | supabase.from\|realtime | medio |
| src/pages/SuperAdminRemoteSupport.tsx | SuperAdminRemoteSupport | 84-380 | component | default | nao | supabase.from\|realtime | medio |
| src/components/admin/fluxo/StepMediaPanel.tsx | StepMediaPanel | 77-780 | component | default | nao | supabase.from\|fetch\|upload_media | medio |
| src/components/admin/fluxo/StepMediaPanel.tsx | handleUpload | 241-353 | function | interna | sim | supabase.from\|fetch\|upload_media | medio |
| src/components/captacao/CaptureConversationFeed.tsx | MessageBody | 419-706 | component | interna | nao | supabase.from\|fetch\|timer\|upload_media | medio |
| src/components/admin/AudioStudio.tsx | getCachedTTS | 137-166 | function | interna | sim | supabase.from\|fetch | medio |
| src/components/admin/IGreenSyncStatusBar.tsx | IGreenSyncStatusBar | 47-245 | component | named | nao | supabase.from\|fetch | medio |
| src/components/whatsapp/AddCustomerDialog.tsx | AddCustomerDialog | 49-393 | component | named | nao | supabase.from\|fetch | medio |
| src/components/whatsapp/CustomerEditDialog.tsx | CustomerEditDialog | 52-297 | component | named | nao | supabase.from\|fetch | medio |
| src/lib/mediaHash.ts | findExistingByHash | 32-57 | function | named | sim | supabase.from\|fetch | medio |
| src/components/admin/fluxo/FaqSection.tsx | FaqSection | 49-425 | component | default | nao | supabase.from\|edge_function\|upload_media | medio |
| src/components/admin/fluxo/FaqSection.tsx | onAudioRecorded | 277-326 | function | interna | sim | supabase.from\|edge_function\|upload_media | medio |
| src/components/captacao/CaptureDocumentTiles.tsx | CaptureDocumentTiles | 45-320 | component | named | nao | supabase.from\|edge_function\|upload_media | medio |
| src/components/superadmin/AIKnowledgePanel.tsx | AIKnowledgePanel | 71-404 | component | named | nao | supabase.from\|edge_function\|upload_media | medio |
| src/components/superadmin/AIKnowledgePanel.tsx | handlePDFUpload | 126-205 | function | interna | sim | supabase.from\|edge_function\|upload_media | medio |
| src/components/superadmin/AdTemplatesPanel.tsx | AdTemplatesPanel | 65-518 | component | named | nao | supabase.from\|edge_function\|upload_media | medio |
| src/hooks/useCaptureAttach.ts | useCaptureAttach | 77-209 | hook | named | nao | supabase.from\|edge_function\|upload_media | medio |
| src/pages/AdminFaq.tsx | AdminFaq | 50-682 | component | default | nao | supabase.from\|edge_function\|upload_media | medio |
| src/services/facebookAds.ts | uploadOne | 328-358 | function | interna | sim | supabase.from\|edge_function\|upload_media | medio |
| src/components/admin/voz/VoiceCampaignWizardDialog.tsx | VoiceCampaignWizardDialog | 103-875 | component | named | nao | supabase.from\|edge_function\|timer\|upload_media | medio |
| src/components/admin/IGreenBulkSyncPanel.tsx | IGreenBulkSyncPanel | 27-209 | component | named | nao | supabase.from\|edge_function\|timer | medio |
| src/components/admin/ads/CompetitorsPanel.tsx | CompetitorsPanel | 40-252 | component | named | nao | supabase.from\|edge_function\|timer | medio |
| src/components/admin/ads/EditCampaignDialog.tsx | EditCampaignDialog | 67-368 | component | named | nao | supabase.from\|edge_function\|timer | medio |
| src/components/admin/fluxo-b-ia/SimulatorPanel.tsx | SimulatorPanel | 24-173 | component | default | nao | supabase.from\|edge_function\|timer | medio |
| src/components/admin/super/AILearningHealthPanel.tsx | AILearningHealthPanel | 30-186 | component | named | nao | supabase.from\|edge_function\|timer | medio |
| src/components/captacao/CaptureSheet.tsx | CaptureSheetInner | 65-908 | component | interna | nao | supabase.from\|edge_function\|timer | medio |
| src/components/captacao/CloseAttendanceBatchDialog.tsx | CloseAttendanceBatchDialog | 218-819 | component | named | nao | supabase.from\|edge_function\|timer | medio |
| src/components/captacao/OcrReviewCard.tsx | OcrReviewCard | 54-315 | component | named | nao | supabase.from\|edge_function\|timer | medio |
| src/components/superadmin/StuckLeadsWidget.tsx | StuckLeadsWidget | 84-349 | component | named | nao | supabase.from\|edge_function\|timer | medio |
| src/components/superadmin/StuckLeadsWidget.tsx | executeAction | 138-169 | function | interna | sim | supabase.from\|edge_function\|timer | medio |
| src/lib/captacao/postBillConfirm.ts | sendFallbackSimulation | 56-83 | function | interna | sim | supabase.from\|edge_function\|timer | medio |
| src/lib/captacao/postBillConfirm.ts | dispatchPostBillConfirm | 85-169 | function | named | sim | supabase.from\|edge_function\|timer | medio |
| src/pages/AdminMotorCadencia.tsx | AdminMotorCadencia | 68-492 | component | default | nao | supabase.from\|edge_function\|timer | medio |
| src/pages/AdminReconIgreen.tsx | AdminReconIgreen | 24-175 | component | default | nao | supabase.from\|edge_function\|timer | medio |
| src/components/admin/AIAgentTab/LiveConversationsPanel.tsx | LiveConversationsPanel | 57-444 | component | named | nao | supabase.from\|edge_function\|realtime | medio |
| src/components/captacao/PortalStatusTracker.tsx | PortalStatusTracker | 136-532 | component | named | nao | supabase.from\|edge_function\|realtime | medio |
| src/hooks/useCustomerAttendance.ts | useCustomerAttendance | 12-231 | hook | named | nao | supabase.from\|edge_function\|realtime | medio |
| src/pages/SuperAdmin.tsx | SuperAdmin | 73-594 | component | interna | nao | supabase.from\|edge_function\|realtime | medio |
| src/components/admin/ads/campaign-wizard/hooks/useCreativeLogic.ts | useCreativeLogic | 23-137 | hook | named | nao | supabase.from\|edge_function\|fetch\|upload_media | medio |
| src/components/admin/conversao/ConversaoLeadDrawer.tsx | ConversaoLeadDrawer | 55-332 | component | named | nao | supabase.from\|edge_function\|fetch\|upload_media | medio |
| src/components/admin/media/AudioPlayer.tsx | AudioPlayer | 63-199 | component | default | nao | supabase.from\|edge_function\|fetch\|upload_media | medio |
| src/components/whatsapp/SaveMessageAsTemplateDialog.tsx | handleSave | 150-220 | function | interna | sim | supabase.from\|edge_function\|fetch\|upload_media | medio |
| src/components/admin/conversao/ConversaoCockpit.tsx | ConversaoCockpit | 87-568 | component | named | nao | supabase.from\|edge_function\|fetch\|timer | medio |
| src/components/admin/reaquecimento/ReaquecimentoSendDialog.tsx | ReaquecimentoSendDialog | 21-241 | component | named | nao | supabase.from\|edge_function\|fetch\|timer | medio |
| src/components/whatsapp/SaveMessageAsTemplateDialog.tsx | SaveMessageAsTemplateDialog | 48-332 | component | named | nao | supabase.from\|edge_function\|fetch\|realtime\|upload_media | medio |
| src/components/admin/parceiros/ManualReviewQueueCard.tsx | ManualReviewQueueCard | 64-382 | component | named | nao | supabase.from\|edge_function\|fetch\|realtime | medio |
| src/components/admin/fluxo/StepMediaPanel.tsx | AudioTranscriptEditor | 782-848 | component | interna | nao | supabase.from\|edge_function\|fetch | medio |
| src/components/admin/meta-ads/CampaignDetailDialog.tsx | CampaignDetailDialog | 28-144 | component | named | nao | supabase.from\|edge_function\|fetch | medio |
| src/hooks/useVoiceTemplates.ts | useVoiceTemplates | 44-209 | hook | named | nao | supabase.from\|edge_function\|fetch | medio |
| src/components/admin/AIAgentTab/LiveConversationsPanel.tsx | setPaused | 128-156 | function | interna | sim | supabase.from\|edge_function | medio |
| src/components/admin/AIAgentTab/LiveConversationsPanel.tsx | returnToStep | 171-230 | function | interna | sim | supabase.from\|edge_function | medio |
| src/components/admin/AIAgentTab/ManualStepDialog.tsx | ManualStepDialog | 52-379 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/admin/ads/CampaignsList.tsx | CampaignsList | 115-762 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/admin/ads/InsightsPanel.tsx | InsightsPanel | 28-200 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/admin/ai/AiFeedbackPanel.tsx | AiFeedbackPanel | 67-272 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/admin/ai/LearningHealthPanel.tsx | LearningHealthPanel | 45-178 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/admin/flow-builder/CreateFlowFromTemplateDialog.tsx | CreateFlowFromTemplateDialog | 124-596 | component | default | nao | supabase.from\|edge_function | medio |
| src/components/admin/flow-builder/CreateFlowFromTemplateDialog.tsx | handleCreate | 206-266 | function | interna | sim | supabase.from\|edge_function | medio |
| src/components/admin/flow-builder/FluxoBEditor.tsx | FluxoBEditor | 19-199 | component | default | nao | supabase.from\|edge_function | medio |
| src/components/admin/flow-builder/StepSuggestions.tsx | StepSuggestions | 23-126 | component | default | nao | supabase.from\|edge_function | medio |
| src/components/admin/knowledge/EmbeddingsControl.tsx | EmbeddingsControl | 16-118 | component | default | nao | supabase.from\|edge_function | medio |
| src/components/admin/parceiros/PartnerForm.tsx | PartnerForm | 35-442 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/admin/saude/BotHealthIntel.tsx | BotHealthIntel | 53-259 | component | default | nao | supabase.from\|edge_function | medio |
| src/components/admin/voz/VoiceContactBasesPanel.tsx | VoiceContactBasesPanel | 16-104 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/admin/voz/VoiceDashboardPanel.tsx | VoiceDashboardPanel | 69-295 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/admin/voz/VoiceDialerPanel.tsx | VoiceDialerPanel | 39-277 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/admin/voz/VoiceSmsPanel.tsx | VoiceSmsPanel | 93-472 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/captacao/CaptureDataConfirmCard.tsx | CaptureDataConfirmCard | 44-217 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/captacao/CaptureDataConfirmCard.tsx | askClient | 107-146 | function | interna | sim | supabase.from\|edge_function | medio |
| src/components/captacao/CaptureStepsGrid.tsx | CaptureStepsGrid | 56-317 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/captacao/CloseCaptureDialog.tsx | CloseCaptureDialog | 52-589 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/captacao/OcrReviewCard.tsx | askClient | 149-188 | function | interna | sim | supabase.from\|edge_function | medio |
| src/components/leads/LeadOriginEditorDialog.tsx | LeadOriginEditorDialog | 72-445 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/superadmin/CaptacaoTab/IntelDiagnostic.tsx | IntelDiagnostic | 29-190 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/superadmin/InfraHealthPanel.tsx | InfraHealthPanel | 43-198 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/superadmin/LearnedPatternsPanel.tsx | LearnedPatternsPanel | 20-174 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/superadmin/RolloutPanel.tsx | RolloutPanel | 103-440 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/superadmin/WhatsAppInstanceHealthCard.tsx | WhatsAppInstanceHealthCard | 19-162 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/voz/ScheduleCallButton.tsx | ScheduleCallButton | 39-211 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/wallet/RechargeRequiredDialog.tsx | RechargeRequiredDialog | 16-274 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/whatsapp/AgendamentosHub.tsx | AgendamentosHub | 166-1209 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/whatsapp/AgendamentosHub.tsx | handleDeleteTimelineItem | 271-389 | function | interna | sim | supabase.from\|edge_function | medio |
| src/components/whatsapp/FlowQuickBar.tsx | FlowQuickBar | 64-539 | component | named | nao | supabase.from\|edge_function | medio |
| src/components/whatsapp/PosVendaKanban.tsx | PosVendaKanban | 74-657 | component | default | nao | supabase.from\|edge_function | medio |
| src/features/produtos/carteira-green/EndpointDiscoveryCard.tsx | EndpointDiscoveryCard | 38-216 | component | named | nao | supabase.from\|edge_function | medio |
| src/hooks/useCtwaPreflight.ts | useCtwaPreflight | 38-165 | hook | named | nao | supabase.from\|edge_function | medio |
| src/hooks/useMessages.ts | ensureLeadPartnerLink | 235-327 | function | interna | sim | supabase.from\|edge_function | medio |
| src/lib/whatsapp/auto-takeover.ts | applyPause | 23-46 | function | interna | sim | supabase.from\|edge_function | medio |
| src/lib/whatsapp/auto-takeover.ts | undoTakeoverByPhone | 115-149 | function | named | sim | supabase.from\|edge_function | medio |
| src/pages/AdminTourEditor.tsx | AdminTourEditor | 15-214 | component | default | nao | supabase.from\|edge_function | medio |
| src/components/admin/AIAgentTab/AIDecisionsPanel.tsx | AIDecisionsPanel | 32-165 | component | named | nao | supabase.from | medio |
| src/components/admin/AIAgentTab/AIDecisionsPanel.tsx | rate | 37-49 | function | interna | sim | supabase.from | medio |
| src/components/admin/AIAgentTab/BotTelemetryStrip.tsx | BotTelemetryStrip | 11-65 | component | named | nao | supabase.from | medio |
| src/components/admin/AIAgentTab/LiveConversationsPanel.tsx | load | 72-82 | function | interna | sim | supabase.from | medio |

\* Risco preliminar heurístico (não é achado P0–P4 ainda).

## Domínio: `components-admin` (1157 total, 307 exportadas)

| Arquivo | Nome | Linhas | Tipo | Export | Async | Params | Deps |
|---|---|---|---|---|---|---|---|
| src/components/admin/academy/AcademyCatalog.tsx | buildFlatList | 48-71 | function | named | nao |  | - |
| src/components/admin/academy/AcademyCatalog.tsx | AcademyCatalog | 479-702 | component | named | nao | { flatList, getLessonProg, getExam, onOpenLesson, onOpenQuiz | - |
| src/components/admin/academy/AcademyNotesFab.tsx | AcademyNotesFab | 309-421 | component | named | nao |  | - |
| src/components/admin/academy/AcademyPlayer.tsx | AcademyPlayer | 74-438 | component | named | nao | {   videoId, lesson, progress,   hasPrev, hasNext, onPrev, o | timer |
| src/components/admin/academy/AcademyQuizModal.tsx | AcademyQuizModal | 50-55 | component | named | nao | { quizKey, onClose, onPass, lastResult }: Props | - |
| src/components/admin/academy/AcademyTab.tsx | AcademyTab | 29-351 | component | named | nao |  | - |
| src/components/admin/ads/AddressRadiusPicker.tsx | AddressRadiusPicker | 32-211 | component | named | nao | { value, onChange }: Props | fetch\|timer |
| src/components/admin/ads/AdImageLibraryPanel.tsx | AdImageLibraryPanel | 25-123 | component | named | nao | { consultantId, format, selectedUrls, onPick }: Props | - |
| src/components/admin/ads/AdPreview.tsx | AdPreview | 20-66 | component | named | nao | { imagesByFormat, pageName, headline, primaryText, descripti | - |
| src/components/admin/ads/AdQualityPanel.tsx | AdQualityPanel | 14-72 | component | named | nao | { headline, primary, description, cityCount, distribuidora,  | - |
| src/components/admin/ads/AdsCentralTab.tsx | AdsCentralTab | 45-248 | component | named | nao | { consultantId }: Props | - |
| src/components/admin/ads/AdsTile.tsx | AdsTile | 19-50 | component | named | nao | {   label,   icon,   action,   className,   colSpan,   rowSp | - |
| src/components/admin/ads/AdTemplatesGallery.tsx | AdTemplatesGallery | 19-146 | component | named | nao | { consultantId, onPublished }: Props | supabase.from |
| src/components/admin/ads/campaign-wizard/CampaignWizardModal.tsx | CampaignWizardModal | 50-272 | component | named | nao | { open, onClose, consultantId, onCreated }: Props | - |
| src/components/admin/ads/campaign-wizard/CopyCatalogSheet.tsx | CopyCatalogSheet | 33-146 | component | named | nao | {   open, onOpenChange, distribuidora, cidade,   onPickHeadl | - |
| src/components/admin/ads/campaign-wizard/hooks/useCopyLogic.ts | useCopyLogic | 28-142 | hook | named | nao | { open, state, derived, patch }: Deps | timer |
| src/components/admin/ads/campaign-wizard/hooks/useCreativeLogic.ts | useCreativeLogic | 23-137 | hook | named | nao | { consultantId, state, patch, patchFn }: Deps | supabase.from\|edge_function\|fetch\|upload_media |
| src/components/admin/ads/campaign-wizard/hooks/usePublish.ts | usePublish | 30-255 | hook | named | nao | { consultantId, consultantPhone, isSuperAdmin, state, derive | supabase.from\|web_storage\|upload_media |
| src/components/admin/ads/campaign-wizard/hooks/useRegionLogic.ts | useRegionLogic | 39-207 | hook | named | nao | { open, state, patch, patchFn }: Deps | timer |
| src/components/admin/ads/campaign-wizard/hooks/useRodizioLogic.ts | validateInlineForm | 62-87 | function | named | nao | form: RodizioInlineForm | - |
| src/components/admin/ads/campaign-wizard/hooks/useRodizioLogic.ts | useRodizioLogic | 90-389 | hook | named | nao | { open, state, patch, patchFn }: Deps | supabase.from |
| src/components/admin/ads/campaign-wizard/hooks/useWizardState.ts | useWizardState | 187-239 | hook | named | nao | open: boolean, consultantId: string | supabase.from\|web_storage |
| src/components/admin/ads/campaign-wizard/RodizioBlock.tsx | RodizioBlock | 47-236 | component | named | nao | { open, state, patch, patchFn }: Props | - |
| src/components/admin/ads/campaign-wizard/RodizioInlineForm.tsx | RodizioInlineForm | 48-217 | component | named | nao | {   value,   onChange,   onSubmit,   onCancel,   submitting  | - |
| src/components/admin/ads/campaign-wizard/steps/StepBudget.tsx | StepBudget | 28-140 | component | named | nao | { open, state, patch, patchFn }: Props | - |
| src/components/admin/ads/campaign-wizard/steps/StepCopy.tsx | StepCopy | 30-182 | component | named | nao | { state, derived, patch, copyLogic }: Props | - |
| src/components/admin/ads/campaign-wizard/steps/StepCreative.tsx | StepCreative | 26-133 | component | named | nao | { state, patch, patchFn, creative, consultantId }: Props | upload_media |
| src/components/admin/ads/campaign-wizard/steps/StepRegion.tsx | StepRegion | 27-140 | component | named | nao | { state, patch, region }: Props | - |
| src/components/admin/ads/campaign-wizard/steps/StepReview.tsx | StepReview | 26-133 | component | named | nao | { state, derived, patch, publish, consultantId, consultantPh | - |
| src/components/admin/ads/campaign-wizard/WizardFooter.tsx | WizardFooter | 16-49 | component | named | nao | { step, onBack, onNext, submitting, canAdvance }: Props | - |
| src/components/admin/ads/campaign-wizard/wizardHelpers.ts | buildDefaultInitialMessage | 43-47 | function | named | nao | distrib: string \| null | - |
| src/components/admin/ads/campaign-wizard/wizardHelpers.ts | readImageDimensions | 59-67 | function | named | nao | file: File | upload_media |
| src/components/admin/ads/campaign-wizard/wizardHelpers.ts | cropToFormat | 69-92 | function | named | nao | file: File, spec: { w: number; h: number } | upload_media |
| src/components/admin/ads/campaign-wizard/wizardHelpers.ts | isFileValidFor | 95-100 | function | named | nao | a: AdFile, fmt: AdFormat | - |
| src/components/admin/ads/campaign-wizard/wizardHelpers.ts | isFileValidAny | 101-103 | function | named | nao | a: AdFile | - |
| src/components/admin/ads/campaign-wizard/WizardPreview.tsx | WizardPreview | 21-40 | component | named | nao | { step, state, pageName, whatsappNumber }: Props | - |
| src/components/admin/ads/campaign-wizard/WizardSidebar.tsx | WizardSidebar | 23-74 | component | named | nao | { currentStep, onStepClick, completedSteps, walletBalance }: | - |
| src/components/admin/ads/CampaignExperimentCard.tsx | CampaignExperimentCard | 70-289 | component | named | nao | { consultantId }: { consultantId: string } | supabase.from |
| src/components/admin/ads/CampaignHealthCheck.tsx | CampaignHealthCheck | 32-125 | component | named | nao | {   campaignId,   fbCampaignId,   whatsappNumber, }: {   cam | edge_function |
| src/components/admin/ads/CampaignRodizioLeadsDialog.tsx | CampaignRodizioLeadsDialog | 32-455 | component | named | nao | {   open,   onOpenChange,   campaignId,   campaignName,   on | supabase.from\|timer |
| src/components/admin/ads/CampaignsList.tsx | CampaignsList | 115-762 | component | named | nao | { consultantId, refreshKey }: { consultantId: string; refres | supabase.from\|edge_function |
| src/components/admin/ads/CommissionPanel.tsx | CommissionPanel | 49-305 | component | named | nao | { consultantId }: Props | supabase.from |
| src/components/admin/ads/CompetitorsPanel.tsx | CompetitorsPanel | 40-252 | component | named | nao | { onInspire }: Props = {} | supabase.from\|edge_function\|timer |
| src/components/admin/ads/ConnectFacebookCard.tsx | ConnectFacebookCard | 34-358 | component | named | nao | { connection, onReconnect }: Props | timer\|upload_media |
| src/components/admin/ads/CostExplainerCard.tsx | CostExplainerCard | 21-145 | component | named | nao | { spendCents, clicks, leads, approved }: Props | - |
| src/components/admin/ads/CtwaConnectGuide.tsx | CtwaConnectGuide | 53-106 | component | named | nao | { consultantId }: Props | - |
| src/components/admin/ads/CtwaPreflightCard.tsx | CtwaPreflightCard | 45-99 | component | named | nao | { consultantId, onReadyChange, compact }: Props | - |
| src/components/admin/ads/EditCampaignDialog.tsx | EditCampaignDialog | 67-368 | component | named | nao | { open, onClose, campaign, onSaved }: Props | supabase.from\|edge_function\|timer |
| src/components/admin/ads/ExpressCampaignDialog.tsx | ExpressCampaignDialog | 32-383 | component | named | nao | { open, onClose, consultantId, onCreated, onOpenAdvanced }:  | timer\|upload_media |
| src/components/admin/ads/ExtendCampaignDialog.tsx | ExtendCampaignDialog | 24-150 | component | named | nao | { open, onOpenChange, campaign, onUpdated }: Props | edge_function |
| src/components/admin/ads/FunnelWithCosts.tsx | FunnelWithCosts | 43-180 | component | named | nao | { consultantId, spendCents, periodDays }: Props | supabase.from |
| src/components/admin/ads/HealthSummaryCard.tsx | HealthSummaryCard | 12-32 | component | named | nao | p: Props | - |
| src/components/admin/ads/InsightCards.tsx | InsightCards | 17-71 | component | named | nao | { consultantId }: { consultantId: string } | supabase.from |
| src/components/admin/ads/InsightsPanel.tsx | InsightsPanel | 28-200 | component | named | nao | { consultantId }: Props | supabase.from\|edge_function |
| src/components/admin/ads/IntelligenceTab.tsx | IntelligenceTab | 21-117 | component | named | nao | { consultantId }: Props | supabase.from |
| src/components/admin/ads/MetricTooltip.tsx | MetricTooltip | 5-22 | component | named | nao | { metric, className }: { metric: AdMetricKey; className?: st | - |
| src/components/admin/ads/PerformanceTab.tsx | PerformanceTab | 12-44 | component | named | nao | { consultantId, onGoToCentral }: Props | - |
| src/components/admin/ads/ResultsDashboard.tsx | ResultsDashboard | 39-447 | component | named | nao | {   consultantId,   onCreateClick,   externalRange,   hidePe | supabase.from |
| src/components/admin/ads/SaveTemplateDialog.tsx | SaveTemplateDialog | 19-66 | component | named | nao | {   open, onClose, defaultTitle, defaultDescription = "",    | - |
| src/components/admin/ads/SmartPublishButton.tsx | SmartPublishButton | 15-91 | component | named | nao | { template, consultantId, onPublished, onFallback }: Props | - |
| src/components/admin/ads/SyncMetricsButton.tsx | SyncMetricsButton | 29-200 | component | named | nao | { consultantId, onSynced, size = "sm" }: Props | edge_function |
| src/components/admin/ads/TemplateInfoCard.tsx | TemplateInfoCard | 62-321 | component | named | nao | {   template: t, mode, consultantId, footer,   onEdit, onTog | - |
| src/components/admin/ads/UseTemplateDialog.tsx | UseTemplateDialog | 27-287 | component | named | nao | { open, onClose, template, consultantId, onPublished }: Prop | supabase.from\|web_storage |
| src/components/admin/ads/WalletChip.tsx | WalletChip | 27-176 | component | named | nao | { consultantId }: { consultantId: string } | - |
| src/components/admin/ai/AiFeedbackPanel.tsx | AiFeedbackPanel | 67-272 | component | named | nao | { consultantId }: Props | supabase.from\|edge_function |
| src/components/admin/ai/AutoLearningTab.tsx | AutoLearningTab | 24-103 | component | named | nao | { consultantId }: Props | - |
| src/components/admin/ai/FlowFunnelPanel.tsx | FlowFunnelPanel | 64-214 | component | named | nao | { consultantId }: Props | supabase.from |
| src/components/admin/ai/LearningHealthPanel.tsx | LearningHealthPanel | 45-178 | component | named | nao | { consultantId }: Props | supabase.from\|edge_function |
| src/components/admin/AIAgentTab/AIDecisionsPanel.tsx | AIDecisionsPanel | 32-165 | component | named | nao | { userId }: { userId: string } | supabase.from |
| src/components/admin/AIAgentTab/AudioRecorderInline.tsx | AudioRecorderInline | 12-118 | component | named | nao | { onRecorded, disabled }: Props | timer\|upload_media |
| src/components/admin/AIAgentTab/BotTelemetryStrip.tsx | BotTelemetryStrip | 11-65 | component | named | nao | { userId }: { userId: string } | supabase.from |
| src/components/admin/AIAgentTab/index.tsx | AIAgentTab | 19-258 | component | named | nao | { userId, initialSubTab }: { userId: string; initialSubTab?: | supabase.from |
| src/components/admin/AIAgentTab/LiveConversationsPanel.tsx | LiveConversationsPanel | 57-444 | component | named | nao | { userId }: { userId: string } | supabase.from\|edge_function\|realtime |
| src/components/admin/AIAgentTab/ManualStepDialog.tsx | ManualStepDialog | 52-379 | component | named | nao | { open, onOpenChange, consultantId, customerId, customerName | supabase.from\|edge_function |
| src/components/admin/AIAgentTab/MediaColumn.tsx | MediaColumn | 146-705 | component | named | nao | { userId }: { userId: string } | supabase.from\|upload_media |
| src/components/admin/AIAgentTab/RoteiroColumn.tsx | RoteiroColumn | 9-129 | component | named | nao | { userId }: { userId: string } | supabase.from |
| src/components/admin/AIAgentTab/SlotCard.tsx | SlotCard | 40-181 | component | named | nao | { userId, slot, defaultMedia, personalMedia, onChange }: Pro | supabase.from\|upload_media |
| src/components/admin/AIAgentTab/SlotsPanel.tsx | SlotsPanel | 16-103 | component | named | nao | { userId }: Props | supabase.from |
| src/components/admin/AIChatPanel.tsx | AIChatPanel | 90-300 | component | named | nao | { open, onClose }: AIChatPanelProps | edge_function\|fetch\|timer |
| src/components/admin/AICostCard.tsx | AICostCard | 43-155 | component | named | nao | { userId, className }: { userId: string; className?: string  | supabase.from |
| src/components/admin/AnalyticsCharts.tsx | AnalyticsCharts | 25-189 | component | named | nao | { chartData, periodDays, analytics, weeklyNewCustomers }: An | - |
| src/components/admin/AudioStudio.tsx | purgeCachedTTS | 132-136 | function | named | sim | text: string | - |
| src/components/admin/AudioStudio.tsx | AudioStudio | 504-1575 | component | named | nao | { userId }: { userId: string } | supabase.from\|edge_function\|web_storage\|fetch\|timer\|upload_media |
| src/components/admin/AudioWhatsAppPopover.tsx | AudioWhatsAppPopover | 23-85 | component | named | nao | { audioUrl, label, trigger, size = "sm", className }: Props | edge_function |
| src/components/admin/BonusTiersAdminCard.tsx | BonusTiersAdminCard | 17-107 | component | named | nao |  | supabase.from |
| src/components/admin/CentralAutomacoesControle.tsx | CentralAutomacoesControle | 80-465 | component | named | nao | {   canToggle = true,   defaultSection = "controle",   class | supabase.from |
| src/components/admin/ChangePasswordCard.tsx | ChangePasswordCard | 32-184 | component | named | nao |  | - |
| src/components/admin/conversao/ConfigPanel.tsx | ConfigPanel | 48-224 | component | named | nao | { consultantId }: Props | supabase.from\|timer |
| src/components/admin/conversao/ConversaoCockpit.tsx | ConversaoCockpit | 87-568 | component | named | nao | { consultantId, initialView, onViewConsumed }: Props | supabase.from\|edge_function\|fetch\|timer |
| src/components/admin/conversao/ConversaoLeadDrawer.tsx | ConversaoLeadDrawer | 55-332 | component | named | nao | { lead, consultantId, onClose, onClassify, onReload, navigat | supabase.from\|edge_function\|fetch\|upload_media |
| src/components/admin/conversao/FrasesPanel.tsx | FrasesPanel | 43-219 | component | named | nao | { consultantId, availableSteps }: Props | supabase.from |
| src/components/admin/conversao/ResultadosPanel.tsx | ResultadosPanel | 61-256 | component | named | nao | { consultantId }: Props | - |
| src/components/admin/conversao/score.ts | priorityScore | 60-72 | function | named | nao | input: ScoreInput | - |
| src/components/admin/conversao/score.ts | priorityTier | 77-82 | function | named | nao | score: number | - |
| src/components/admin/conversao/score.ts | formatStuck | 111-118 | function | named | nao | hours: number \| null | - |
| src/components/admin/conversao/stepLabels.ts | stepLabel | 108-117 | function | named | nao | step: string \| null \| undefined, titleMap?: Map<string, st | - |
| src/components/admin/conversao/stepLabels.ts | loadFlowTitles | 123-144 | function | named | sim | steps: string[] | supabase.from |
| src/components/admin/CustomerCharts.tsx | CustomerCharts | 23-68 | component | named | nao | { filteredMetrics: _filteredMetrics, topLicenciados, consult | - |
| src/components/admin/DadosTab.tsx | DadosTab | 42-694 | component | named | nao | { form, photoPreview, saving, onFormChange, onPhotoChange, o | supabase.from |
| src/components/admin/dashboard/AdAccountSwitcher.tsx | AdAccountSwitcher | 11-32 | component | named | nao | { userId, value, onChange }: Props | - |
| src/components/admin/dashboard/AdMetricsCards.tsx | AdMetricsCards | 16-75 | component | named | nao | { consultantId, periodDays }: Props | supabase.from |
| src/components/admin/dashboard/AdMetricsCharts.tsx | AdMetricsCharts | 66-207 | component | named | nao | { consultantId, periodDays, managed }: Props | supabase.from |
| src/components/admin/dashboard/CpcPanel.tsx | CpcPanel | 15-79 | component | named | nao | { data = [], totalCtaClicks = 0 }: Props | - |
| src/components/admin/dashboard/FunnelStrip.tsx | FunnelStrip | 15-62 | component | named | nao | { funnel = [] }: Props | - |
| src/components/admin/dashboard/MainChart.tsx | MainChart | 30-90 | component | named | nao | { data = [] }: Props | - |
| src/components/admin/dashboard/RecentClicks.tsx | RecentClicks | 24-63 | component | named | nao | { clicks = [] }: Props | - |
| src/components/admin/DashboardTab.tsx | DashboardTab | 56-506 | component | named | nao | { userId, form, periodDays, onPeriodChange, onOpenChat }: Da | supabase.from\|web_storage\|timer |
| src/components/admin/financeiro/BoletosAdminTable.tsx | BoletosAdminTable | 57-453 | component | named | nao | {   rows,   currentUserId,   onOpenChat, }: {   rows: Boleto | supabase.from |
| src/components/admin/financeiro/BoletosPanel.tsx | BoletosPanel | 17-98 | component | named | nao | { userId, scope, onOpenChat }: Props | - |
| src/components/admin/financeiro/BoletosTrendChart.tsx | BoletosTrendChart | 9-38 | component | named | nao | { rows }: { rows: BoletoAdminRow[] } | - |
| src/components/admin/financeiro/CarteiraGreenAdminPanel.tsx | CarteiraGreenAdminPanel | 17-69 | component | named | nao | {   userId,   canPickConsultant, }: {   userId: string;   ca | supabase.from |
| src/components/admin/financeiro/CobrarBulkDialog.tsx | CobrarBulkDialog | 21-58 | component | named | nao | { open, onOpenChange, alvos, template, onConfirm }: Props | - |
| src/components/admin/financeiro/csvExport.ts | exportBoletosCsv | 7-55 | function | named | nao | rows: BoletoAdminRow[], filename = "boletos.csv" | upload_media |
| src/components/admin/financeiro/ExtratoPanel.tsx | ExtratoPanel | 38-273 | component | named | nao | { userId, isAdmin }: { userId: string; isAdmin: boolean } | supabase.from\|upload_media |
| src/components/admin/financeiro/FinanceiroPanel.tsx | FinanceiroPanel | 28-74 | component | named | nao | { userId, onOpenChat }: { userId: string; onOpenChat?: (phon | - |
| src/components/admin/financeiro/FinanceiroTabs.tsx | FinanceiroTabs | 19-49 | component | named | nao | { active, onChange, isAdmin }: Props | - |
| src/components/admin/financeiro/hooks.ts | useBoletosAdmin | 13-46 | hook | named | nao | params: { userId?: string; scope: "all" \| "self" } | supabase.from |
| src/components/admin/financeiro/hooks.ts | useUltimaCobrancaMap | 53-75 | hook | named | nao | customerIds: string[] | supabase.from |
| src/components/admin/financeiro/hooks.ts | useConsultantNames | 81-100 | hook | named | nao | ids: string[] | supabase.from |
| src/components/admin/financeiro/hooks.ts | useBoletoCobrancaTemplate | 107-121 | hook | named | nao |  | supabase.from |
| src/components/admin/financeiro/hooks.ts | renderCobrancaTemplate | 126-140 | function | named | nao | tpl: string, ctx: { nome?: string \| null; mes?: string \| n | - |
| src/components/admin/financeiro/kpi.ts | computeFinanceiroKpis | 31-91 | function | named | nao | rows: BoletoAdminRow[] | - |
| src/components/admin/financeiro/kpi.ts | computeBoletosTrend | 105-131 | function | named | nao | rows: BoletoAdminRow[], months = 6 | - |
| src/components/admin/financeiro/RecebiveisPanel.tsx | RecebiveisPanel | 13-119 | component | named | nao | { consultantId }: { consultantId: string } | - |
| src/components/admin/financeiro/RejeitarTopupDialog.tsx | RejeitarTopupDialog | 14-47 | component | named | nao | { open, onOpenChange, onConfirm }: Props | - |
| src/components/admin/financeiro/useAlertasBoletosCount.ts | useAlertasBoletosCount | 9-28 | hook | named | nao | userId: string \| undefined, scope: "all" \| "self" | supabase.from |
| src/components/admin/flow-builder/AiPreferencesCard.tsx | AiPreferencesCard | 61-225 | component | default | nao | { consultantId }: Props | supabase.from |
| src/components/admin/flow-builder/canonicalStepTypes.ts | validateCanonicalStep | 54-135 | function | named | nao | step: Step & {   step_type_canonical?: StepTypeCanonical;    | - |
| src/components/admin/flow-builder/channelPreview.ts | previewChoice | 28-71 | function | named | nao | prompt: string, choice: PreviewChoice, channel: PreviewChann | - |
| src/components/admin/flow-builder/ConversationPreview.tsx | ConversationPreview | 28-161 | component | default | nao | { steps, consultantName, focusStepId }: Props | - |
| src/components/admin/flow-builder/CreateFlowFromTemplateDialog.tsx | CreateFlowFromTemplateDialog | 124-596 | component | default | nao | {   open,   onOpenChange,   consultantId,   defaultVariant = | supabase.from\|edge_function |
| src/components/admin/flow-builder/diagram-v2/CanvasToolbar.tsx | CanvasToolbar | 30-106 | component | named | nao | {   onAutoLayout,   onExpandAll,   onCollapseAll,   onAddSte | - |
| src/components/admin/flow-builder/diagram-v2/FlowDiagramV2.tsx | FlowDiagramV2 | 459-465 | component | default | nao | props: FlowDiagramV2Props | - |
| src/components/admin/flow-builder/diagram-v2/useAutoLayout.ts | autoLayout | 10-40 | function | named | nao | nodes: Node[], edges: Edge[], opts: { direction?: LayoutDire | - |
| src/components/admin/flow-builder/diagram-v2/useFlowGraphV2.ts | useFlowGraphV2 | 50-139 | hook | named | nao | steps: Step[], expandedIds: Set<string>, warningStepIds: Set | - |
| src/components/admin/flow-builder/diagram/DiagramToolbar.tsx | DiagramToolbar | 137-428 | component | named | nao | {   searchQuery,   onSearchChange,   onSearchEnter,   search | - |
| src/components/admin/flow-builder/diagram/NodeContextMenu.tsx | NodeContextMenu | 104-307 | component | named | nao | {   state,   step,   onClose,   onEdit,   onDuplicate,   onT | - |
| src/components/admin/flow-builder/diagram/stepTypeColors.ts | getStepTypeColor | 96-99 | function | named | nao | stepType: string \| null \| undefined | - |
| src/components/admin/flow-builder/diagram/TransitionPopover.tsx | TransitionPopover | 126-418 | component | named | nao | {   state,   steps,   onConfirm,   onRemove,   onRedirect,   | - |
| src/components/admin/flow-builder/diagram/WarningBadge.tsx | WarningBadge | 38-91 | component | named | nao | { warnings, className }: WarningBadgeProps | - |
| src/components/admin/flow-builder/flowExits.ts | getStepExits | 178-211 | function | named | nao | step: Step, steps: Step[] | - |
| src/components/admin/flow-builder/FlowHealthDialog.tsx | FlowHealthDialog | 53-136 | component | default | nao | {   open, onOpenChange, validation, steps, actionLabel, onCo | - |
| src/components/admin/flow-builder/FlowReviewPanel.tsx | FlowReviewPanel | 56-336 | component | default | nao | {   open,   onOpenChange,   result,   loading,   error,   st | supabase.from |
| src/components/admin/flow-builder/FlowSimulator.tsx | FlowSimulator | 90-658 | component | default | nao | { open, onOpenChange, consultantId }: Props | supabase.from\|edge_function\|web_storage\|upload_media |
| src/components/admin/flow-builder/FlowSpreadsheet.tsx | FlowSpreadsheet | 66-322 | component | default | nao | {   steps,   flowId,   variant,   mediaCounts,   onOpenStep, | - |
| src/components/admin/flow-builder/FlowTemplatesDialog.tsx | FlowTemplatesDialog | 19-111 | component | default | nao | { open, onOpenChange, flowId, currentMaxPosition, onApplied  | supabase.from |
| src/components/admin/flow-builder/FlowTourOverlay.tsx | FlowTourOverlay | 56-122 | component | default | nao | { open, onClose }: Props | web_storage |
| src/components/admin/flow-builder/FlowTourOverlay.tsx | tourPendente | 125-128 | function | named | nao |  | web_storage |
| src/components/admin/flow-builder/flowTypes.ts | isDeterministicIntent | 61-66 | function | named | nao | intent: string \| null \| undefined | - |
| src/components/admin/flow-builder/flowTypes.ts | parseTransitions | 240-250 | function | named | nao | raw: unknown | - |

_… e mais 157 exportadas neste domínio (ver inventário JSON da sessão)._

## Domínio: `features` (442 total, 231 exportadas)

| Arquivo | Nome | Linhas | Tipo | Export | Async | Params | Deps |
|---|---|---|---|---|---|---|---|
| src/features/help/helpCatalog.ts | searchHelpCatalog | 78-91 | function | named | nao | query: string, category = "all", source: HelpArticle[] = HEL | - |
| src/features/help/helpCatalog.ts | mergeHelpArticles | 93-108 | function | named | nao | rows: TourArticle[], steps: TourStep[] | - |
| src/features/onboarding/InlineHelpButton.tsx | InlineHelpButton | 12-34 | component | named | nao | { title, body, ctaLabel, ctaHref }: Props | - |
| src/features/onboarding/TourProvider.tsx | TourProvider | 14-126 | component | named | nao |  | timer |
| src/features/onboarding/useTour.tsx | TourStateProvider | 144-147 | component | named | nao | { children }: { children: ReactNode } | - |
| src/features/onboarding/useTour.tsx | useTour | 149-153 | hook | named | nao |  | - |
| src/features/produtos/acompanhamento/AcompanhamentoPanel.tsx | AcompanhamentoPanel | 57-392 | component | named | nao | {   consultantId,   onOpenPosVenda,   onOpenSettings, }: Aco | - |
| src/features/produtos/acompanhamento/aggregate.ts | estimateCommission | 64-82 | function | named | nao | rule: CommissionRule, sale: Sale | - |
| src/features/produtos/acompanhamento/aggregate.ts | summarizeSales | 85-125 | function | named | nao | sales: Sale[], products: Product[] | - |
| src/features/produtos/acompanhamento/aggregate.ts | filterSalesByProduct | 128-131 | function | named | nao | sales: Sale[], productId: string \| "all" | - |
| src/features/produtos/acompanhamento/aggregate.ts | filterProposalsByProduct | 134-140 | function | named | nao | proposals: Proposal[], productId: string \| "all" | - |
| src/features/produtos/acompanhamento/aggregate.ts | computeFinancialMetrics | 143-175 | function | named | nao | sales: Sale[], products: Product[], proposals: Proposal[] =  | - |
| src/features/produtos/acompanhamento/AutomacaoIgreenCard.tsx | AutomacaoIgreenCard | 35-95 | component | named | nao | { consultantId }: { consultantId?: string } | - |
| src/features/produtos/acompanhamento/AutomacoesAtivasBadge.tsx | AutomacoesAtivasBadge | 44-130 | component | named | nao | { consultantId, variant = "chip", className = "" }: Props | - |
| src/features/produtos/acompanhamento/automationSettings.ts | useAutomationSettings | 41-55 | hook | named | nao | consultantId?: string | supabase.from |
| src/features/produtos/acompanhamento/automationSettings.ts | useUpdateAutomationSetting | 57-69 | hook | named | nao | consultantId?: string | supabase.from |
| src/features/produtos/acompanhamento/careerPlan.ts | computeCareerProgress | 46-67 | function | named | nao | totalKwh: number | - |
| src/features/produtos/acompanhamento/CrossSellCard.tsx | CrossSellCard | 100-292 | component | named | nao | { consultantId }: { consultantId?: string } | timer |
| src/features/produtos/acompanhamento/crossSellConfig.ts | parseCrossSellVariables | 34-54 | function | named | nao | raw: unknown | - |
| src/features/produtos/acompanhamento/crossSellConfig.ts | buildCrossSellVariables | 56-62 | function | named | nao | prefs: CrossSellPrefs | - |
| src/features/produtos/acompanhamento/crossSellConfig.ts | produtoLabelForGaps | 65-70 | function | named | nao | gaps: { telecom: boolean; seguros: boolean } | - |
| src/features/produtos/acompanhamento/crossSellConfig.ts | applyCrossSellTemplate | 76-89 | function | named | nao | template: string, opts: { fullName?: string \| null; produto | - |
| src/features/produtos/acompanhamento/crossSellConfig.ts | applyCrossSellNome | 92-94 | function | named | nao | template: string, fullName?: string \| null | - |
| src/features/produtos/acompanhamento/crossSellConfig.ts | phoneMatchKeys | 97-108 | function | named | nao | raw?: string \| null | - |
| src/features/produtos/acompanhamento/crossSellConfig.ts | buildPhoneKeySet | 110-116 | function | named | nao | phones: Array<string \| null \| undefined> | - |
| src/features/produtos/acompanhamento/crossSellConfig.ts | phoneInSet | 118-120 | function | named | nao | set: Set<string>, phone?: string \| null | - |
| src/features/produtos/acompanhamento/crossSellConfig.ts | normName | 122-128 | function | named | nao | n?: string \| null | - |
| src/features/produtos/acompanhamento/crossSellConfig.ts | hasProductMatch | 133-144 | function | named | nao | opts: {   leadPhone?: string \| null;   leadName?: string \| | - |
| src/features/produtos/acompanhamento/CrossSellConfigDialog.tsx | CrossSellConfigDialog | 48-252 | component | named | nao | { open, onOpenChange, consultantId, onSaved }: Props | supabase.from |
| src/features/produtos/acompanhamento/EntradaRulesDialog.tsx | EntradaRulesDialog | 38-257 | component | named | nao | { consultantId, trigger }: Props | supabase.from |
| src/features/produtos/acompanhamento/FaturasGreenPanel.tsx | FaturasGreenPanel | 20-113 | component | named | nao | { clients, onOpenPosVenda }: FaturasGreenPanelProps | - |
| src/features/produtos/acompanhamento/greenCommission.ts | graduacaoDisplay | 72-75 | function | named | nao | graduacao?: string \| null | - |
| src/features/produtos/acompanhamento/greenCommission.ts | graduacaoRank | 78-82 | function | named | nao | graduacao?: string \| null | - |
| src/features/produtos/acompanhamento/greenCommission.ts | resolveGraduacao | 85-97 | function | named | nao | ...sources: (string \| null \| undefined)[] | - |
| src/features/produtos/acompanhamento/greenCommission.ts | estimateBillValue | 115-130 | function | named | nao | electricityBill: number \| null \| undefined, mediaConsumo:  | - |
| src/features/produtos/acompanhamento/greenCommission.ts | isValidadoIgreen | 140-154 | function | named | nao | andamento?: string \| null | - |
| src/features/produtos/acompanhamento/greenCommission.ts | isDirectCustomer | 169-192 | function | named | nao | registeredByIgreenId: string \| null \| undefined, registere | - |
| src/features/produtos/acompanhamento/greenCommission.ts | isReducedRecurring | 215-219 | function | named | nao | uf?: string \| null, distribuidora?: string \| null | - |
| src/features/produtos/acompanhamento/greenCommission.ts | baseRecurringPercent | 222-226 | function | named | nao | isDirect: boolean, uf?: string \| null, distribuidora?: stri | - |
| src/features/produtos/acompanhamento/greenCommission.ts | careerBonusPercent | 231-233 | function | named | nao | graduacao?: string \| null | - |
| src/features/produtos/acompanhamento/greenCommission.ts | countDirectByDistribuidora | 241-250 | function | named | nao | customers: GreenCustomerInput[] | - |
| src/features/produtos/acompanhamento/greenCommission.ts | resolveEntradaTier | 258-283 | function | named | nao | rules: EntradaRule[], distribuidora: string \| null, counts: | supabase.from |
| src/features/produtos/acompanhamento/greenCommission.ts | computeGreenGains | 329-374 | function | named | nao | customers: GreenCustomerInput[], rules: EntradaRule[], setti | - |
| src/features/produtos/acompanhamento/greenData.ts | loadLocalGreenSettings | 71-78 | function | named | nao | consultantId: string | web_storage |
| src/features/produtos/acompanhamento/greenData.ts | saveLocalGreenSettings | 80-87 | function | named | nao | consultantId: string, partial: Partial<GreenSettings> | web_storage |
| src/features/produtos/acompanhamento/greenData.ts | fetchGreenSettings | 159-211 | function | named | sim | consultantId: string | supabase.from |
| src/features/produtos/acompanhamento/greenData.ts | saveGreenProfile | 214-230 | function | named | sim | consultantId: string, patch: Partial<Pick<GreenSettings, "gr | supabase.from |
| src/features/produtos/acompanhamento/greenData.ts | saveCountMode | 232-234 | function | named | sim | consultantId: string, mode: CountMode | - |
| src/features/produtos/acompanhamento/greenData.ts | fetchEntradaRules | 236-246 | function | named | sim | consultantId: string | supabase.from |
| src/features/produtos/acompanhamento/greenData.ts | upsertEntradaRule | 258-274 | function | named | sim | consultantId: string, input: UpsertEntradaRuleInput | supabase.from |
| src/features/produtos/acompanhamento/greenData.ts | deleteEntradaRule | 276-282 | function | named | sim | id: string | supabase.from |
| src/features/produtos/acompanhamento/greenData.ts | fetchValidatedCustomers | 386-440 | function | named | sim | consultantId: string | - |
| src/features/produtos/acompanhamento/greenHooks.ts | useGreenSettings | 21-27 | hook | named | nao | consultantId: string \| undefined | - |
| src/features/produtos/acompanhamento/greenHooks.ts | useEntradaRules | 29-35 | hook | named | nao | consultantId: string \| undefined | - |
| src/features/produtos/acompanhamento/greenHooks.ts | useValidatedCustomers | 37-43 | hook | named | nao | consultantId: string \| undefined | - |
| src/features/produtos/acompanhamento/greenHooks.ts | useSaveCountMode | 45-54 | hook | named | nao | consultantId: string \| undefined | - |
| src/features/produtos/acompanhamento/greenHooks.ts | useSaveGreenProfile | 56-66 | hook | named | nao | consultantId: string \| undefined | - |
| src/features/produtos/acompanhamento/greenHooks.ts | useUpsertEntradaRule | 68-74 | hook | named | nao | consultantId: string \| undefined | - |
| src/features/produtos/acompanhamento/greenHooks.ts | useDeleteEntradaRule | 76-82 | hook | named | nao | consultantId: string \| undefined | - |
| src/features/produtos/acompanhamento/greenHooks.ts | useLastIgreenSync | 85-100 | hook | named | nao |  | supabase.from |
| src/features/produtos/acompanhamento/multiprodutoHooks.ts | useTelecomCustomers | 33-47 | hook | named | nao | consultantId?: string | supabase.from |
| src/features/produtos/acompanhamento/multiprodutoHooks.ts | useSegurosCustomers | 49-63 | hook | named | nao | consultantId?: string | supabase.from |
| src/features/produtos/acompanhamento/VendasEmAndamentoPanel.tsx | VendasEmAndamentoPanel | 66-228 | component | named | nao | { consultantId }: VendasEmAndamentoPanelProps | - |
| src/features/produtos/captura/CaptureForm.tsx | CaptureForm | 54-107 | component | named | nao | {   family,   defaultValues,   onSubmit,   submitting,   emb | - |
| src/features/produtos/captura/schemas.ts | hasCaptureForm | 74-76 | function | named | nao | family: ProductFamily | - |
| src/features/produtos/captura/schemas.ts | validateCaptureForFamily | 111-142 | function | named | nao | family: ProductFamily, captureData: unknown, opts?: { requir | - |
| src/features/produtos/carteira-green/BoletosList.tsx | BoletosList | 21-208 | component | named | nao | { boletos }: { boletos: BoletoRow[] } | - |
| src/features/produtos/carteira-green/CarteiraGreenPanel.tsx | CarteiraGreenPanel | 22-198 | component | named | nao | { consultantId }: { consultantId: string } | supabase.from\|timer |
| src/features/produtos/carteira-green/ClienteDetalheDrawer.tsx | ClienteDetalheDrawer | 52-271 | component | named | nao | {   cliente,   open,   onOpenChange, }: {   cliente: Cliente | - |
| src/features/produtos/carteira-green/ClientesCarteiraTable.tsx | ClientesCarteiraTable | 25-321 | component | named | nao | {   consultantId,   boletos,   devolutivas, }: {   consultan | supabase.from |
| src/features/produtos/carteira-green/ConsultantMetricsCard.tsx | ConsultantMetricsCard | 14-149 | component | named | nao | {   consultantId,   defaultOpen = false, }: {   consultantId | supabase.from |
| src/features/produtos/carteira-green/DevolutivasList.tsx | DevolutivasList | 6-98 | component | named | nao | { devolutivas }: { devolutivas: DevolutivaRow[] } | supabase.from |
| src/features/produtos/carteira-green/EndpointDiscoveryCard.tsx | EndpointDiscoveryCard | 38-216 | component | named | nao | { consultantId }: { consultantId: string } | supabase.from\|edge_function |
| src/features/produtos/carteira-green/hooks.ts | useBoletosCarteira | 50-66 | hook | named | nao | consultantId?: string | supabase.from |
| src/features/produtos/carteira-green/hooks.ts | useDevolutivasCarteira | 68-86 | hook | named | nao | consultantId?: string | supabase.from |
| src/features/produtos/carteira-green/hooks.ts | computeCarteiraStats | 100-135 | function | named | nao | boletos: BoletoRow[] | - |
| src/features/produtos/carteira-green/intent.ts | scoreIntent | 16-38 | function | named | nao | current: BoletoLike, history: BoletoLike[] | - |
| src/features/produtos/carteira-green/PaymentIntent.tsx | PaymentIntent | 8-71 | component | named | nao | { boletos }: { boletos: BoletoRow[] } | - |
| src/features/produtos/carteira-green/RedeDashboardCard.tsx | RedeDashboardCard | 27-68 | component | named | nao | { consultantId }: { consultantId: string } | supabase.from |
| src/features/produtos/carteira-green/RotinasPanel.tsx | RotinasPanel | 42-120 | component | named | nao | { consultantId }: { consultantId: string } | supabase.from |
| src/features/produtos/carteira-green/searchUtils.ts | norm | 2-7 | function | named | nao | s: string \| null \| undefined | - |
| src/features/produtos/carteira-green/SegurosClientesList.tsx | SegurosClientesList | 29-124 | component | named | nao | { consultantId }: { consultantId: string } | supabase.from |
| src/features/produtos/carteira-green/StatusCards.tsx | StatusCards | 4-73 | component | named | nao | { stats }: { stats: CarteiraStats } | - |
| src/features/produtos/carteira-green/TelecomClientesList.tsx | TelecomClientesList | 30-130 | component | named | nao | { consultantId }: { consultantId: string } | supabase.from |
| src/features/produtos/catalogo/api.ts | mapProductRow | 44-59 | function | named | nao | row: ProductRow | - |
| src/features/produtos/catalogo/api.ts | fetchProducts | 62-81 | function | named | sim | options?: {   family?: ProductFamily;   includeInactive?: bo | supabase.from |
| src/features/produtos/catalogo/api.ts | fetchProductBySlug | 84-93 | function | named | sim | slug: string | supabase.from |
| src/features/produtos/catalogo/api.ts | updateProductActive | 96-108 | function | named | sim | productId: string, isActive: boolean | supabase.from |
| src/features/produtos/catalogo/hooks.ts | useProducts | 15-24 | hook | named | nao | options?: {   family?: ProductFamily;   includeInactive?: bo | - |
| src/features/produtos/catalogo/hooks.ts | useProduct | 27-34 | hook | named | nao | slug: string \| undefined | - |
| src/features/produtos/catalogo/hooks.ts | useUpdateProductActive | 37-46 | hook | named | nao |  | - |
| src/features/produtos/catalogo/ProductCatalogTable.tsx | ProductCatalogTable | 71-283 | component | named | nao | { consultantId }: { consultantId?: string } | supabase.from |
| src/features/produtos/catalogo/ProductLandingSections.tsx | ProductLandingSections | 29-48 | component | named | nao | {   product,   ctaUrl,   showHero = true, }: ProductLandingS | - |
| src/features/produtos/catalogo/resolveLanding.ts | resolveLanding | 43-87 | function | named | nao | product: Product \| null \| undefined, slug: string | - |
| src/features/produtos/crm/RegistrarVendaDialog.tsx | RegistrarVendaDialog | 55-361 | component | named | nao | {   consultantId,   open,   onOpenChange, }: RegistrarVendaD | supabase.from |
| src/features/produtos/crm/SaleHistoryTimeline.tsx | SaleHistoryTimeline | 15-55 | component | named | nao | { saleId }: SaleHistoryTimelineProps | - |
| src/features/produtos/crm/SalesPipelineBoard.tsx | SalesPipelineBoard | 81-437 | component | named | nao | { consultantId }: SalesPipelineBoardProps | supabase.from |
| src/features/produtos/esteira/api.ts | fetchTemplate | 55-63 | function | named | sim |  | supabase.from |
| src/features/produtos/esteira/api.ts | addStage | 65-73 | function | named | sim | name: string, position: number, productFamily?: string \| nu | supabase.from |
| src/features/produtos/esteira/api.ts | renameStage | 75-81 | function | named | sim | id: string, name: string | supabase.from |

_… e mais 131 exportadas neste domínio (ver inventário JSON da sessão)._

## Domínio: `components-whatsapp` (367 total, 95 exportadas)

| Arquivo | Nome | Linhas | Tipo | Export | Async | Params | Deps |
|---|---|---|---|---|---|---|---|
| src/components/whatsapp/AddCustomerDialog.tsx | AddCustomerDialog | 49-393 | component | named | nao | {   open,   onOpenChange,   phone,   name: initialName,   co | supabase.from\|fetch |
| src/components/whatsapp/AddLeadDialog.tsx | AddLeadDialog | 38-276 | component | named | nao | { consultantId, stages, onLeadAdded }: AddLeadDialogProps | supabase.from |
| src/components/whatsapp/AgendamentosHub.tsx | AgendamentosHub | 166-1209 | component | named | nao | {   consultantId,   instanceName,   defaultTab = "overview", | supabase.from\|edge_function |
| src/components/whatsapp/AgendamentosTextosDialog.tsx | AgendamentosTextosDialog | 202-1395 | component | named | nao | { open, onOpenChange, consultantId }: Props | supabase.from |
| src/components/whatsapp/AiSuggestReplies.tsx | AiSuggestReplies | 25-144 | component | named | nao | { customerId, disabled, onPick }: AiSuggestRepliesProps | edge_function |
| src/components/whatsapp/ApproveBillValueDialog.tsx | needsBillValueForApproval | 42-47 | function | named | nao | _pendingStage: string \| null \| undefined, _bill: number \| | - |
| src/components/whatsapp/ApproveBillValueDialog.tsx | ApproveBillValueDialog | 56-146 | component | default | nao | { customer, open, onOpenChange, onSaved, targetStage }: Prop | supabase.from |
| src/components/whatsapp/AttendanceRatingsCard.tsx | AttendanceRatingsCard | 46-160 | component | named | nao | {   consultantId,   className, }: {   consultantId: string;  | supabase.from |
| src/components/whatsapp/AttendanceStatusBar.tsx | AttendanceStatusBar | 37-171 | component | named | nao | {   state,   protocol,   rating,   starting,   ending,   onS | - |
| src/components/whatsapp/AutoMessageLog.tsx | AutoMessageLog | 102-231 | component | named | nao | { consultantId }: AutoMessageLogProps | supabase.from\|realtime |
| src/components/whatsapp/BlockConfigurator.tsx | BlockConfigurator | 58-183 | component | named | nao | { config, onConfigChange, totalContacts, disabled, dailySent | - |
| src/components/whatsapp/bulk-pro/BulkProPanel.tsx | BulkProPanel | 95-795 | component | named | nao | { instanceName, customers, templates, consultantId, seedCont | supabase.from\|timer |
| src/components/whatsapp/bulk-pro/MessageEditor.tsx | MessageEditor | 44-387 | component | named | nao | { consultantId, text, onTextChange, media, onMediaChange, pr | upload_media |
| src/components/whatsapp/bulk-pro/ScheduleStep.tsx | ScheduleStep | 24-180 | component | named | nao | { config, onChange, totalContacts }: Props | - |
| src/components/whatsapp/bulk-pro/spintax.ts | expandSpintax | 2-16 | function | named | nao | input: string | - |
| src/components/whatsapp/bulk-pro/spintax.ts | applyVars | 19-37 | function | named | nao | template: string, ctx: { name?: string; bill?: number; city? | - |
| src/components/whatsapp/bulk-pro/spintax.ts | renderFinal | 39-44 | function | named | nao | template: string, ctx: Parameters<typeof applyVars>[1] | - |
| src/components/whatsapp/bulk-pro/useCampaignPersistence.ts | createCampaign | 17-62 | function | named | sim | input: {   consultantId: string;   name: string;   messageTe | supabase.from |
| src/components/whatsapp/bulk-pro/useCampaignPersistence.ts | updateCampaignStatus | 64-68 | function | named | sim | id: string, patch: Partial<{   status: string; sent: number; | supabase.from |
| src/components/whatsapp/bulk-pro/useCampaignPersistence.ts | updateTargetStatus | 70-80 | function | named | sim | campaignId: string, phone: string, patch: Partial<{ status:  | supabase.from |
| src/components/whatsapp/bulk-pro/useCampaignPersistence.ts | listCampaigns | 82-91 | function | named | sim | consultantId: string, limit = 20 | supabase.from |
| src/components/whatsapp/bulk-pro/useCampaignPersistence.ts | deleteCampaign | 93-95 | function | named | sim | id: string | supabase.from |
| src/components/whatsapp/bulk-pro/useCampaignPersistence.ts | loadCampaignForResume | 111-148 | function | named | sim | id: string | supabase.from |
| src/components/whatsapp/BulkBlockSendPanel.tsx | BulkBlockSendPanel | 80-659 | component | named | nao | { instanceName, customers, templates, applyTemplate, consult | supabase.from\|timer |
| src/components/whatsapp/BulkSendPanel.tsx | BulkSendPanel | 90-720 | component | named | nao | { instanceName, customers, templates, applyTemplate }: BulkS | supabase.from\|timer |
| src/components/whatsapp/ChatSidebar.tsx | ChatSidebar | 87-512 | component | named | nao | { chats, isLoading, selectedJid, onSelectChat, consultantId  | supabase.from\|web_storage\|timer |
| src/components/whatsapp/ChatView.tsx | ChatView | 74-1388 | component | named | nao | { instanceName, chat, templates, consultantId, initialMessag | supabase.from\|web_storage\|fetch\|timer |
| src/components/whatsapp/ConnectionPanel.tsx | ConnectionPanel | 151-611 | component | named | nao | {   connectionStatus,   qrCode,   qrGeneratedAt,   instanceN | timer |
| src/components/whatsapp/ContactImporter.tsx | ContactImporter | 168-978 | component | named | nao | { customers, contacts, onContactsChange, disabled, instanceN | supabase.from |
| src/components/whatsapp/CrmTabs.tsx | CrmTabs | 9-15 | component | named | nao | { consultantId, instanceName }: CrmTabsProps | - |
| src/components/whatsapp/CustomerEditDialog.tsx | CustomerEditDialog | 52-297 | component | named | nao | { customer, onClose, onSaved }: CustomerEditDialogProps | supabase.from\|fetch |
| src/components/whatsapp/CustomerImportExport.tsx | CustomerImportExport | 33-359 | component | named | nao | { customers, filtered, consultantId, onCustomersChange, asMe | supabase.from |
| src/components/whatsapp/CustomerListItem.tsx | CustomerListItem | 117-342 | component | named | nao | {   customer: c, isExpanded, profilePic, deal,   onToggleExp | - |
| src/components/whatsapp/CustomerManager.tsx | CustomerManager | 45-665 | component | named | nao | {   customers,   consultantId,   consultantIgreenId,   consu | supabase.from\|web_storage\|timer |
| src/components/whatsapp/CustomerQuickViewDialog.tsx | CustomerQuickViewDialog | 166-433 | component | default | nao | { customerId, dealId, customerName, phone, onClose }: Custom | supabase.from |
| src/components/whatsapp/customerUtils.ts | formatPhoneDisplay | 69-75 | function | named | nao | phone: string | - |
| src/components/whatsapp/customerUtils.ts | formatCpfDisplay | 77-81 | function | named | nao | cpf: string | - |
| src/components/whatsapp/customerUtils.ts | getInitials | 83-86 | function | named | nao | name: string \| null | - |
| src/components/whatsapp/customerUtils.ts | getStatusBadge | 88-98 | function | named | nao | status: string \| null \| undefined | - |
| src/components/whatsapp/customerUtils.ts | normalizePhone | 100-108 | function | named | nao | raw: string | - |
| src/components/whatsapp/customerUtils.ts | normalizeCustomerPhone | 110-112 | function | named | nao | value: string \| null \| undefined | - |
| src/components/whatsapp/customerUtils.ts | mapStatus | 114-128 | function | named | nao | andamento: string \| undefined | - |
| src/components/whatsapp/customerUtils.ts | safeString | 130-134 | function | named | nao | val: unknown | - |
| src/components/whatsapp/customerUtils.ts | safeNumber | 136-140 | function | named | nao | val: unknown | - |
| src/components/whatsapp/customerUtils.ts | findColumnValue | 142-149 | function | named | nao | row: Record<string, unknown>, ...keys: string[] | - |
| src/components/whatsapp/customerUtils.ts | buildWhatsAppMessage | 151-160 | function | named | nao | customer: Customer | - |
| src/components/whatsapp/customerUtils.ts | isDevolutiva | 162-164 | function | named | nao | c: Customer | - |
| src/components/whatsapp/customerUtils.ts | getStageDotsForCustomer | 166-175 | function | named | nao | status: string \| null \| undefined, deal?: { stage: string; | - |
| src/components/whatsapp/customerUtils.ts | buildCustomerData | 177-268 | function | named | nao | row: Record<string, unknown> | - |
| src/components/whatsapp/DropConfirmDialog.tsx | DropConfirmDialog | 166-321 | component | named | nao | {   open,   onClose,   onConfirm,   stageLabel,   stageKey,  | supabase.from |
| src/components/whatsapp/FlowQuickBar.tsx | FlowQuickBar | 64-539 | component | named | nao | { consultantId, customerId, customerName, disabled }: Props | supabase.from\|edge_function |
| src/components/whatsapp/InstanceHealth.tsx | InstanceHealth | 80-331 | component | named | nao | { instanceName }: InstanceHealthProps | supabase.from\|timer |
| src/components/whatsapp/KanbanBoard.tsx | KanbanBoard | 34-334 | component | named | nao | { consultantId, instanceName }: KanbanBoardProps | supabase.from\|timer |
| src/components/whatsapp/KanbanColumn.tsx | KanbanColumn | 25-117 | component | named | nao | { stage, deals, searchQuery, stepFilter = "all", customStepM | - |
| src/components/whatsapp/KanbanDealCard.tsx | KanbanDealCard | 19-148 | component | named | nao | { deal, stepInfo, onDragStart, onEdit, onDelete, onReclassif | - |
| src/components/whatsapp/KanbanSlaIndicator.tsx | KanbanSlaIndicator | 20-62 | component | named | nao | {   enteredAt,   warningDays = 3,   criticalDays = 7,   clas | - |
| src/components/whatsapp/MediaLibraryPicker.tsx | MediaLibraryPicker | 158-402 | component | named | nao | {   kind,   consultantId,   onSelect,   triggerLabel,   open | supabase.from\|upload_media |
| src/components/whatsapp/MessageBubble.tsx | MessageBubble | 452-612 | component | named | nao | { message, onLoadMedia, consultantId, customerId, onAttachTo | - |
| src/components/whatsapp/MessageComposer.tsx | MessageComposer | 41-291 | component | named | nao | { onSend, onSendAudio, onSendAudioUrl, onSendMedia, template | timer\|upload_media |
| src/components/whatsapp/MessagePanel.tsx | filterCustomers | 19-23 | function | named | nao | customers: T[], search: string | - |
| src/components/whatsapp/MessagePanel.tsx | MessagePanel | 25-119 | component | named | nao | { instanceName, customers, templates, applyTemplate }: Messa | - |
| src/components/whatsapp/MonthlyCostsCard.tsx | MonthlyCostsCard | 32-184 | component | named | nao | { userId, className }: { userId: string; className?: string  | supabase.from |
| src/components/whatsapp/PendingApprovalDialog.tsx | PendingApprovalDialog | 54-827 | component | default | nao | { consultantId, onResolved, openSignal }: Props | supabase.from\|realtime |
| src/components/whatsapp/PosVendaAutoConfigDialog.tsx | PosVendaAutoConfigDialog | 26-130 | component | default | nao | { consultantId }: { consultantId: string } | supabase.from |
| src/components/whatsapp/PosVendaKanban.tsx | PosVendaKanban | 74-657 | component | default | nao | {   consultantId,   initialCustomerId,   onInitialCustomerCo | supabase.from\|edge_function |
| src/components/whatsapp/PosVendaSetupWizard.tsx | PosVendaSetupWizard | 92-666 | component | default | nao | { consultantId, open, onOpenChange, onComplete }: Props | supabase.from\|upload_media |
| src/components/whatsapp/QuickReplyMenu.tsx | QuickReplyMenu | 14-108 | component | named | nao | { templates, search, onSelect, onClose, onExactShortcut }: Q | - |
| src/components/whatsapp/QuickTemplateForm.tsx | QuickTemplateForm | 22-147 | component | named | nao | {   templates, selectedTemplate, onSelectTemplate,   message | - |
| src/components/whatsapp/RodiziosBroadcastPanel.tsx | RodiziosBroadcastPanel | 28-179 | component | named | nao | { consultantId }: Props | supabase.from |
| src/components/whatsapp/SalesFunnelBoard.tsx | SalesFunnelBoard | 16-156 | component | named | nao | { consultantId, onOpenChat }: SalesFunnelBoardProps | - |
| src/components/whatsapp/SalesFunnelCard.tsx | SalesFunnelCard | 22-103 | component | named | nao | { lead, onDragStart, onClick }: SalesFunnelCardProps | - |
| src/components/whatsapp/SaveMessageAsTemplateDialog.tsx | SaveMessageAsTemplateDialog | 48-332 | component | named | nao | { open, onOpenChange, message, consultantId, loadedMediaUrl, | supabase.from\|edge_function\|fetch\|realtime\|upload_media |
| src/components/whatsapp/StageAutoMessageConfig.tsx | StageAutoMessageConfig | 368-612 | component | named | nao | {   stageId,   stageLabel,   stageKey,   consultantId,   aut | supabase.from |
| src/components/whatsapp/StepPartPreview.tsx | StepPartPreview | 20-73 | component | named | nao | { kind, text, url, fileName, compact }: Props | - |
| src/components/whatsapp/TemplateManager.tsx | TemplateManager | 25-187 | component | named | nao | {   templates,   isLoading,   consultantId,   onCreateTempla | - |
| src/components/whatsapp/TemplatePickerPopover.tsx | TemplatePickerPopover | 34-209 | component | named | nao | { consultantId, onPick, trigger }: Props | - |
| src/components/whatsapp/templates/AddImageToTemplate.tsx | AddImageToTemplate | 12-47 | component | named | nao | { templateId, onUpdateTemplate }: Props | upload_media |
| src/components/whatsapp/templates/TemplateCreateForm.tsx | TemplateCreateForm | 21-86 | component | named | nao | { onCreateTemplate }: Props | - |
| src/components/whatsapp/templates/TemplateItemsEditor.tsx | emptyTemplateItem | 32-34 | function | named | nao | position: number | - |
| src/components/whatsapp/templates/TemplateItemsEditor.tsx | TemplateItemsEditor | 227-273 | component | named | nao | {   items, onItemsChange, templateName, disabled, }: {   ite | - |
| src/components/whatsapp/templates/TemplateItemsEditor.tsx | templateItemsValid | 276-280 | function | named | nao | items: TemplateItem[] | - |
| src/components/whatsapp/templates/TemplateListItem.tsx | TemplateListItem | 23-224 | component | named | nao | { template: t, consultantId, onUpdateTemplate, onDeleteTempl | supabase.from |
| src/components/whatsapp/templates/TemplatePreviewDialog.tsx | TemplatePreviewDialog | 42-114 | component | named | nao | { template, onClose }: Props | - |
| src/components/whatsapp/templates/templateUtils.tsx | mediaIcon | 12-20 | function | named | nao | type: TemplateMediaType | - |
| src/components/whatsapp/templates/templateUtils.tsx | mediaBadge | 22-36 | function | named | nao | type: TemplateMediaType | - |
| src/components/whatsapp/templates/templateUtils.tsx | formatRecordingTime | 38-42 | function | named | nao | s: number | - |
| src/components/whatsapp/voice/VoiceClipRecorder.tsx | VoiceClipRecorder | 27-95 | component | named | nao | { consultantId, slug, idleLabel = "Gravar", hasAudioLabel, s | timer\|upload_media |
| src/components/whatsapp/voice/VoiceNamesLibrary.tsx | VoiceNamesLibrary | 16-113 | component | named | nao | { consultantId, clips, onUpsert, onDelete }: Props | - |
| src/components/whatsapp/voice/VoiceTemplateEditor.tsx | VoiceTemplateEditor | 37-297 | component | named | nao | {   consultantId, template, clips, onUpdate,   onAddBlock, o | - |
| src/components/whatsapp/voice/VoiceTemplatePicker.tsx | VoiceTemplatePicker | 31-260 | component | named | nao | { consultantId, customerName, onSendAudioUrl, disabled }: Pr | - |
| src/components/whatsapp/voice/VoiceTemplatesPanel.tsx | VoiceTemplatesPanel | 13-131 | component | named | nao | { consultantId }: Props | - |
| src/components/whatsapp/WhapiBillingBanner.tsx | WhapiBillingBanner | 15-59 | component | named | nao | { enabled }: Props | - |
| src/components/whatsapp/WhapiConnectionPanel.tsx | WhapiConnectionPanel | 23-554 | component | named | nao | { visible }: Props | edge_function\|timer |
| src/components/whatsapp/WhatsAppDashboard.tsx | WhatsAppDashboard | 38-424 | component | named | nao | { consultantId }: WhatsAppDashboardProps | supabase.from |
| src/components/whatsapp/WhatsAppTab.tsx | WhatsAppTab | 67-543 | component | named | nao | { userId, pendingChatPhone, pendingChatMessage, onPendingCha | web_storage |

## Domínio: `hooks` (254 total, 98 exportadas)

| Arquivo | Nome | Linhas | Tipo | Export | Async | Params | Deps |
|---|---|---|---|---|---|---|---|
| src/hooks/use-mobile.tsx | useIsMobile | 21-23 | hook | named | nao |  | - |
| src/hooks/use-mobile.tsx | useIsLgDown | 26-28 | hook | named | nao |  | - |
| src/hooks/use-toast.ts | reducer | 71-122 | function | named | nao | state: State, action: Action | - |
| src/hooks/useAcademyNotes.ts | useAcademyNotes | 81-189 | hook | named | nao |  | supabase.from |
| src/hooks/useAcademyProgress.ts | useAcademyProgress | 32-87 | hook | named | nao |  | - |
| src/hooks/useAdBonusTiers.ts | invalidateBonusTiers | 39-41 | function | named | nao |  | - |
| src/hooks/useAdBonusTiers.ts | useAdBonusTiers | 43-59 | hook | named | nao |  | - |
| src/hooks/useAdMetrics.ts | useAdMetrics | 26-125 | hook | named | nao | consultantId: string \| undefined \| null, periodDays: numbe | supabase.from |
| src/hooks/useAdminAudit.ts | useAdminAudit | 14-28 | hook | named | nao | limit = 100 | supabase.from |
| src/hooks/useAdminAudit.ts | logAdminAction | 31-48 | function | named | sim | action: string, targetType?: string, targetId?: string, meta | - |
| src/hooks/useAdminAuth.ts | useAdminAuth | 37-135 | hook | named | nao |  | supabase.from\|realtime |
| src/hooks/useAgendamentosHub.ts | useAgendamentosHub | 22-202 | hook | named | nao | consultantId: string | supabase.from |
| src/hooks/useAnalytics.ts | friendlyClickLabel | 58-60 | function | named | nao | target: string | - |
| src/hooks/useAnalytics.ts | useAnalytics | 62-631 | hook | named | nao | consultantId: string \| null, periodDays: number = 30, teamI | supabase.from |
| src/hooks/useAudioRecorder.ts | useAudioRecorder | 8-79 | hook | named | nao | onSendAudio?: (base64: string) => Promise<void> | timer |
| src/hooks/useAutomationToggles.ts | useAutomationToggles | 15-114 | hook | named | nao |  | supabase.from |
| src/hooks/useBotFunnel.ts | useBotFunnel | 16-46 | hook | named | nao | days = 7 | supabase.from |
| src/hooks/useCaptureAttach.ts | useCaptureAttach | 77-209 | hook | named | nao |  | supabase.from\|edge_function\|upload_media |
| src/hooks/useCaptureCombo.ts | useCaptureCombo | 47-102 | hook | named | nao |  | timer |
| src/hooks/useCaptureGameState.ts | tierFor | 22-24 | function | named | nao | filled: number | - |
| src/hooks/useCaptureGameState.ts | useCaptureGameState | 39-108 | hook | named | nao | { filledCount, totalFields, sentStepsCount }: Options | timer |
| src/hooks/useCaptureScoreboard.ts | useCaptureScoreboard | 9-76 | hook | named | nao | consultantId: string \| null | supabase.from |
| src/hooks/useCaptureSession.ts | resolveEffectiveIdconsultor | 136-169 | function | named | nao | customer: CaptureCustomer \| null \| undefined | - |
| src/hooks/useCaptureSession.ts | useCaptureSession | 171-455 | hook | named | nao | customerId: string \| null | supabase.from\|realtime |
| src/hooks/useCaptureSuggestions.ts | useCaptureSuggestions | 14-51 | hook | named | nao | customerId: string \| null | supabase.from\|realtime |
| src/hooks/useChats.ts | useChats | 172-510 | hook | named | nao | instanceName: string \| null, isWhapi: boolean = false | supabase.from\|web_storage\|timer\|realtime |
| src/hooks/useConsultant.ts | useConsultant | 5-20 | hook | named | nao | license: string | supabase.from |
| src/hooks/useConsultantForm.ts | useConsultantForm | 34-182 | hook | named | nao | userId: string \| null, form: ConsultantForm, setForm: (fn:  | supabase.from\|upload_media |
| src/hooks/useConsultantPhone.ts | useConsultantPhone | 14-82 | hook | named | nao | consultantId: string \| undefined \| null | supabase.from |
| src/hooks/useConsultantPhone.ts | formatBrPhone | 84-89 | function | named | nao | digits: string \| null | - |
| src/hooks/useConsultantPresence.ts | useConsultantPresence | 26-126 | hook | named | nao | consultantId: string \| null | supabase.from\|timer\|realtime |
| src/hooks/useCrmTracking.ts | useCrmPageView | 20-29 | hook | named | nao |  | supabase.from |
| src/hooks/useCrmTracking.ts | trackCrmClick | 31-39 | function | named | nao | eventTarget: string | supabase.from |
| src/hooks/useCtwaPreflight.ts | useCtwaPreflight | 38-165 | hook | named | nao | consultantId: string \| null | supabase.from\|edge_function |
| src/hooks/useCustomerAttendance.ts | useCustomerAttendance | 12-231 | hook | named | nao | customerId: string \| null \| undefined, consultantId: strin | supabase.from\|edge_function\|realtime |
| src/hooks/useCustomerDeals.ts | useCustomerDeals | 5-55 | hook | named | nao | consultantId: string, customers: Customer[] | supabase.from |
| src/hooks/useCustomerTags.ts | phoneToRemoteJid | 28-35 | function | named | nao | phone: string \| null \| undefined | - |
| src/hooks/useCustomerTags.ts | useCustomerTags | 37-121 | hook | named | nao | remoteJid: string \| null, consultantId: string \| null | supabase.from |
| src/hooks/useCustomerTags.ts | loadCustomerTagsBatch | 124-147 | function | named | sim | consultantId: string, remoteJids: string[] | supabase.from |
| src/hooks/useDiagramData.ts | resolveSourceHandleForTransition | 201-240 | function | named | nao | step: Step, transition: Transition | - |
| src/hooks/useDiagramData.ts | transitionHasResolvedDestination | 315-326 | function | named | nao | t: Transition, stepIdToActiveMap: Map<string, boolean> | - |
| src/hooks/useDiagramData.ts | useDiagramData | 332-786 | hook | named | nao | args: UseDiagramDataArgs | - |
| src/hooks/useDiagramExport.ts | useDiagramExport | 140-260 | hook | named | nao | {   consultantSlug,   variant,   reactFlowInstance, }: UseDi | timer |
| src/hooks/useDiagramLayout.ts | useDiagramLayout | 95-424 | hook | named | nao | {   flowId,   steps,   terminalsUsed,   onAfterAutoLayout, } | supabase.from\|timer |
| src/hooks/useDiagramMetrics.ts | useDiagramMetrics | 63-194 | hook | named | nao | {   enabled,   consultantId,   variant, }: UseDiagramMetrics | supabase.from |
| src/hooks/useDiagramSearch.ts | useDiagramSearch | 112-253 | hook | named | nao | {   nodes,   reactFlowInstance,   onQueryChange, }: UseDiagr | - |
| src/hooks/useFacebookConnection.ts | useFacebookConnection | 25-44 | hook | named | nao | consultantId: string \| null | supabase.from |
| src/hooks/useFileAttach.ts | useFileAttach | 22-83 | hook | named | nao | context?: FileAttachContext | upload_media |
| src/hooks/useFlowSteps.ts | useFlowSteps | 22-110 | hook | named | nao | consultantId: string \| null \| undefined | supabase.from |
| src/hooks/useInstancePhone.ts | useInstancePhone | 8-30 | hook | named | nao | consultantId: string \| undefined | supabase.from |
| src/hooks/useKanbanDeals.ts | useKanbanDeals | 11-197 | hook | named | nao | consultantId: string, options?: { includeTests?: boolean } | supabase.from |
| src/hooks/useKanbanStages.ts | useKanbanStages | 34-154 | hook | named | nao | consultantId: string | supabase.from |
| src/hooks/useLastIgreenSync.ts | useLastIgreenSync | 8-26 | hook | named | nao | consultantId?: string \| null | supabase.from |
| src/hooks/useLayoutLock.ts | useLayoutLock | 30-43 | hook | named | nao |  | web_storage |
| src/hooks/useLeadsByConsultant.ts | useLeadsByConsultant | 22-95 | hook | named | nao | consultantIds: string[], consultantNames: Record<string, str | supabase.from |
| src/hooks/useLeadsByStage.ts | useLeadsByStage | 25-57 | hook | named | nao | consultantId: string \| undefined \| null, periodDays: numbe | supabase.from |
| src/hooks/useManagedConsultants.ts | useManagedConsultants | 10-43 | hook | named | nao | userId: string \| undefined \| null | supabase.from |
| src/hooks/useMessages.ts | useMessages | 329-838 | hook | named | nao | instanceName: string \| null, remoteJid: string \| null, pre | supabase.from\|timer\|realtime |
| src/hooks/useMyClientsSettings.ts | useMyClientsSettings | 17-71 | hook | named | nao | consultantId: string \| null \| undefined, fallback?: Partia | supabase.from |
| src/hooks/useNetworkGpMes.ts | useNetworkAggregates | 22-54 | hook | named | nao | consultantId: string \| null \| undefined | supabase.from |
| src/hooks/useNetworkGpMes.ts | useNetworkGpMes | 60-63 | hook | named | nao | consultantId: string \| null \| undefined | - |
| src/hooks/useNetworkIgreenIds.ts | useNetworkIgreenIds | 10-48 | hook | named | nao | consultantId: string \| null \| undefined | supabase.from |
| src/hooks/useNetworkLicenciados.ts | useNetworkLicenciados | 16-48 | hook | named | nao | consultantId: string \| null \| undefined | supabase.from |
| src/hooks/useNotifications.ts | useNotifications | 28-126 | hook | named | nao | consultantId: string \| null | supabase.from\|web_storage\|realtime |
| src/hooks/useOcrReviewQueue.ts | useOcrReviewQueue | 21-64 | hook | named | nao | consultantId: string \| null | supabase.from\|realtime |
| src/hooks/useResetLayoutSizes.ts | useResetLayoutSizes | 6-18 | hook | named | nao |  | web_storage |
| src/hooks/useSalesFunnel.ts | useSalesFunnel | 41-89 | hook | named | nao | consultantId: string | supabase.from\|realtime |
| src/hooks/useSalesFunnel.ts | leadHeat | 92-97 | function | named | nao | score: number \| null \| undefined | - |
| src/hooks/useTeamConsultantIds.ts | useTeamConsultantIds | 8-22 | hook | named | nao | leaderId: string \| null \| undefined | - |
| src/hooks/useTeamRegistrations.ts | useTeamRegistrations | 78-238 | hook | named | nao | leaderConsultantId: string \| null \| undefined, allCustomer | supabase.from |
| src/hooks/useTemplates.ts | applyTemplate | 10-33 | function | named | nao | template: MessageTemplate, customer: { name: string; electri | - |
| src/hooks/useTemplates.ts | useTemplates | 35-201 | hook | named | nao | consultantId: string | supabase.from |
| src/hooks/useTrackEvent.ts | trackClickEvent | 19-33 | function | named | nao | consultantId: string, eventTarget: string, pageType: string | supabase.from |
| src/hooks/useTrackEvent.ts | getTrackingMeta | 35-40 | function | named | nao |  | - |
| src/hooks/useTrackView.ts | useTrackView | 6-16 | hook | named | nao | consultantId: string \| undefined, pageType: string | supabase.from |
| src/hooks/useUserRole.ts | useUserRole | 4-58 | hook | named | nao | userId: string \| null | - |
| src/hooks/useViewportPersistence.ts | useViewportPersistence | 91-168 | hook | named | nao | {   consultantId,   variant,   reactFlowInstance, }: UseView | web_storage\|timer |
| src/hooks/useViewportWidth.ts | useViewportWidth | 58-90 | hook | named | nao |  | - |
| src/hooks/useVoiceTemplates.ts | normalizeName | 34-42 | function | named | nao | input: string | - |
| src/hooks/useVoiceTemplates.ts | useVoiceTemplates | 44-209 | hook | named | nao | consultantId: string \| undefined | supabase.from\|edge_function\|fetch |

_… e mais 18 exportadas neste domínio (ver inventário JSON da sessão)._

## Domínio: `components-captacao` (238 total, 56 exportadas)

| Arquivo | Nome | Linhas | Tipo | Export | Async | Params | Deps |
|---|---|---|---|---|---|---|---|
| src/components/captacao/AlreadyContactedList.tsx | AlreadyContactedList | 25-103 | component | named | nao | { leads }: Props | - |
| src/components/captacao/BusinessResearchDialog.tsx | BusinessResearchDialog | 58-565 | component | named | nao | { open, onOpenChange, onImported }: Props | timer |
| src/components/captacao/CaptacaoPanel.tsx | CaptacaoPanel | 36-629 | component | named | nao | { consultantId, onOpenChat, instanceName = null, isWhapi = f | supabase.from\|web_storage\|realtime |
| src/components/captacao/CaptureAttachActions.tsx | CaptureAttachActions | 21-67 | component | named | nao | {   onAttach,   tone = "light",   compact = false,   showBol | - |
| src/components/captacao/CaptureBoletoPreference.tsx | CaptureBoletoPreference | 29-123 | component | named | nao | { value, saving, onChange }: Props | - |
| src/components/captacao/CaptureBoletoPreference.tsx | resolveBoletoPreference | 126-132 | function | named | nao | c: {   contaunica_answered?: boolean \| null;   contaunica?: | - |
| src/components/captacao/CaptureComboIndicator.tsx | CaptureComboIndicator | 3-12 | component | named | nao | { combo }: { combo: number } | - |
| src/components/captacao/CaptureConversationFeed.tsx | CaptureConversationFeed | 90-393 | component | named | nao | { customerId, limit = 50, gameOn = false }: Props | supabase.from\|timer\|realtime |
| src/components/captacao/CaptureDataConfirmCard.tsx | CaptureDataConfirmCard | 44-217 | component | named | nao | { kind, customer, onConfirmed }: Props | supabase.from\|edge_function |
| src/components/captacao/CapturedLeadsPanel.tsx | CapturedLeadsPanel | 66-605 | component | named | nao | { consultantId, instanceName = null }: Props | edge_function\|timer |
| src/components/captacao/CaptureDocumentTiles.tsx | CaptureDocumentTiles | 45-320 | component | named | nao | {   customerId,   customer,   onUploaded,   onOcrDone,   com | supabase.from\|edge_function\|upload_media |
| src/components/captacao/CaptureHud.tsx | CaptureHud | 19-52 | component | named | nao | { tier, combo, xp, filled, total, progress, missionLabel, ca | - |
| src/components/captacao/CaptureLeadCard.tsx | CaptureLeadCard | 29-546 | component | named | nao | {   customerId,   embedded = false,   footer,   fichaMode: f | timer |
| src/components/captacao/CaptureLeadList.tsx | periodLabelOf | 79-84 | function | named | nao | key: CapturePeriodKey | - |
| src/components/captacao/CaptureLeadList.tsx | CaptureLeadList | 165-1057 | component | named | nao | {   consultantId,   selectedId,   onSelect,   whatsappConnec | supabase.from\|web_storage\|timer\|realtime |
| src/components/captacao/CaptureLevelBadge.tsx | CaptureLevelBadge | 3-14 | component | named | nao | { tier, animate }: { tier: LevelTier; animate?: boolean } | - |
| src/components/captacao/CaptureMissionHint.tsx | CaptureMissionHint | 3-10 | component | named | nao | { label }: { label: string } | - |
| src/components/captacao/CaptureMissionsPanel.tsx | CaptureMissionsPanel | 28-63 | component | named | nao | { consultantId, streak, bumpVersion = 0 }: Props | - |
| src/components/captacao/CaptureMissionsPanel.tsx | bumpMission | 65-69 | function | named | nao | consultantId: string, kind: "leads" \| "aiAccepts" | - |
| src/components/captacao/CaptureProgressBar.tsx | CaptureProgressBar | 14-49 | component | named | nao | { progress, filled, total, tier }: Props | - |
| src/components/captacao/CaptureScoreboard.tsx | CaptureScoreboard | 5-25 | component | named | nao | { today, week, streak }: Props | - |
| src/components/captacao/CaptureSheet.tsx | CaptureSheet | 52-63 | component | named | nao | props: Props | - |
| src/components/captacao/CaptureStepPreview.tsx | CaptureStepPreview | 54-250 | component | named | nao | { open, onOpenChange, consultantId, customerId, step, varian | supabase.from |
| src/components/captacao/CaptureStepsGrid.tsx | CaptureStepsGrid | 56-317 | component | named | nao | { consultantId, customerId, variant = "A", sentSteps, onSent | supabase.from\|edge_function |
| src/components/captacao/CaptureStepsList.tsx | CaptureStepsList | 46-339 | component | named | nao | { consultantId, customerId, sentSteps, onSent, defaultVarian | supabase.from\|timer |
| src/components/captacao/CloseAttendanceBatchDialog.tsx | CloseAttendanceBatchDialog | 218-819 | component | named | nao | {   open,   onOpenChange,   consultantId,   leads,   delaySe | supabase.from\|edge_function\|timer |
| src/components/captacao/CloseCaptureButton.tsx | CloseCaptureButton | 18-96 | component | named | nao | { customerId, consultantId, onClosed }: Props | supabase.from |
| src/components/captacao/CloseCaptureDialog.tsx | CloseCaptureDialog | 52-589 | component | named | nao | {   open,   onOpenChange,   customerId,   consultantId,   on | supabase.from\|edge_function |
| src/components/captacao/ClubStatusTracker.tsx | ClubStatusTracker | 28-130 | component | named | nao | { customerId, defaultCollapsed = false }: Props | supabase.from\|realtime |
| src/components/captacao/ClubSubmitButton.tsx | ClubSubmitButton | 26-160 | component | named | nao | {   customerId,   missing,   isComplete,   allowLive = false | edge_function |
| src/components/captacao/FinalizeButton.tsx | FinalizeButton | 30-161 | component | named | nao | {   consultantId,   customerId,   missing,   isComplete,   a | edge_function |
| src/components/captacao/game/AchievementsRail.tsx | AchievementsRail | 6-70 | component | named | nao | { progress }: { progress: GameProgress } | - |
| src/components/captacao/game/ComboTimer.tsx | ComboTimer | 25-97 | component | named | nao | { level, secondsLeft, progressPct, bonusXp, compact }: Props | - |
| src/components/captacao/game/ExecHudBar.tsx | ExecHudBar | 9-85 | component | named | nao | { progress }: { progress: GameProgress } | - |
| src/components/captacao/game/GameModeToggle.tsx | GameModeToggle | 11-48 | component | named | nao | { enabled, onToggle, sound, onToggleSound }: Props | - |
| src/components/captacao/game/GameShell.tsx | GameShell | 5-20 | component | named | nao | { children }: Props | - |
| src/components/captacao/game/LevelUpOverlay.tsx | LevelUpOverlay | 6-66 | component | named | nao | { level, rankLabel, onClose }: Props | timer |
| src/components/captacao/game/PlayerHud.tsx | PlayerHud | 4-51 | component | named | nao | { progress }: { progress: GameProgress } | - |
| src/components/captacao/game/QuestsBar.tsx | QuestsBar | 6-66 | component | named | nao | { progress }: { progress: GameProgress } | - |
| src/components/captacao/game/useGameMode.ts | useGameMode | 6-30 | hook | named | nao | consultantId: string \| null | web_storage |
| src/components/captacao/game/useGameProgress.ts | useGameProgress | 57-140 | hook | named | nao | consultantId: string \| null | supabase.from |
| src/components/captacao/game/XpFloater.tsx | XpFloaterProvider | 26-70 | component | named | nao | { children }: { children: ReactNode } | timer |
| src/components/captacao/game/XpFloater.tsx | useXpFloater | 72-79 | hook | named | nao |  | - |
| src/components/captacao/game/XpToast.tsx | XpToast | 5-18 | component | named | nao | { amount, onDone }: Props | timer |
| src/components/captacao/OcrReviewBanner.tsx | OcrReviewBanner | 24-61 | component | named | nao | { consultantId }: Props | - |
| src/components/captacao/OcrReviewCard.tsx | OcrReviewCard | 54-315 | component | named | nao | { customer, kind, onDecided }: Props | supabase.from\|edge_function\|timer |
| src/components/captacao/OpenAttendanceBatchDialog.tsx | OpenAttendanceBatchDialog | 150-774 | component | named | nao | {   open,   onOpenChange,   consultantId,   instanceName,    | upload_media |
| src/components/captacao/PortalStatusTracker.tsx | PortalStatusTracker | 136-532 | component | named | nao | { customerId, consultantId, onRetry, defaultCollapsed = fals | supabase.from\|edge_function\|realtime |
| src/components/captacao/ProgressRing.tsx | ProgressRing | 20-65 | component | named | nao | { progress, filled, total, size = 56, stroke = 5 }: Progress | - |
| src/components/captacao/runAttendanceBatch.ts | hasValidBatchPhone | 59-63 | function | named | nao | phone: string \| null \| undefined | - |
| src/components/captacao/runAttendanceBatch.ts | runAttendanceBatch | 127-317 | function | named | sim | opts: RunAttendanceBatchOptions | - |
| src/components/captacao/runFastStartAttendance.ts | runFastStartAttendance | 15-61 | function | named | sim | {   customerId,   consultantId,   alreadyStarted,   navigate | edge_function |
| src/components/captacao/SendSequenceDialog.tsx | SendSequenceDialog | 33-214 | component | named | nao | {   open, onOpenChange, consultantId, customerId, customerNa | realtime |
| src/components/captacao/ValidationWarnings.tsx | ValidationWarnings | 18-74 | component | named | nao | { validation, onApplySuggestion }: Props | - |
| src/components/captacao/WhatsAppStatusPill.tsx | WhatsAppStatusPill | 12-30 | component | named | nao | { connected }: Props | - |
| src/components/captacao/XpFloater.tsx | XpFloater | 5-24 | component | named | nao | { events }: Props | - |

## Domínio: `lib` (210 total, 131 exportadas)

| Arquivo | Nome | Linhas | Tipo | Export | Async | Params | Deps |
|---|---|---|---|---|---|---|---|
| src/lib/adGlossary.ts | evaluateAdHealth | 54-97 | function | named | nao | p: {   spend_cents: number;   leads: number;   impressions:  | - |
| src/lib/adPolicyRules.ts | checkCopy | 30-48 | function | named | nao | text: string | - |
| src/lib/adPolicyRules.ts | summarize | 50-55 | function | named | nao | hits: PolicyHit[] | - |
| src/lib/adQualityScore.ts | scoreVideo | 20-39 | function | named | nao | input: VideoInput | - |
| src/lib/adQualityScore.ts | scoreCopy | 42-70 | function | named | nao | input: CopyInput | - |
| src/lib/adQualityScore.ts | scoreImage | 73-125 | function | named | sim | input: ImageInput | - |
| src/lib/adQualityScore.ts | aggregate | 134-148 | function | named | nao | copy: QualityResult["copy"], image: QualityResult["image"] | - |
| src/lib/agendamentosHub.ts | dispatchAgendamentosNav | 101-103 | function | named | nao | detail: AgendamentosNavDetail | - |
| src/lib/agendamentosHub.ts | buildAgendamentosTimeline | 105-191 | function | named | nao | input: {   manual: ScheduledMessageRow[];   posVenda: Upcomi | - |
| src/lib/agendamentosTextosCatalog.ts | countCatalogByFonte | 425-431 | function | named | nao |  | - |
| src/lib/aiDecisionOutput.ts | aiOutputText | 25-46 | function | named | nao | output: AiDecisionOutput | - |
| src/lib/aiDecisionOutput.ts | aiOutputPreview | 51-54 | function | named | nao | output: AiDecisionOutput, max = 200 | - |
| src/lib/attendanceShortcut.ts | notifyAttendanceOutcome | 67-106 | function | named | nao | result: AttendanceOutcome, opts: {     kind: "start" \| "end | - |
| src/lib/audioProcessing.ts | getAudioContext | 9-18 | function | named | nao |  | - |
| src/lib/audioProcessing.ts | decodeAudioBlob | 20-37 | function | named | sim | blob: Blob | - |
| src/lib/audioProcessing.ts | encodeMp3 | 49-80 | function | named | sim | buffer: AudioBuffer, kbps = 192 | timer |
| src/lib/audioProcessing.ts | concatBuffers | 83-100 | function | named | nao | buffers: AudioBuffer[] | - |
| src/lib/audioProcessing.ts | concatWithCrossfade | 103-132 | function | named | nao | buffers: AudioBuffer[], fadeSamples = 100 | - |
| src/lib/audioProcessing.ts | downloadBlob | 134-143 | function | named | nao | blob: Blob, filename: string | timer\|upload_media |
| src/lib/birthdayMessages.ts | firstNameFrom | 60-63 | function | named | nao | fullName: string \| null \| undefined | - |
| src/lib/birthdayMessages.ts | fillBirthdayMessage | 65-68 | function | named | nao | template: string, customerName: string \| null \| undefined | - |
| src/lib/birthdayMessages.ts | pickRandomBirthdayMessage | 70-73 | function | named | nao |  | - |
| src/lib/birthdayMessages.ts | isValidWhatsAppPhone | 75-79 | function | named | nao | phone: string \| null \| undefined | - |
| src/lib/birthdayMessages.ts | retentionPhoneKey | 82-88 | function | named | nao | phone: string \| null \| undefined | - |
| src/lib/birthdayMessages.ts | wasRetentionWhatsAppOpenedToday | 103-115 | function | named | nao | consultantId: string \| null \| undefined, phone: string \|  | web_storage |
| src/lib/birthdayMessages.ts | markRetentionWhatsAppOpenedToday | 117-129 | function | named | nao | consultantId: string \| null \| undefined, phone: string \|  | web_storage |
| src/lib/birthdayMessages.ts | openBirthdayWhatsApp | 131-136 | function | named | nao | phone: string, message: string | - |
| src/lib/birthdayMessages.ts | getPreferredBirthdayTemplate | 141-152 | function | named | nao | consultantId?: string \| null | web_storage |
| src/lib/birthdayMessages.ts | setPreferredBirthdayTemplate | 154-161 | function | named | nao | consultantId: string, template: string | web_storage |
| src/lib/captacao/clubValidation.ts | formatClubDob | 125-132 | function | named | nao | raw: string \| null \| undefined | - |
| src/lib/captacao/clubValidation.ts | validateForClub | 134-227 | function | named | nao | c: ClubCustomer \| null \| undefined | - |
| src/lib/captacao/conversationMediaUrl.ts | parseConversationEmbeddedMediaUrl | 5-13 | function | named | nao | messageText: string \| null \| undefined | - |
| src/lib/captacao/conversationMediaUrl.ts | preferDurableMediaUrl | 16-25 | function | named | nao | opts: {   httpUrl?: string \| null;   dataOrOther?: string \ | - |
| src/lib/captacao/discount-rates.ts | discountRates | 15-21 | function | named | nao | variant?: string \| null | - |
| src/lib/captacao/distribuidoras.ts | normalizeDistribuidora | 145-187 | function | named | nao | raw?: string \| null, uf?: string \| null, cidade?: string \ | - |
| src/lib/captacao/distribuidoras.ts | suggestDistribuidoras | 189-192 | function | named | nao | uf?: string \| null | - |
| src/lib/captacao/distribuidoras.ts | isValidDistribuidora | 194-224 | function | named | nao | name?: string \| null, uf?: string \| null, cidade?: string  | - |
| src/lib/captacao/distribuidoras.ts | isHoldingName | 226-229 | function | named | nao | name?: string \| null | - |
| src/lib/captacao/portalPhone.ts | digitsOnlyPhone | 13-15 | function | named | nao | raw: string \| null \| undefined | - |
| src/lib/captacao/portalPhone.ts | toNationalPhoneDigits | 17-25 | function | named | nao | raw: string \| null \| undefined | - |
| src/lib/captacao/portalPhone.ts | toWhatsappCanonical | 27-31 | function | named | nao | raw: string \| null \| undefined | - |
| src/lib/captacao/portalPhone.ts | formatBrLandline | 33-38 | function | named | nao | raw: string \| null \| undefined | - |
| src/lib/captacao/portalPhone.ts | isValidBrNationalPhone | 40-45 | function | named | nao | raw: string \| null \| undefined | - |
| src/lib/captacao/portalPhone.ts | resolvePortalWhatsapp | 47-63 | function | named | nao | c: {   portal2_celular_alt?: string \| null;   phone_landlin | - |
| src/lib/captacao/portalValidation.ts | validateForPortal | 165-336 | function | named | nao | c: PortalCustomer \| null \| undefined | upload_media |
| src/lib/captacao/portalValidation.ts | estimateConsumoFromValor | 340-344 | function | named | nao | valor: number \| null \| undefined | - |
| src/lib/captacao/postBillConfirm.ts | dispatchPostBillConfirm | 85-169 | function | named | sim | args: PostBillConfirmArgs | supabase.from\|edge_function\|timer |
| src/lib/captacao/storageDisplayUrl.ts | parseSupabaseStorageUrl | 4-20 | function | named | nao | url: string | - |
| src/lib/captacao/storageDisplayUrl.ts | resolveStorageDisplayUrl | 27-43 | function | named | sim | url: string \| null \| undefined, expiresIn = 3600 | supabase.from |
| src/lib/captacao/viaCep.ts | lookupViaCep | 11-25 | function | named | sim | cepRaw: string | fetch |
| src/lib/captureGame.ts | fireMiniConfetti | 5-14 | function | named | nao |  | - |
| src/lib/captureGame.ts | fireBigConfetti | 16-23 | function | named | nao |  | - |
| src/lib/captureGame.ts | fireRandomCelebration | 132-139 | function | named | nao |  | web_storage |
| src/lib/captureGame.ts | pickRandomPhrase | 169-171 | function | named | nao |  | - |
| src/lib/captureSfx.ts | isSfxEnabled | 16-18 | function | named | nao |  | web_storage |
| src/lib/captureSfx.ts | setSfxEnabled | 19-21 | function | named | nao | v: boolean | web_storage |
| src/lib/captureSfx.ts | sfxPop | 38-38 | function | named | nao |  | - |
| src/lib/captureSfx.ts | sfxCombo | 39-43 | function | named | nao | level: number | timer |
| src/lib/captureSfx.ts | sfxLevelUp | 44-46 | function | named | nao |  | timer |
| src/lib/captureSfx.ts | sfxVictory | 47-49 | function | named | nao |  | timer |
| src/lib/clubCadastroUrl.ts | buildClubCadastroUrl | 2-5 | function | named | nao | igreenId: string \| number \| null \| undefined | - |
| src/lib/conexaoVideos.ts | conexaoVideoUrl | 8-10 | function | named | nao | videoId: string | - |
| src/lib/conexaoVideos.ts | conexaoPosterUrl | 13-15 | function | named | nao | videoId: string | - |
| src/lib/customerOrigin.ts | isIgreenWalletOrigin | 2-4 | function | named | nao | origin: string \| null \| undefined | - |
| src/lib/dddToUf.ts | ufFromPhone | 41-50 | function | named | nao | phone?: string \| null | - |
| src/lib/fbclid.ts | captureLeadSource | 15-42 | function | named | nao |  | web_storage |
| src/lib/fbclid.ts | getLeadSource | 44-53 | function | named | nao |  | web_storage |
| src/lib/flow-selectors/openingStep.ts | selectActiveFlow | 46-69 | function | named | nao | flows: readonly T[] \| null \| undefined, variant: string \| | - |
| src/lib/flow-selectors/openingStep.ts | detectOpeningStep | 80-93 | function | named | nao | steps: readonly T[] \| null \| undefined | - |
| src/lib/flow-simulator/engine.ts | simulateStep | 56-106 | function | named | nao | input: SimulationInput | - |
| src/lib/flowSimulator.ts | detectValor | 13-33 | function | named | nao | text: string | - |
| src/lib/flowSimulator.ts | detectTelefone | 35-37 | function | named | nao | text: string | - |
| src/lib/flowSimulator.ts | detectCPF | 38-40 | function | named | nao | text: string | - |
| src/lib/flowSimulator.ts | detectNome | 41-43 | function | named | nao | text: string | - |
| src/lib/flowSimulator.ts | detectRegexIntentsFE | 45-52 | function | named | nao | text: string | - |
| src/lib/flowSimulator.ts | simulateMatch | 60-84 | function | named | nao | message: string, rules: SimRule[] | - |
| src/lib/flowSimulator.ts | detectRuleConflicts | 87-114 | function | named | nao | rules: SimRule[] | - |
| src/lib/flowSpreadsheetExport.ts | rowsToCsv | 13-19 | function | named | nao | rows: SpreadsheetRow[], columns: { key: string; label: strin | - |
| src/lib/flowSpreadsheetExport.ts | downloadCsv | 21-31 | function | named | nao | filename: string, csv: string | upload_media |
| src/lib/flowStepResolver.ts | resolveStep | 82-122 | function | named | nao | conversationStep: string \| null \| undefined, customStepMap | - |

_… e mais 51 exportadas neste domínio (ver inventário JSON da sessão)._

## Domínio: `pages` (181 total, 29 exportadas)

| Arquivo | Nome | Linhas | Tipo | Export | Async | Params | Deps |
|---|---|---|---|---|---|---|---|
| src/pages/AdminAgendamentosCentral.tsx | AdminAgendamentosCentral | 121-443 | component | default | nao |  | edge_function\|timer |
| src/pages/AdminConversao.tsx | AdminConversao | 8-19 | component | default | nao |  | - |
| src/pages/AdminFaq.tsx | AdminFaq | 50-682 | component | default | nao | { embedded = false }: { embedded?: boolean } = {} | supabase.from\|edge_function\|upload_media |
| src/pages/AdminFluxoB.tsx | AdminFluxoB | 17-115 | component | default | nao |  | supabase.from |
| src/pages/AdminKnowledge.tsx | AdminKnowledge | 13-163 | component | default | nao | { embedded = false }: { embedded?: boolean } = {} | supabase.from |
| src/pages/AdminMetaAds.tsx | AdminMetaAds | 43-361 | component | default | nao |  | edge_function\|fetch |
| src/pages/AdminMotorCadencia.tsx | AdminMotorCadencia | 68-492 | component | default | nao |  | supabase.from\|edge_function\|timer |
| src/pages/AdminPortalMonitor.tsx | AdminPortalMonitor | 46-186 | component | default | nao |  | supabase.from |
| src/pages/AdminProtocolsPage.tsx | AdminProtocolsPage | 23-259 | component | default | nao |  | supabase.from\|upload_media |
| src/pages/AdminReaquecimento.tsx | AdminReaquecimento | 22-200 | component | default | nao |  | supabase.from |
| src/pages/AdminReconIgreen.tsx | AdminReconIgreen | 24-175 | component | default | nao |  | supabase.from\|edge_function\|timer |
| src/pages/AdminTourEditor.tsx | AdminTourEditor | 15-214 | component | default | nao |  | supabase.from\|edge_function |
| src/pages/AdminVoz.tsx | AdminVoz | 8-19 | component | default | nao |  | - |
| src/pages/AjudaPage.tsx | AjudaPage | 15-121 | component | default | nao |  | supabase.from\|timer |
| src/pages/AssistentePage.tsx | AssistentePage | 63-404 | component | default | nao |  | edge_function\|web_storage\|fetch |
| src/pages/ConexaoCanonicalRedirects.tsx | RedirectConexaoGreen | 4-7 | component | named | nao |  | - |
| src/pages/ConexaoCanonicalRedirects.tsx | RedirectConexaoExpansao | 10-13 | component | named | nao |  | - |
| src/pages/ConsultantMessages.tsx | ConsultantMessages | 35-219 | component | default | nao |  | supabase.from |
| src/pages/FluxoBuilder.tsx | FluxoBuilder | 47-676 | component | default | nao |  | supabase.from\|web_storage |
| src/pages/InstallPage.tsx | InstallPage | 22-150 | component | default | nao |  | - |
| src/pages/PartnerRedirectPage.tsx | PartnerRedirectPage | 34-97 | component | default | nao |  | fetch\|timer |
| src/pages/PoliticaPrivacidade.tsx | PoliticaPrivacidade | 4-40 | component | default | nao |  | - |
| src/pages/ProposalPublicPage.tsx | ProposalPublicPage | 62-483 | component | default | nao |  | upload_media |
| src/pages/ResetApp.tsx | ResetApp | 8-51 | component | default | nao |  | - |
| src/pages/SaudeBot.tsx | SaudeBot | 12-40 | component | default | nao |  | - |
| src/pages/SaudeProducao.tsx | SaudeProducao | 35-266 | component | default | nao |  | supabase.from |
| src/pages/SuperAdminRemoteSupport.tsx | SuperAdminRemoteSupport | 84-380 | component | default | nao |  | supabase.from\|realtime |
| src/pages/Tutorial.tsx | Tutorial | 732-867 | component | default | nao |  | - |
| src/pages/WhatsAppClientsPage.tsx | WhatsAppClientsPage | 8-14 | component | default | nao |  | - |

## Domínio: `services` (145 total, 96 exportadas)

| Arquivo | Nome | Linhas | Tipo | Export | Async | Params | Deps |
|---|---|---|---|---|---|---|---|
| src/services/adImageLibrary.ts | listAdImageLibrary | 23-33 | function | named | sim | consultantId: string | supabase.from |
| src/services/adImageLibrary.ts | addToAdImageLibrary | 35-65 | function | named | sim | item: {   consultant_id: string;   url: string;   storage_pa | supabase.from |
| src/services/adImageLibrary.ts | removeFromAdImageLibrary | 67-75 | function | named | sim | id: string, storagePath?: string \| null | supabase.from |
| src/services/adTemplates.ts | listAdTemplates | 62-68 | function | named | sim | opts?: { onlyPublished?: boolean } | supabase.from |
| src/services/adTemplates.ts | upsertAdTemplate | 70-100 | function | named | sim | t: Partial<AdTemplate> & { id?: string } | supabase.from |
| src/services/adTemplates.ts | deleteAdTemplate | 102-105 | function | named | sim | id: string | supabase.from |
| src/services/adTemplates.ts | uploadAdTemplateImage | 107-116 | function | named | sim | file: File, templateId: string | supabase.from\|upload_media |
| src/services/adTemplates.ts | getTemplateAggregatedMetrics | 159-232 | function | named | sim | templateId: string, opts?: { consultantId?: string; days?: n | supabase.from |
| src/services/adTemplates.ts | duplicateAdTemplate | 234-253 | function | named | sim | t: AdTemplate | - |
| src/services/capturedLeads.ts | listCapturedLeads | 63-103 | function | named | sim | filter: ListLeadsFilter | supabase.from |
| src/services/capturedLeads.ts | countLeadsByChannel | 106-115 | function | named | sim | consultantId: string | - |
| src/services/capturedLeads.ts | filterAlreadyDispatchedPhones | 121-139 | function | named | sim | consultantId: string, phones: string[] | - |
| src/services/capturedLeads.ts | listAlreadyDispatchedPhones | 145-177 | function | named | sim | consultantId: string | supabase.from |
| src/services/capturedLeads.ts | dispatchLeadsToCampaign | 192-232 | function | named | sim | input: {   leadIds: string[];   campaignName?: string;   mes | edge_function |
| src/services/capturedLeads.ts | searchBusinesses | 309-358 | function | named | sim | input: {   city: string;   uf?: string;   neighbourhood?: st | edge_function |
| src/services/capturedLeads.ts | importBusinesses | 363-421 | function | named | sim | items: ResearchItem[] | edge_function |
| src/services/capturedLeads.ts | discardLead | 424-430 | function | named | sim | leadId: string | supabase.from |
| src/services/capturedLeads.ts | searchCityNames | 451-466 | function | named | sim | query: string, uf?: string | supabase.from |
| src/services/capturedLeads.ts | listMunicipiosByUf | 469-487 | function | named | sim | uf: string | supabase.from |
| src/services/capturedLeads.ts | startUfPhoneSweep | 548-570 | function | named | sim | input: {   uf: string;   category?: string; } | edge_function |
| src/services/capturedLeads.ts | getUfPhoneSweepStatus | 573-581 | function | named | sim | sweepId?: string | edge_function |
| src/services/capturedLeads.ts | cancelUfPhoneSweep | 584-590 | function | named | sim | sweepId: string | edge_function |
| src/services/capturedLeads.ts | harvestCityPhones | 596-630 | function | named | sim | input: {   city: string;   uf: string;   category?: string;  | - |
| src/services/capturedLeads.ts | countPendingWhatsappLeads | 639-672 | function | named | sim | consultantId: string | supabase.from |
| src/services/contactSuppression.ts | suppressContact | 33-141 | function | named | sim | input: SuppressContactInput | supabase.from |
| src/services/contactSuppression.ts | revokeContactSuppression | 146-177 | function | named | sim | input: {   consultantId: string;   customerId: string; } | supabase.from |
| src/services/contactSuppression.ts | isContactSuppressed | 180-188 | function | named | sim | customerId: string \| null \| undefined | supabase.from |
| src/services/evolutionApi.ts | createInstance | 175-204 | function | named | sim | instanceName: string | edge_function |
| src/services/evolutionApi.ts | setInstanceWebhook | 207-223 | function | named | sim | instanceName: string | edge_function |
| src/services/evolutionApi.ts | connectInstance | 225-238 | function | named | sim | instanceName: string | - |
| src/services/evolutionApi.ts | getConnectionState | 240-257 | function | named | sim | instanceName: string | - |
| src/services/evolutionApi.ts | deleteInstance | 268-278 | function | named | sim | instanceName: string | - |
| src/services/evolutionApi.ts | logoutInstance | 280-290 | function | named | sim | instanceName: string | - |
| src/services/evolutionApi.ts | fetchInstances | 305-307 | function | named | sim |  | - |
| src/services/evolutionApi.ts | findChats | 336-338 | function | named | sim | instanceName: string | - |
| src/services/evolutionApi.ts | getBase64FromMediaMessage | 368-377 | function | named | sim | instanceName: string, messageId: string, remoteJid: string,  | - |
| src/services/evolutionApi.ts | findMessages | 379-385 | function | named | sim | instanceName: string, remoteJid: string, limit = 50 | - |
| src/services/evolutionApi.ts | findMessagesForChat | 393-432 | function | named | sim | instanceName: string, remoteJid: string, altJid?: string \|  | supabase.from |
| src/services/evolutionApi.ts | findContacts | 436-438 | function | named | sim | instanceName: string | - |
| src/services/evolutionApi.ts | sendTextMessage | 442-449 | function | named | sim | instanceName: string, phone: string, text: string, gracefulT | - |
| src/services/evolutionApi.ts | sendMedia | 451-459 | function | named | sim | instanceName: string, phone: string, mediaUrl: string, capti | - |
| src/services/evolutionApi.ts | sendSticker | 461-471 | function | named | sim | instanceName: string, phone: string, stickerUrl: string, gra | - |
| src/services/evolutionApi.ts | sendAudio | 473-477 | function | named | sim | instanceName: string, phone: string, audioUrl: string, grace | - |
| src/services/evolutionApi.ts | sendDocument | 479-483 | function | named | sim | instanceName: string, phone: string, docUrl: string, fileNam | - |
| src/services/evolutionApi.ts | fetchAllGroups | 504-509 | function | named | sim | instanceName: string | - |
| src/services/evolutionApi.ts | getGroupParticipants | 512-519 | function | named | sim | instanceName: string, groupJid: string | - |
| src/services/evolutionApi.ts | markAsRead | 523-527 | function | named | sim | instanceName: string, remoteJid: string, messageId: string,  | - |
| src/services/evolutionApi.ts | getProfilePicture | 529-536 | function | named | sim | instanceName: string, remoteJid: string | - |
| src/services/expressCampaign.ts | inferDistribuidora | 51-63 | function | named | nao | cities: string[] | - |
| src/services/expressCampaign.ts | fetchExpressSuggestions | 136-164 | function | named | sim | opts: {   consultantId: string;   cities: string[]; } | - |
| src/services/facebookAds.ts | startFacebookOAuth | 51-61 | function | named | sim | opts: OAuthStartOptions \| "connect" \| "switch" \| "rereque | edge_function |
| src/services/facebookAds.ts | listFacebookAssets | 72-76 | function | named | sim | opts: { scope?: "user" \| "platform" } = {} | edge_function |
| src/services/facebookAds.ts | selectFacebookAssets | 77-87 | function | named | sim | payload: {   ad_account_id?: string \| null;   page_id?: str | edge_function |
| src/services/facebookAds.ts | validateAccount | 90-94 | function | named | sim |  | edge_function |
| src/services/facebookAds.ts | autoFixWhatsApp | 112-116 | function | named | sim |  | edge_function |
| src/services/facebookAds.ts | syncAudiences | 125-133 | function | named | sim |  | edge_function |
| src/services/facebookAds.ts | searchCities | 137-141 | function | named | sim | q: string | edge_function |
| src/services/facebookAds.ts | searchCitiesBulk | 146-154 | function | named | sim | items: { name: string; uf: string }[] | edge_function |
| src/services/facebookAds.ts | generateCopy | 159-163 | function | named | sim | cities: string[] | edge_function |
| src/services/facebookAds.ts | checkInitialMessage | 167-173 | function | named | sim | message: string, distribuidora?: string \| null, excludeCamp | edge_function |
| src/services/facebookAds.ts | varyInitialMessage | 174-181 | function | named | sim | message: string, distribuidora?: string \| null, excludeCamp | edge_function |
| src/services/facebookAds.ts | preflightCampaign | 202-215 | function | named | sim | input: {   cities?: { key: string; name: string }[];   custo | edge_function |
| src/services/facebookAds.ts | createCampaign | 276-291 | function | named | sim | body: CreateCampaignBody | edge_function |
| src/services/facebookAds.ts | uploadAdVideo | 296-309 | function | named | sim | consultantId: string, file: File | supabase.from\|upload_media |
| src/services/facebookAds.ts | uploadAdPhotos | 387-411 | function | named | sim | consultantId: string, files: File[], opts?: { formats?: ("sq | upload_media |
| src/services/facebookAds.ts | getWalletBalance | 421-435 | function | named | sim | consultantId: string | supabase.from |
| src/services/facebookAds.ts | getWalletTransactions | 448-457 | function | named | sim | consultantId: string, limit = 30 | supabase.from |
| src/services/facebookAds.ts | getWalletFeed | 477-538 | function | named | sim | consultantId: string, limit = 80 | supabase.from |
| src/services/facebookAds.ts | createTopupSession | 540-545 | function | named | sim | amountCents: number | edge_function |
| src/services/facebookAds.ts | getConsultantAdSettings | 556-571 | function | named | sim | consultantId: string | supabase.from |
| src/services/facebookAds.ts | saveConsultantAdSettings | 572-577 | function | named | sim | consultantId: string, patch: Partial<ConsultantAdSettings> | supabase.from |
| src/services/facebookAds.ts | getPlatformFacebookStatus | 591-610 | function | named | sim |  | supabase.from |
| src/services/messageSender.ts | logPlatformOutbound | 83-106 | function | named | sim | params: {   customerId?: string \| null;   text: string;   m | supabase.from |
| src/services/messageSender.ts | sendWhatsAppMessage | 139-328 | function | named | sim | payload: SendPayload | supabase.from |
| src/services/messageSender.ts | normalizeBrazilPhone | 337-346 | function | named | nao | raw: string \| null \| undefined | - |
| src/services/messageSender.ts | resolveRecipient | 354-362 | function | named | nao | targetJid: string | - |
| src/services/minioUpload.ts | uploadMedia | 40-96 | function | named | sim | file: File, onProgress?: (pct: number) => void, context?: Up | edge_function\|fetch\|upload_media |
| src/services/minioUpload.ts | getAcceptString | 101-114 | function | named | nao | mediaType: string | - |
| src/services/minioUpload.ts | formatFileSize | 116-120 | function | named | nao | bytes: number | - |
| src/services/referralPartners.ts | normalizeBrPhone | 47-61 | function | named | nao | raw: string \| null \| undefined | - |

_… e mais 16 exportadas neste domínio (ver inventário JSON da sessão)._

## Domínio: `components-superadmin` (110 total, 28 exportadas)

| Arquivo | Nome | Linhas | Tipo | Export | Async | Params | Deps |
|---|---|---|---|---|---|---|---|
| src/components/superadmin/ABResultsPanel.tsx | ABResultsPanel | 48-237 | component | named | nao |  | supabase.from |
| src/components/superadmin/AdImagePreview.tsx | AdImagePreview | 9-22 | component | named | nao | { url, format, size = 90 }: { url: string; format: AdPhotoFo | - |
| src/components/superadmin/AdManagersTab.tsx | AdManagersTab | 22-169 | component | named | nao |  | supabase.from |
| src/components/superadmin/AdTemplatesPanel.tsx | AdTemplatesPanel | 65-518 | component | named | nao |  | supabase.from\|edge_function\|upload_media |
| src/components/superadmin/AIAuditPanel.tsx | AIAuditPanel | 42-211 | component | named | nao |  | supabase.from |
| src/components/superadmin/AIControlPanel.tsx | AIControlPanel | 37-259 | component | named | nao |  | supabase.from |
| src/components/superadmin/AIKnowledgePanel.tsx | AIKnowledgePanel | 71-404 | component | named | nao |  | supabase.from\|edge_function\|upload_media |
| src/components/superadmin/AuditLogPanel.tsx | AuditLogPanel | 17-88 | component | named | nao |  | - |
| src/components/superadmin/BotFunnelPanel.tsx | BotFunnelPanel | 35-103 | component | named | nao |  | - |
| src/components/superadmin/BotGlobalKillSwitch.tsx | BotGlobalKillSwitch | 10-97 | component | named | nao |  | supabase.from |
| src/components/superadmin/CaptacaoTab/ActionDrillDialog.tsx | ActionDrillDialog | 16-133 | component | named | nao | { open, onOpenChange, action }: Props | supabase.from |
| src/components/superadmin/CaptacaoTab/index.tsx | CaptacaoTab | 4-14 | component | named | nao |  | - |
| src/components/superadmin/CaptacaoTab/IntelDiagnostic.tsx | IntelDiagnostic | 29-190 | component | named | nao |  | supabase.from\|edge_function |
| src/components/superadmin/CaptacaoTab/KpisRow.tsx | KpisRow | 11-58 | component | named | nao | { kpis }: Props | - |
| src/components/superadmin/CrmAnalyticsTab.tsx | CrmAnalyticsTab | 37-338 | component | named | nao |  | supabase.from |
| src/components/superadmin/DevToolsBlockToggle.tsx | DevToolsBlockToggle | 14-112 | component | named | nao |  | supabase.from |
| src/components/superadmin/FaqComparativoPanel.tsx | FaqComparativoPanel | 60-143 | component | named | nao |  | supabase.from |
| src/components/superadmin/FlowTemplateApprovalPanel.tsx | FlowTemplateApprovalPanel | 26-194 | component | default | nao |  | supabase.from |
| src/components/superadmin/InfraHealthPanel.tsx | InfraHealthPanel | 43-198 | component | named | nao |  | supabase.from\|edge_function |
| src/components/superadmin/LearnedPatternsPanel.tsx | LearnedPatternsPanel | 20-174 | component | named | nao |  | supabase.from\|edge_function |
| src/components/superadmin/PhoneResetButton.tsx | PhoneResetButton | 25-97 | component | named | nao | { userId }: PhoneResetButtonProps | - |
| src/components/superadmin/ResolverStrictModeToggle.tsx | ResolverStrictModeToggle | 11-83 | component | named | nao |  | supabase.from |
| src/components/superadmin/RolloutPanel.tsx | RolloutPanel | 103-440 | component | named | nao |  | supabase.from\|edge_function |
| src/components/superadmin/SolarModulePanel.tsx | SolarModulePanel | 20-140 | component | named | nao |  | supabase.from |
| src/components/superadmin/StuckLeadsWidget.tsx | StuckLeadsWidget | 84-349 | component | named | nao |  | supabase.from\|edge_function\|timer |
| src/components/superadmin/SystemHealthPanel.tsx | SystemHealthPanel | 41-224 | component | named | nao |  | supabase.from\|timer |
| src/components/superadmin/WhatsAppInstanceHealthCard.tsx | WhatsAppInstanceHealthCard | 19-162 | component | named | nao |  | supabase.from\|edge_function |
| src/components/superadmin/WorkerPhaseTimeline.tsx | WorkerPhaseTimeline | 51-322 | component | named | nao |  | supabase.from\|timer\|realtime |

## Domínio: `components-other` (94 total, 14 exportadas)

| Arquivo | Nome | Linhas | Tipo | Export | Async | Params | Deps |
|---|---|---|---|---|---|---|---|
| src/components/auth/ProtectedRoute.tsx | ProtectedRoute | 19-59 | component | default | nao | { children }: Props | realtime |
| src/components/CookieBanner.tsx | CookieBanner | 9-52 | component | named | nao |  | web_storage |
| src/components/layout/AppSidebar.tsx | AppSidebar | 114-288 | component | named | nao | {   activeTab,   onTabChange,   onNavigate,   consultantName | - |
| src/components/layout/AppSidebar.tsx | useSidebarToggle | 291-294 | hook | named | nao |  | - |
| src/components/layout/AppTopbar.tsx | AppTopbar | 17-100 | component | named | nao | {   title,   subtitle,   onToggleSidebar,   sidebarCollapsed | - |
| src/components/layout/DragResizer.tsx | DragResizer | 36-158 | component | named | nao | {   storageKey,   cssVar,   defaultPx,   minPx = 160,   maxP | web_storage |
| src/components/layout/LayoutLockToggle.tsx | LayoutLockToggle | 10-76 | component | named | nao | { className }: { className?: string } | web_storage\|timer |
| src/components/layout/ResizableShell.tsx | ResizableShell | 33-114 | component | named | nao | { storageKey, panels, direction = "horizontal", className }: | web_storage |
| src/components/leads/CustomerTagsEditor.tsx | CustomerTagsEditor | 27-264 | component | named | nao | {   consultantId,   phone,   compact = false,   preloadedTag | supabase.from |
| src/components/leads/LeadOriginEditorDialog.tsx | LeadOriginEditorDialog | 72-445 | component | named | nao | {   open,   onOpenChange,   customerId,   consultantId,   ca | supabase.from\|edge_function |
| src/components/leads/NeverContactDialogs.tsx | NeverContactConfirmDialog | 43-126 | component | named | nao | {   open,   onOpenChange,   consultantId,   customerId,   ph | - |
| src/components/leads/NeverContactDialogs.tsx | RevokeNeverContactDialog | 136-186 | component | named | nao | {   open,   onOpenChange,   consultantId,   customerId,   on | - |
| src/components/support/SupportChatButton.tsx | SupportChatButton | 23-126 | component | named | nao | { className }: SupportChatButtonProps = {} | edge_function |
| src/components/UpdateAvailableToast.tsx | UpdateAvailableToast | 13-36 | component | named | nao |  | - |

## Domínio: `components-ui` (53 total, 12 exportadas)

| Arquivo | Nome | Linhas | Tipo | Export | Async | Params | Deps |
|---|---|---|---|---|---|---|---|
| src/components/ui/combobox.tsx | Combobox | 65-185 | component | named | nao | props: Props | supabase.from |
| src/components/ui/confirm-dialog.tsx | ConfirmDialogProvider | 38-96 | component | named | nao | { children }: { children: ReactNode } | - |
| src/components/ui/confirm-dialog.tsx | useConfirm | 98-102 | hook | named | nao |  | - |
| src/components/ui/help-hint.tsx | HelpHint | 29-104 | component | named | nao | {   title,   summary,   details,   example,   size = 12,   c | - |
| src/components/ui/LazyVideo.tsx | LazyVideo | 28-106 | component | named | nao | {   src,   type = "video/mp4",   className = "w-full aspect- | - |
| src/components/ui/PaginatedList.tsx | PaginatedList | 17-52 | component | named | nao | { items, pageSize, renderItem, renderEmpty, flow = false, ga | - |
| src/components/ui/prompt-dialog.tsx | PromptDialogProvider | 34-116 | component | named | nao | { children }: { children: ReactNode } | - |
| src/components/ui/prompt-dialog.tsx | usePrompt | 118-122 | hook | named | nao |  | - |
| src/components/ui/sensitive.tsx | Sensitive | 45-58 | component | named | nao | {   kind = "data",   as = "span",   className,   children,   | - |
| src/components/ui/ThemeToggle.tsx | ThemeToggle | 4-25 | component | named | nao |  | - |
| src/components/ui/toaster.tsx | Toaster | 4-24 | component | named | nao |  | - |
| src/components/ui/VirtualList.tsx | VirtualList | 20-81 | component | named | nao | {   items,   estimateSize,   overscan = 8,   className,   st | - |

## Domínio: `tests` (43 total, 0 exportadas)

_Sem exports catalogados (apenas internas)._

## Domínio: `other` (19 total, 4 exportadas)

| Arquivo | Nome | Linhas | Tipo | Export | Async | Params | Deps |
|---|---|---|---|---|---|---|---|
| src/data/copyCatalog.ts | renderPlaceholders | 292-300 | function | named | nao | text: string, ctx: { distribuidora?: string \| null; cidade? | - |
| src/data/copyCatalog.ts | isClaimHeavyCopy | 314-324 | function | named | nao | text: string | - |
| src/data/copyCatalog.ts | sampleCopyPack | 330-349 | function | named | nao | ctx: { distribuidora?: string \| null; cidade?: string \| nu | - |
| src/data/distribuidoraPresets.ts | findDistribuidoraForCity | 467-471 | function | named | nao | cityName: string | - |

## Domínio: `components-wallet` (6 total, 2 exportadas)

| Arquivo | Nome | Linhas | Tipo | Export | Async | Params | Deps |
|---|---|---|---|---|---|---|---|
| src/components/wallet/ManualTopupRequestDialog.tsx | ManualTopupRequestDialog | 15-87 | component | named | nao |  | supabase.from |
| src/components/wallet/RechargeRequiredDialog.tsx | RechargeRequiredDialog | 16-274 | component | named | nao |  | supabase.from\|edge_function |

## Domínio: `contexts` (6 total, 4 exportadas)

| Arquivo | Nome | Linhas | Tipo | Export | Async | Params | Deps |
|---|---|---|---|---|---|---|---|
| src/contexts/PrivacyModeContext.tsx | usePrivacyMode | 13-13 | hook | named | nao |  | - |
| src/contexts/PrivacyModeContext.tsx | PrivacyModeProvider | 15-26 | component | named | nao | { children }: { children: React.ReactNode } | - |
| src/contexts/ThemeContext.tsx | useTheme | 17-17 | hook | named | nao |  | - |
| src/contexts/ThemeContext.tsx | ThemeProvider | 24-60 | component | named | nao | { children }: { children: React.ReactNode } | web_storage |

## Domínio: `components-voz` (4 total, 1 exportadas)

| Arquivo | Nome | Linhas | Tipo | Export | Async | Params | Deps |
|---|---|---|---|---|---|---|---|
| src/components/voz/ScheduleCallButton.tsx | ScheduleCallButton | 39-211 | component | named | nao | {   phone,   consultantId,   contactName,   customerId,   tr | supabase.from\|edge_function |

## Domínio: `integrations` (1 total, 0 exportadas)

_Sem exports catalogados (apenas internas)._

## Arquivos com mais funções (top 40)

| Arquivo | Funções |
|---|---:|
| src/components/admin/AudioStudio.tsx | 56 |
| src/components/captacao/CaptureLeadList.tsx | 31 |
| src/services/facebookAds.ts | 29 |
| src/services/evolutionApi.ts | 28 |
| src/components/admin/NetworkPanel.tsx | 23 |
| src/components/whatsapp/AgendamentosHub.tsx | 22 |
| src/components/admin/RetentionCard.tsx | 19 |
| src/components/captacao/CloseAttendanceBatchDialog.tsx | 19 |
| src/features/produtos/acompanhamento/greenData.ts | 19 |
| src/pages/SuperAdminRemoteSupport.tsx | 19 |
| src/services/capturedLeads.ts | 19 |
| src/components/captacao/CaptureConversationFeed.tsx | 18 |
| src/components/admin/AIAgentTab/MediaColumn.tsx | 17 |
| src/components/admin/flow-builder/FlowDiagram.tsx | 17 |
| src/components/admin/fluxo/StepMediaPanel.tsx | 17 |
| src/features/produtos/esteira/api.ts | 17 |
| src/features/remote-support/screenShare.ts | 17 |
| src/components/admin/flow-builder/GuidedStepDialog.tsx | 16 |
| src/components/admin/parceiros/PartnerQrCode.tsx | 16 |
| src/features/produtos/acompanhamento/greenCommission.ts | 16 |
| src/features/remote-support/actionHandler.ts | 16 |
| src/hooks/useChats.ts | 16 |
| src/components/admin/fluxo/FaqSection.tsx | 15 |
| src/components/admin/super/PlatformFacebookCard.tsx | 15 |
| src/features/produtos/orcamento/OrcamentoBuilderSheet.tsx | 15 |
| src/pages/AdminFaq.tsx | 15 |
| src/components/whatsapp/PosVendaSetupWizard.tsx | 14 |
| src/components/whatsapp/customerUtils.ts | 14 |
| src/features/produtos/esteira/hooks.ts | 14 |
| src/lib/metaAdsExperiment.ts | 14 |
| src/test/caller-auth-assertOwnership.property.test.ts | 14 |
| src/components/admin/ads/CampaignExperimentCard.tsx | 13 |
| src/components/admin/financeiro/BoletosAdminTable.tsx | 13 |
| src/components/admin/flow-builder/FlowSimulator.tsx | 13 |
| src/components/admin/flow-builder/flowTypes.ts | 13 |
| src/components/admin/voz/VoiceSmsPanel.tsx | 13 |
| src/components/captacao/CaptureSheet.tsx | 13 |
| src/components/whatsapp/AgendamentosTextosDialog.tsx | 13 |
| src/components/whatsapp/PosVendaKanban.tsx | 13 |
| src/lib/birthdayMessages.ts | 13 |

## Limitações desta etapa

- Arrow functions anônimas em JSX props (handlers inline) **não** foram todas nomeadas.
- Chamadores (call graph) ainda não resolvidos — etapa de mapa arquitetural / por domínio.
- Autenticação/autorização/idempotência: preenchimento na auditoria frontend e segurança.
- Testes relacionados: cruzamento na etapa 18.
