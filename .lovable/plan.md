# Plano: Esteira de Acompanhamento da Venda (Produtos → Vendas)

Validado via Supabase MCP no projeto `zlzasfhcxcznaprrragl`:
- `public.sales` existe com `id uuid`, `consultant_id uuid NOT NULL` e `status` do enum `sale_status` (que contém `fechado`). O trigger `AFTER INSERT OR UPDATE OF status WHEN NEW.status='fechado'` é seguro.
- `public.has_role(uuid, app_role)`, `public.is_super_admin(uuid)` e `public.set_updated_at()` já existem — vamos reutilizar.
- Enum `public.sale_stage_status` e bucket `sales-attachments` **ainda não existem** (serão criados).
- Pasta `src/features/produtos/acompanhamento/` hoje é de comissão/carreira; a esteira fica isolada em `src/features/produtos/esteira/` para não colidir.
- CRM (`kanban_stages`, `crm_deals`) e o `acompanhamento/` de comissão **não são tocados**.

## Onde encaixa na UI

- **`SalesPipelineBoard`** (painel de Vendas em Produtos): botão **"Acompanhamento"** no card quando `status='fechado'` → abre `SaleStagePanel` em Sheet/Dialog.
- **Admin de Produtos**: nova entrada para `StageTemplateAdmin`, gated por `has_role(admin)` / `is_super_admin` na UI (RLS reforça no banco).

## Banco (migrations via Supabase MCP)

1. **Enum + tabelas + GRANTs + índices**
   - `CREATE TYPE public.sale_stage_status AS ENUM ('pendente','concluido');`
   - `sale_stage_templates(id, position int, name text CHECK length(btrim(name))>0, is_active bool default true, created_at, updated_at)` + trigger `set_updated_at`.
   - `sale_stage_progress(id, sale_id uuid REFERENCES sales(id) ON DELETE CASCADE, template_position int, name_snapshot text, status sale_stage_status DEFAULT 'pendente', note text, completed_at timestamptz, completed_by uuid REFERENCES auth.users(id), created_at)` + `UNIQUE(sale_id, template_position)` + índice `(sale_id, template_position)`.
   - `sale_stage_attachments(id, sale_stage_id uuid REFERENCES sale_stage_progress(id) ON DELETE CASCADE, storage_path text, file_name text, mime text, size_bytes bigint, uploaded_by uuid REFERENCES auth.users(id), created_at)` + índice `(sale_stage_id)`.
   - **GRANTs explícitos** em cada tabela: `SELECT,INSERT,UPDATE,DELETE … TO authenticated` + `ALL … TO service_role` (sem `anon`).

2. **RPC idempotente + trigger**
   - `public.ensure_sale_stage_progress(p_sale_id uuid)` `SECURITY DEFINER` `SET search_path=public`: early-return se já houver passos da venda; senão copia etapas `is_active=true` ordenadas por `position`, fotografando `template_position` e `name_snapshot` com `status='pendente'`.
   - `tg_ensure_sale_stage_progress()` + trigger `trg_sales_ensure_stage_progress` em `public.sales`: `AFTER INSERT OR UPDATE OF status FOR EACH ROW WHEN (NEW.status='fechado')` chama a RPC.

3. **RLS das 3 tabelas** (todas com `ENABLE ROW LEVEL SECURITY`)
   - Templates: `SELECT` para `authenticated` (`USING true`); `INSERT/UPDATE/DELETE` só `has_role(auth.uid(),'admin')` ou `is_super_admin(auth.uid())`; policy `ALL` para `service_role`.
   - Progress: dono via `sale_id IN (SELECT id FROM sales WHERE consultant_id = auth.uid())` ou admin/superadmin; `service_role` full (necessário para a RPC).
   - Attachments: mesmo isolamento por join encadeado até `sales.consultant_id`.

4. **Bucket `sales-attachments` + policies de storage**
   - Inserir bucket privado (`public=false`, `file_size_limit=10485760`, `allowed_mime_types` = jpeg/png/webp/pdf) com `ON CONFLICT DO NOTHING`.
   - Policies em `storage.objects`: SELECT/ALL exigindo `bucket_id='sales-attachments'` e `(split_part(name,'/',1))::uuid` pertencente a uma venda do consultor logado, ou admin/superadmin.

5. **Seed do template padrão** (só se a tabela estiver vazia)
   - Positions 0..3: "Foto e documentação", "Visita técnica", "Dimensionamento", "Contrato enviado".

6. **Checkpoint** — validar via MCP (`list_tables`/`execute_sql`) + `get_advisors` (security) para garantir RLS em todas as novas tabelas.

## Front (`src/features/produtos/esteira/`)

- `types.ts` — modelos camelCase + rows snake_case; constantes `SALES_ATTACHMENTS_BUCKET`, `MAX_ATTACHMENT_BYTES`, `ALLOWED_ATTACHMENT_MIMES`, `DEFAULT_TEMPLATE_STAGES`.
- `logic.ts` (puro) — `appendStage`, `normalizePositions`, `isValidStageName`, `buildAttachmentPath(saleId, stageId, fileName)`, `validateUpload({sizeBytes,mime})`, `computeProgress`.
- `api.ts` — `@/integrations/supabase/client`, no padrão de `vendas/api.ts`:
  - Template: `fetchTemplate / addStage / renameStage / removeStage / reorderStages / seedDefaultTemplate`.
  - Esteira: `fetchSaleStages / setStageStatus (grava completed_at/by) / setStageNote`.
  - Anexos: `listAttachments / uploadAttachment / removeAttachment` (storage + tabela, remoção best-effort).
- `hooks.ts` — React Query: `useStageTemplate`, `useSaleStages(saleId)`, `useStageAttachments(stageId)` + mutations com invalidação.
- `SaleStagePanel.tsx` — passos em ordem, checkbox concluído/pendente, observação, anexos (upload/lista/remover), barra `done/total` (shadcn/ui).
- `StageTemplateAdmin.tsx` — CRUD + reorder com validação; botão "Inicializar com etapas padrão" quando vazio.
- `index.ts` — re-exports públicos.

## Integração

- `SalesPipelineBoard` (em `produtos/vendas`): novo botão "Acompanhamento" no card de venda `fechado` → abre `SaleStagePanel`.
- Painel admin de Produtos: nova entrada para `StageTemplateAdmin` (visível só para admin/superadmin).

## Testes (opcionais, `*` no spec)

- `fast-check` sobre `logic.ts` cobrindo P1–P3, P9–P11.
- Integração de RLS/instanciação/round-trip (P4–P8, P12–P14).

## Verificação final

- `npx tsc --noEmit`, `npx vite build`, `npx vitest --run`.
- Regenerar `src/integrations/supabase/types.ts` após as migrations.

## Ordem (waves)

1. Migration: enum + 3 tabelas + GRANTs + índices + trigger `set_updated_at`.
2. Migration: RPC + trigger em `sales`.
3. Migration: RLS das 3 tabelas.
4. Migration: bucket + policies de storage.
5. Migration: seed condicional do template.
6. Front: `types → logic → api → hooks → SaleStagePanel / StageTemplateAdmin → index`.
7. Integração no `SalesPipelineBoard` + entrada admin.
8. Verificação (tsc/build/vitest) + regenerar tipos.
