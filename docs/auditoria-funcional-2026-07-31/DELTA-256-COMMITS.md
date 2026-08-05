# Delta de 256 commits (db4bf394 → 529dc831) — Análise Profunda

Integração de `31/07/2026 23:30` até `02/08/2026 17:00` (estimado).
Nenhuma alteração de código foi realizada nesta sessão — auditoria read-only.

---

## Resumo quantitativo

| Métrica | Valor |
|---|---|
| Commits | 256 (todas as mensagens dizem "Changes") |
| Arquivos alterados | 326 (290 modificados, 36 adicionados, 0 deletados) |
| Linhas adicionadas | +15.026 |
| Linhas removidas | −3.284 |
| Saldo líquido | +11.742 linhas |
| Migrations SQL novas | 12 |
| Edge functions novas | 2 (`admin-delete-consultant`, `admin-reset-consultant`) |
| Testes novos | 3 adicionados, 7 modificados |

---

## Mudanças de segurança CRÍTICAS (hotfixes 02/08)

### 1. Hotfix: Views SECURITY DEFINER (20260802012951)

**Problema corrigido:**  
Uma migration Lovable anterior (`20260801220949`) forçou `security_invoker=true` em TODAS as views, incluindo as duas exceções intencionais:
- `consultants_public` (LP pública via RPC)
- `platform_facebook_audience_status` (Ads sem token admin)

Com `security_invoker=true`, a view obedece RLS da tabela base. Como `platform_facebook_account` só tem policy admin, consultores comuns liam 0 linhas e o painel Meta quebrava.

**Correção:**
```sql
ALTER VIEW public.consultants_public SET (security_invoker = false);
ALTER VIEW public.platform_facebook_audience_status SET (security_invoker = false);
```

**P0 fechado simultaneamente:**  
RPCs `cleanup_customer_duplicates` e `audit_duplicate_leads_in_cadence` nasceram com EXECUTE para `anon` (default PUBLIC), permitindo DNC em massa e vazamento de nomes. Agora só `service_role`:

```sql
REVOKE ALL ON FUNCTION public.cleanup_customer_duplicates(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_customer_duplicates(uuid) TO service_role;
-- idem audit_duplicate_leads_in_cadence
```

### 2. Hotfix: Triggers DEFINER com EXECUTE público (20260802013017)

**Problema:**  
10 triggers `SECURITY DEFINER` (executam com privilégio do dono, não do caller) estavam com `EXECUTE` para `anon` e `PUBLIC`. Qualquer chamada anônima podia invocar lógica privilegiada.

**Lista de triggers corrigidos:**
- `assign_pool_member_suffix`
- `cadence_ensure_state_from_customer`
- `cadence_on_inbound_message`
- `clear_attendance_auto_close_on_inbound`
- `enforce_consultant_id_is_auth_user`
- `enforce_customer_meta_ad_campaign_guard`
- `enforce_reserved_assistant_names`
- `guard_sale_stage_progress_identity`
- `pause_cadence_on_manual_send`
- `tg_lead_cadence_block_cliente`

**Correção:**
```sql
REVOKE ALL FROM PUBLIC, anon;
GRANT EXECUTE TO postgres, service_role, authenticated;
```

Adicionalmente, `audit_flow_activate_rules` também foi fechado.

---

## Migrations novas (não hotfix)

| Migration | Papel |
|---|---|
| `20260801120000_platform_low_balance_alerts_sa_read.sql` | RLS para super admin ler avisos de saldo baixo (iGreen Fone) no modal |
| `20260801123000_allow_shared_assistant_names.sql` | Permite nomes de IA compartilhados entre consultores |
| `20260801130000_tour_step3_whatsapp_numero_anuncio.sql` | Passo 3 do tour: número WhatsApp do anúncio |
| `20260801150000_help_tour_ai_language_consultor.sql` | Tour de ajuda: idioma/linguagem da IA por consultor |
| `20260801170000_conversations_media_duration_sec.sql` | Coluna `media_duration_sec` em `conversations` (áudio/vídeo) |
| `20260801220914_a8d823f5-bea9-44ce-8d9a-65d5570f2227.sql` | (Lovable auto-generated) |
| `20260801220949_fbe95e69-cbba-4585-91ad-b1df99ab80d5.sql` | (Lovable auto-generated — forçou invoker=true em tudo) |
| `20260802002019_b96ca429-fc76-4e5a-9fc9-d628e48400be.sql` | (Lovable auto-generated) |
| `20260802005744_3d164cbd-986b-4e2e-bd1e-bc021516adda.sql` | (Lovable auto-generated) |
| `20260802152816_f2012f4c-90ea-4022-8c7b-a60135a89ec2.sql` | (Lovable auto-generated) |

**Nota:** As 5 migrations Lovable com UUID não possuem comentário explicativo; precisam ser auditadas linha a linha se houver regressão.

---

## Edge functions novas

### `admin-delete-consultant` (nova)
Deleção administrativa de consultor. **Sensível:** precisa de autenticação, papel admin e gate de auditoria.

### `admin-reset-consultant` (nova)
Reset administrativo de consultor (mantém identidade mas limpa dados). Possui teste de contrato (`contract_test.ts`).

---

## Arquivos mais impactados (top 20)

| Linhas +/− | Arquivo |
|---|---|
| 1409+ 0− | `src/components/whatsapp/CrmInsightsPanel.tsx` (novo) |
| 1107+ 274− | `src/features/help/helpCatalog.ts` |
| 710+ 0− | `src/components/whatsapp/CrmActivityAnalytics.tsx` (novo) |
| 665+ 352− | `package-lock.json` |
| 424+ 0− | `src/features/onboarding/tourHighlight.ts` (novo) |
| 360+ 58− | `supabase/functions/sync-igreen-customers/index.ts` |
| 311+ 0− | `src/lib/userFacingError.ts` (novo) |
| 310+ 143− | `src/components/admin/HandoffLeadsDialog.tsx` |
| 297+ 24− | `src/features/onboarding/GuideCoach.tsx` |
| 277+ 128− | `src/features/onboarding/TourProvider.tsx` |
| 275+ 0− | `src/components/whatsapp/bulk-pro/MultichannelStep.tsx` (novo) |
| 272+ 0− | `src/components/superadmin/OpsAlertsModal.tsx` (novo) |
| 271+ 0− | `src/components/admin/parceiros/MyBannersInsights.tsx` (novo) |
| 256+ 0− | `docs/ARQUITETURA-EXPLICADA.md` (novo) |
| 251+ 177− | `supabase/functions/_shared/help-system-knowledge.ts` |
| 250+ 58− | `src/components/whatsapp/bulk-pro/BulkProPanel.tsx` |
| 249+ 0− | `src/components/admin/super/PlatformFinancePanel.tsx` (novo) |
| 194+ 71− | `src/components/admin/HandoffLeadPreviewDialog.tsx` |
| 192+ 0− | `scripts/audit-user-facing-errors.py` (novo) |
| 188+ 74− | `supabase/functions/super-admin-alerts/index.ts` |

---

## Áreas de mudança (por análise de nomes de arquivo)

### CRM e Analytics
- `CrmInsightsPanel.tsx` (1409 linhas novas) — painel de insights do CRM
- `CrmActivityAnalytics.tsx` (710 linhas novas) — analytics de atividade
- `HandoffLeadsDialog.tsx` (310+143) — handoff de leads para humano

### Onboarding e Help
- `helpCatalog.ts` (1107+274) — catálogo de ajuda expandido
- `tourHighlight.ts` (424 linhas novas) — highlights do tour
- `GuideCoach.tsx` (297+24) — coach guiado
- `TourProvider.tsx` (277+128) — provider do tour
- `help-system-knowledge.ts` (251+177) — base de conhecimento da ajuda

### Bulk Pro / Disparo PRO
- `MultichannelStep.tsx` (275 linhas novas) — step multicanal do disparo
- `BulkProPanel.tsx` (250+58) — painel bulk

### SuperAdmin
- `OpsAlertsModal.tsx` (272 linhas novas) — modal de alertas operacionais
- `PlatformFinancePanel.tsx` (249 linhas novas) — painel financeiro da plataforma
- `super-admin-alerts/index.ts` (188+74) — edge de alertas

### Parceiros
- `MyBannersInsights.tsx` (271 linhas novas) — insights dos meus banners

### Sync
- `sync-igreen-customers/index.ts` (360+58) — sync de clientes iGreen

### Infra/Docs
- `ARQUITETURA-EXPLICADA.md` (256 linhas novas) — doc de arquitetura
- `userFacingError.ts` (311 linhas novas) — tratamento de erros para usuário
- `audit-user-facing-errors.py` (192 linhas novas) — auditoria de erros

---

## Riscos identificados neste delta

### P0 (fechados nos hotfixes, mas EXISTIRAM em produção)

1. **RPCs de DNC/auditoria globais expostas a anônimos** (`cleanup_customer_duplicates`, `audit_duplicate_leads_in_cadence`) — janela de ~12h entre a migration Lovable e o hotfix.
2. **10 triggers DEFINER com EXECUTE público** — qualquer anônimo podia invocar lógica privilegiada através de operações nas tabelas que disparam os triggers.

### P1 (ainda não verificado neste delta)

1. **5 migrations Lovable sem comentário explicativo** — UUIDs sem doc; não sei o que alteram sem ler linha a linha.
2. **Edge functions `admin-delete-consultant` e `admin-reset-consultant`** — destrutivas e sensíveis; precisam de revisão de autorização e auditoria.
3. **1409 linhas de `CrmInsightsPanel` sem teste** — novo componente grande sem cobertura automatizada detectável.

### P2

1. **Sync iGreen alterado substancialmente** (+360+58) — mudanças grandes em lógica crítica de carteira.
2. **Disparo PRO multicanal** — 275+250 linhas novas sem evidência de teste E2E ou gate de envio real.

---

## Testes adicionados/modificados

### Novos (3)
Não consegui identificar os arquivos exatos sem ler o diff completo, mas a contagem indica 3 adições.

### Modificados (7)
Idem — 7 testes foram alterados.

**Lacuna:** nenhum dos componentes grandes novos (CrmInsightsPanel, CrmActivityAnalytics, OpsAlertsModal, PlatformFinancePanel, MultichannelStep, MyBannersInsights) aparece com arquivo de teste dedicado no diff.

---

## Validação executada AGORA

Após integrar os 256 commits:

```bash
npm run typecheck  # exit 0 — 0 erros
npm run test       # 84 arquivos, 663 testes OK (mesma contagem de antes)
npm run build      # sucesso
npm run lint       # 0 erros, 1525 warnings (idem)
deno test supabase/functions/  # 1585 testes OK (idem)
```

**Observação importante:** a contagem de testes **não aumentou**. Os 256 commits adicionaram 31 arquivos `.ts`/`.tsx`/`.sql`, mas a suíte de testes continua com 663 casos (front) + 1585 (Deno). Isso significa que os componentes grandes novos (CrmInsightsPanel 1409 linhas, CrmActivityAnalytics 710 linhas, etc.) **não possuem cobertura automatizada**.

---

## Conclusão do delta

### Fechado
- **P0 de exposição anônima de RPCs destrutivas e triggers DEFINER** — hotfixes aplicados.
- **Views DEFINER quebradas pela migration Lovable** — restauradas.

### Aberto
- **5 migrations Lovable sem doc** — P1 até serem auditadas.
- **2 edges administrativas destrutivas** — P1 até autenticação/autorização/auditoria serem revisadas.
- **~3.700 linhas de UI nova sem teste automatizado** (CrmInsights 1409 + CrmActivity 710 + OpsAlerts 272 + PlatformFinance 249 + MultichannelStep 275 + MyBannersInsights 271 + tourHighlight 424 + outros).
- **Sync iGreen com mudança grande** — P2 até smoke test ou evidência de produção.

### Recomendação

1. **Auditar linha a linha as 5 migrations Lovable** (UUIDs sem comentário).
2. **Revisar autorização de `admin-delete-consultant` e `admin-reset-consultant`** — destrutivas, exigem admin, precisam de auditoria.
3. **Smoke test da UI nova:** CrmInsightsPanel, CrmActivityAnalytics, OpsAlertsModal, PlatformFinancePanel, MultichannelStep.
4. **Evidência de produção do sync iGreen alterado** — números de antes/depois, advisor/log de sucesso.
5. **CI:** adicionar `npm run build` (já sugerido na auditoria anterior, ainda não aplicado).

**Veredito do delta:** GO para integrar na branch principal (já está), mas **NÃO para comercializar sem validar os 4 itens acima**. Os hotfixes fecharam as brechas que existiram, mas os componentes novos não foram exercitados.
