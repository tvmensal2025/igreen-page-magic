---
inclusion: fileMatch
fileMatchPattern: "src/components/admin/ads/campaign-wizard/**|src/lib/rodizio/**|supabase/functions/_shared/rodizio-assign.ts|supabase/functions/facebook-update-campaign-rodizio/**|supabase/functions/rodizio-metrics-broadcast/**|supabase/migrations/*rodizio*"
name: rodizio-parceiros-campanha
description: Rodízio de PARCEIROS por campanha Meta (pools + RPC atômica rodizio_assign_lead). NÃO existe rotação automática de criativos — só otimização de praça (cérebro MG) e dashboards.
---

# Rodízio de parceiros por campanha

> **Aviso importante.** No código, "rodízio de anúncios" significa **rodízio de parceiros/consultores por campanha Meta**, não rotação de criativos. Não há A/B automático de criativo; o que existe em `ads/` é análise (`ad_creative_performance`, `ad_recommendations`, `ad-creative-learner`, `ai-cpl-watchdog`) e otimização de praça/waste-guard do cérebro MG (documentado em `#cerebro-mg-e-rodizio`).

Este steering cobre a mecânica do rodízio de parceiros. Regras estratégicas (waste, MG-ROT, avisos horários, quiet 21–09) continuam em `#cerebro-mg-e-rodizio`.

---

## 1. Modelo de dados

- `rodizio_pools` — 1 por campanha (índice único `rodizio_pools_campaign_id_uniq`). Campos: `campaign_id`, `consultant_id` (dono), `enabled`, `partner_required`, `notes`.
- `rodizio_pool_members` — participantes ordenados por `position`. Cada membro é um `referral_partners.id`.
- `rodizio_assignments` — ledger de cada turno consumido (customer × partner × campaign × ts). RLS `rodizio_assignments_owner_select` = dono ou super_admin.
- `facebook_campaigns.id` (UUID) → `customers.source_campaign_id` — a única chave que liga lead → campanha → pool. **Nunca casar por cidade/texto/keyword** (regra `campanha-uuid-nao-texto`).

---

## 2. Fluxo end-to-end

```
Admin abre wizard de campanha (Step 4 StepBudget)
  → RodizioBlock.tsx (toggle "Definir quem recebe os leads")
  → useRodizioLogic.ts (estado + validação)
  → RPC configure_rodizio_pool
     ├─ valida ownership via auth.uid()
     ├─ exige ao menos 1 membro se enabled && partner_required
     ├─ FOR UPDATE em facebook_campaigns
     └─ UPSERT rodizio_pools + rodizio_pool_members (ordem = position)

Campanha ACTIVE no Meta
  → facebook-update-campaign-rodizio (avisos de mudança)
  → rodizio-metrics-broadcast (broadcast horário, respeita quiet 21–09)

Lead novo (Meta/CTWA/Lead Ads)
  → webhook resolve source_campaign_id via _shared/deterministic-campaign-resolver.ts
  → assignRodizioLead(customer_id, campaign_id)  (_shared/rodizio-assign.ts)
     → RPC rodizio_assign_lead (SECURITY DEFINER, search_path=public)
        1. SELECT customer FOR UPDATE
        2. tenant check: campaign.consultant_id == customer.consultant_id ? → tenant_mismatch
        3. campanha ativa? → campaign_inactive
        4. conflito de campanha? → campaign_conflict
        5. já atribuído? → already_assigned (NÃO consome turno)
        6. rodizio_next(pool) → seleciona por position circular
        7. UPDATE customers SET referral_partner_id
        8. INSERT rodizio_assignments (ledger)
  → notifyPartnerNewLead(partner.notification_phone, lead)
```

Outcomes normalizados (em `_shared/rodizio-assign.ts`):
`assigned` · `already_assigned` · `assignment_conflict` · `pool_empty` · `customer_missing` · `campaign_inactive` · `campaign_conflict` · `tenant_mismatch` · `rpc_error`.

---

## 3. Arquivos-chave

| Área | Arquivo |
|---|---|
| Wizard — toggle & membros | `src/components/admin/ads/campaign-wizard/RodizioBlock.tsx` |
| Wizard — form inline | `src/components/admin/ads/campaign-wizard/RodizioInlineForm.tsx` |
| Wizard — hook | `src/components/admin/ads/campaign-wizard/hooks/useRodizioLogic.ts` (+ teste) |
| Leads da campanha | `src/components/admin/ads/CampaignRodizioLeadsDialog.tsx` |
| Broadcast WA | `src/components/whatsapp/RodiziosBroadcastPanel.tsx` |
| Wrapper TS (assign) | `supabase/functions/_shared/rodizio-assign.ts` — `assignRodizioLead`, `bindCustomerCampaign` (CAS) |
| Seletor circular (puro) | `src/lib/rodizio/circular-selector.ts` (espelho de teste do `rodizio_next`) |
| Serviço parceiros | `src/services/referralPartners.ts` |
| Migration principal | `supabase/migrations/20260714130000_harden_rodizio_end_to_end.sql` (RPCs `configure_rodizio_pool`, `rodizio_next`, `rodizio_assign_lead`) |
| Edges auxiliares | `facebook-update-campaign-rodizio`, `rodizio-metrics-broadcast` |
| Testes | `src/lib/rodizio/rodizio-assign.unit.test.ts`, `rodizio-assignment.p4/p5/p6.property.test.ts`, `rodizio-next.integration.test.ts`, `rodizio-pool.example.test.ts` |
| Auditoria histórica | `docs/auditoria-completa/10b-rodizio.md`, `docs/cerebro-e-rodizio-avisos.md` |

---

## 4. Regras invioláveis

- **1 pool por campanha.** Nunca criar segunda linha em `rodizio_pools` para o mesmo `campaign_id`.
- **Atribuição é atômica e idempotente.** Se o customer já tem `referral_partner_id`, a RPC retorna `already_assigned` **sem** consumir turno.
- **Nunca cruzar tenants.** `campaign.consultant_id != customer.consultant_id` = `tenant_mismatch`, bloqueio hard.
- **Ledger obrigatório.** Toda atribuição gera linha em `rodizio_assignments` — não fazer UPDATE direto sem passar pela RPC.
- **Lead Meta com pool ativo bloqueia keyword-match.** Ver `#parceiros-referral` §4.
- **Rodízio não reativa campanha pausada** por waste-guard/cérebro MG — só o consultor via botão Play.
- **Chamada da RPC pela UI** exige ownership no corpo (RPC aceita `authenticated`, não é só service_role).

---

## 5. Riscos abertos

- `notifyPartnerNewLead` não checa DNC do lead (mesmo risco listado em `#parceiros-referral`).
- Pool vazio + `partner_required=false` → lead pode ficar sem dono silenciosamente. Considerar alerta em `automation_skip_log` quando `pool_empty` para uma campanha ativa.
- Confusão de nomenclatura: usuários chamam "rodízio de anúncios" esperando rotação de CRIATIVO. Nunca prometer isso — só rotação de PARCEIRO por campanha e (separadamente) de PRAÇA MG-ROT.

---

## 6. Tarefas comuns

| Tarefa | Onde |
|---|---|
| Adicionar/remover parceiro da pool | RPC `configure_rodizio_pool` via wizard — nunca INSERT direto em `rodizio_pool_members` |
| Investigar "por que este lead foi para o parceiro X" | `rodizio_assignments` (ledger) + `campaign_match_log` |
| Pool não gira | Confirmar `rodizio_pools.enabled=true`, membros com `is_active=true` em `referral_partners`, e campanha ativa |
| Lead ficou sem parceiro apesar de campanha com pool | Ver outcome da RPC nos logs da edge que chamou `assignRodizioLead`; provavelmente `tenant_mismatch` ou `pool_empty` |
| Métricas/avisos horários | edges `facebook-update-campaign-rodizio` + `rodizio-metrics-broadcast` (quiet 21–09, ver `#cerebro-mg-e-rodizio`) |
