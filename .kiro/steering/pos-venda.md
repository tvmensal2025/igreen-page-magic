---
inclusion: fileMatch
name: pos-venda
description: Pós-venda WA D30–D210 + retentativa.
fileMatchPattern:
  - "supabase/functions/pos-venda-*/**"
  - "supabase/migrations/**pos_venda*"
  - "src/lib/posVenda*"
  - "src/lib/posVenda/**"
  - "src/components/whatsapp/PosVenda*"
  - "src/components/whatsapp/PendingApprovalDialog.tsx"
  - "supabase/functions/_shared/pos-venda-retentativa*"
---

# Pós-venda (WA) — após aprovação iGreen

Domínio: `customers.customer_origin = igreen_sync` + kanban `stage_scope=pos_venda`.  
**Não** confundir com esteira `sale_stage_*` / `sales` (`src/features/produtos/esteira/`) nem com `crm-auto-progress` (legado unificado).

## Edges
| Função | Papel |
|---|---|
| `pos-venda-auto-progress` | Move `pos_venda_stage` + envia mídia; claim em `customer_auto_message_log` |
| `pos-venda-bucket-cron` | Só `rpc('recompute_pos_venda_stages')` — sem envio |
| `sync-igreen-customers` | Após sync chama `recompute_pos_venda_stages`; protege `pos_venda_recadastro_at` |

UI: `PosVendaKanban`, `PosVendaSetupWizard`, `PosVendaAutoConfigDialog`, `PendingApprovalDialog` · schedule: #[[file:src/lib/posVendaSchedule.ts]]

## Colunas / tabelas
- `customers`: `pos_venda_stage`, `pos_venda_approved_at`, `pos_venda_rejected_at`, `pos_venda_recadastro_at`, `pos_venda_manual`, `pos_venda_pending_stage`, `pos_venda_reason`
- Kanban: keys `pv_espera|pv_aprovado|pv_reprovado|pv_retentativa|pv_d30|…|pv_d210`
- Mídia: `pos_venda_default_media`, `consultant_pos_venda_media`
- Log idempotente: `customer_auto_message_log` (UNIQUE customer+stage_key)
- Helper: `_shared/pos-venda-retentativa.ts` (botão `pv_retentativa_cadastro`)

## Cadeados
1. Toggle `pos_venda_auto_messages` — **não** usa `bot_global_enabled`
2. Quiet hours BRT + `assertCronAuth`
3. Só envia se `pos_venda_manual=true` (consultor validou)
4. Canal via `resolveChannelForCustomerWithFailover` (Whapi primeiro)

## Fluxo
Sync/bucket recalcula estágio; se palpite aprovado/reprovado sem validação → `espera` + `pos_venda_pending_stage`; consultor confirma → `pos_venda_manual=true`; auto-progress manda `pv_aprovado`/`pv_reprovado` e avança D30→D210 a partir de **`pos_venda_approved_at`**.

### Retentativa (qualquer consultor)
1. Validar reprovado → carimba `pos_venda_rejected_at` + msg `pv_reprovado` (sem botão)
2. Após **60 dias** → move para `retentativa` + msg + escolha:
   - **Whapi:** botão `Quero tentar de novo` (`pv_retentativa_cadastro`)
   - **Evolution:** texto numerado `*1.* Quero tentar de novo` (canal sem botão real)
3. Clique / resposta `1` → `activatePosVendaRecadastro` (origem `whatsapp_lead`, Grupo A / cadastro); sync não re-flipa enquanto `pos_venda_recadastro_at` ativo

## NÃO FAÇA
Msg sem validação manual / sem toggle · misturar `sale_stage_*` · apagar edges/toggles · massa nova sem pedido · hardcode UUID de um consultor nos seeds (usar `CROSS JOIN consultants`).
