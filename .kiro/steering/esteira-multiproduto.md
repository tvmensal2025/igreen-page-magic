---
inclusion: fileMatch
name: esteira-multiproduto
description: Sales/sale_stage — distinto de pós-venda WA.
fileMatchPattern:
  - "src/features/produtos/esteira/**"
  - "src/features/produtos/vendas/**"
  - "src/features/produtos/orcamento/**"
  - "src/features/produtos/catalogo/**"
  - "src/features/produtos/ProdutosModule.tsx"
  - "src/components/captacao/CloseCapture*"
  - "src/pages/ProposalPublicPage.tsx"
  - "supabase/functions/proposal-*/**"
  - "**/migrations/**sale_stage*"
  - ".kiro/specs/acompanhamento-proposta/**"
---

# Esteira multiproduto — NÃO é pós-venda WA

Módulo **Produtos**: catálogo → orçamento (`proposals`) → venda (`sales`) → etapas (`sale_stage_*`).  
**Diferente** de `#pos-venda` (WhatsApp D30–D210 + retentativa em `customers.pos_venda_*`).

| | Esteira | Pós-venda WA |
|---|---|---|
| Entidade | `sales` / `proposals` / `products` | `customers` (iGreen sync) |
| Etapas | `sale_stage_progress` | `pos_venda_stage` / `pv_*` |
| Canal | UI + anexos Storage | WA auto (`pos-venda-auto-progress`) |
| Código | `src/features/produtos/esteira/` | `PosVenda*` / `#pos-venda` |

## Onde
- UI: `SaleStagePanel`, `StageTemplateAdmin`, `logic.ts`, `api.ts`
- Orçamento público: `proposal-public-get` / `proposal-respond`
- Fechar captação: `CloseCapture*` pode criar `sales`
- Bucket: `sales-attachments` · path `{sale_id}/{stage_id}/…` · max 10 MB · jpeg/png/webp/pdf

## Tabelas / RPC
`products` · `proposals` / `proposal_events` · `sales` · `sale_stage_templates` · `sale_stage_progress` · `sale_stage_attachments`  
RPC `ensure_sale_stage_progress` (materializa etapas; tipicamente ao fechar venda).

Defaults por família em `DEFAULT_TEMPLATE_BY_FAMILY` (placas/energia/telecom/seguros).

## FAÇA
Helpers `esteira/{api,logic,hooks,types}` · anexos no bucket certo · status `pendente`/`concluido`

## NÃO FAÇA
Misturar com `pos_venda_*` · WA automático da esteira · apagar RPC/templates/migrations · MIME fora do allowlist
