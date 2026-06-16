# Implementation Plan: Acompanhamento de Proposta/Venda (Esteira)

## Overview

A implementação segue a ordem: **banco primeiro** (enum, tabelas, índices, RPC idempotente, trigger, RLS, bucket de storage e seed — tudo via MCP `apply_migration`, project-ref `zlzasfhcxcznaprrragl`), depois a camada de front (`types.ts → logic.ts → api.ts → hooks.ts → componentes`) dentro de `src/features/produtos/esteira/`, a integração no `SalesPipelineBoard`/painel de Vendas (sem tocar no CRM), e por fim a verificação (`tsc`, `vite build`, `vitest --run` e regeneração dos tipos do Supabase).

Os testes de propriedade (fast-check) sobre `logic.ts` cobrem as Properties P1–P14 do design e ficam próximos da implementação para detectar erros cedo.

## Tasks

- [ ] 1. Banco — enum, tabelas, índices e constraints (migration via MCP `apply_migration`)
  - Aplicar migration criando o enum `public.sale_stage_status` (`pendente` | `concluido`).
  - Criar `public.sale_stage_templates` (`id`, `position`, `name` com `check length(btrim(name)) > 0`, `is_active`, `created_at`, `updated_at`).
  - Criar `public.sale_stage_progress` (`id`, `sale_id` FK → `sales(id)` ON DELETE CASCADE, `template_position`, `name_snapshot`, `status` default `pendente`, `note`, `completed_at`, `completed_by` FK → `auth.users(id)`, `created_at`) com `unique (sale_id, template_position)` e índice `idx_sale_stage_progress_sale (sale_id, template_position)`.
  - Criar `public.sale_stage_attachments` (`id`, `sale_stage_id` FK → `sale_stage_progress(id)` ON DELETE CASCADE, `storage_path`, `file_name`, `mime`, `size_bytes`, `uploaded_by` FK → `auth.users(id)`, `created_at`) com índice `idx_sale_stage_attachments_stage (sale_stage_id)`.
  - Anexar trigger `set_updated_at` em `sale_stage_templates`.
  - _Requisitos: 7.1, 5.5_

- [ ] 2. Banco — RPC idempotente + trigger de instanciação (migration via MCP `apply_migration`)
  - [ ] 2.1 Criar RPC `public.ensure_sale_stage_progress(p_sale_id uuid)` `SECURITY DEFINER`
    - Early-return se já existir ao menos um passo para a venda (idempotência).
    - Copiar as etapas `is_active = true` do template, ordenadas por `position`, fotografando `template_position` e `name_snapshot`, com `status = 'pendente'`.
    - _Requisitos: 2.1, 2.3, 2.4_
  - [ ] 2.2 Criar função `public.tg_ensure_sale_stage_progress()` e trigger `trg_sales_ensure_stage_progress`
    - `AFTER INSERT OR UPDATE OF status ON public.sales FOR EACH ROW WHEN (NEW.status = 'fechado')`.
    - A função apenas executa `perform public.ensure_sale_stage_progress(NEW.id)`.
    - _Requisitos: 2.1, 2.2_

- [ ] 3. Banco — RLS das 3 tabelas (migration via MCP `apply_migration`)
  - [ ] 3.1 Habilitar RLS e criar policies de `sale_stage_templates`
    - SELECT para `authenticated` (`using (true)`); INSERT/UPDATE/DELETE só `has_role(auth.uid(),'admin')` ou `is_super_admin(auth.uid())`; policy `service_role` full.
    - _Requisitos: 1.7, 3.7, 5.4_
  - [ ] 3.2 Habilitar RLS e criar policies de `sale_stage_progress`
    - SELECT/UPDATE para dono (`sale_id in (select id from sales where consultant_id = auth.uid())`) ou admin/superadmin (`with check` igual); policy `service_role` full para a RPC/instanciação.
    - _Requisitos: 3.6, 5.2, 5.3, 5.4_
  - [ ] 3.3 Habilitar RLS e criar policies de `sale_stage_attachments`
    - SELECT por join encadeado até `sales.consultant_id = auth.uid()` ou admin; ALL (write) restrito ao dono via mesmo join.
    - _Requisitos: 5.2, 5.3, 5.4_

- [ ] 4. Banco — bucket `sales-attachments` + policies de storage (migration via MCP `apply_migration`)
  - Inserir bucket privado `sales-attachments` (`public = false`, `file_size_limit` 10485760, `allowed_mime_types` = jpeg/png/webp/pdf) com `on conflict do nothing`.
  - Criar policy de SELECT em `storage.objects`: `bucket_id = 'sales-attachments'` e `(split_part(name,'/',1))::uuid` pertence a venda do consultor, ou admin/superadmin.
  - Criar policy de escrita (ALL) restrita ao dono da venda pelo mesmo `split_part`.
  - _Requisitos: 4.1, 4.2, 4.6, 5.1, 5.4_

- [ ] 5. Banco — seed do template padrão (migration via MCP `apply_migration`)
  - Inserir as 4 etapas padrão (positions 0..3): "Foto e documentação", "Visita técnica", "Dimensionamento", "Contrato enviado" **apenas se a tabela `sale_stage_templates` estiver vazia**.
  - _Requisitos: 1.6_

- [ ] 6. Checkpoint — validar o banco
  - Conferir via MCP (`list_tables`/`execute_sql`) que tabelas, enum, RPC, trigger, policies e bucket existem; rodar `get_advisors` (security) para checar RLS. Garantir que tudo está aplicado; perguntar ao usuário se surgir dúvida.

- [ ] 7. Front — tipos da feature
  - Criar `src/features/produtos/esteira/types.ts` com modelos camelCase + rows snake_case: `StageTemplateItem`/`StageTemplateRow`, `SaleStage`/`SaleStageRow`, `SaleStageStatus = "pendente" | "concluido"`, `SaleStageAttachment`/`SaleStageAttachmentRow`.
  - Definir constantes: `SALES_ATTACHMENTS_BUCKET = "sales-attachments"`, `MAX_ATTACHMENT_BYTES`, `ALLOWED_ATTACHMENT_MIMES`, `DEFAULT_TEMPLATE_STAGES`.
  - _Requisitos: 4.6, 1.6_

- [ ] 8. Front — lógica pura (`logic.ts`) e testes de propriedade
  - [ ] 8.1 Implementar funções puras em `src/features/produtos/esteira/logic.ts`
    - `appendStage(stages, name)`, `normalizePositions(stages)`, `isValidStageName(name)`, `buildAttachmentPath(saleId, saleStageId, fileName)`, `validateUpload({sizeBytes, mime})`, `computeProgress(stages)`.
    - _Requisitos: 1.2, 1.4, 1.5, 1.8, 3.5, 4.2, 4.5_
  - [ ]* 8.2 Property test — adicionar etapa entra no fim
    - **Property 1: Adicionar etapa entra no fim**
    - **Validates: Requirements 1.2**
  - [ ]* 8.3 Property test — remover/reordenar normaliza posições
    - **Property 2: Remover/Reordenar normaliza as posições**
    - **Validates: Requirements 1.4, 1.5**
  - [ ]* 8.4 Property test — nome inválido é recusado
    - **Property 3: Nome inválido é recusado**
    - **Validates: Requirements 1.8**
  - [ ]* 8.5 Property test — caminho do anexo organizado por venda
    - **Property 10: Caminho do anexo é organizado por venda**
    - **Validates: Requirements 4.2**
  - [ ]* 8.6 Property test — validação de upload respeita tamanho e tipo
    - **Property 11: Validação de upload respeita tamanho e tipo**
    - **Validates: Requirements 4.5**
  - [ ]* 8.7 Property test — progresso geral conta concluídos sobre o total
    - **Property 9: Progresso geral conta concluídos sobre o total**
    - **Validates: Requirements 3.5**

- [ ] 9. Front — camada de acesso (`api.ts`)
  - [ ] 9.1 Implementar acesso ao template e à esteira em `src/features/produtos/esteira/api.ts`
    - Template: `fetchTemplate()`, `addStage(name)`, `renameStage(id, name)`, `removeStage(id)`, `reorderStages(orderedIds)`, `seedDefaultTemplate()`.
    - Esteira: `fetchSaleStages(saleId)`, `setStageStatus(stageId, status)` (gravando `completed_at`/`completed_by`), `setStageNote(stageId, note)`.
    - Mapear rows ↔ modelos usando `@/integrations/supabase/client`, espelhando `vendas/api.ts`.
    - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.5, 2.4, 3.1, 3.2, 3.3, 3.4, 5.5_
  - [ ] 9.2 Implementar acesso a anexos em `api.ts`
    - `listAttachments(stageId)`, `uploadAttachment(saleId, stageId, file)` (usa `buildAttachmentPath` + `supabase.storage.from(SALES_ATTACHMENTS_BUCKET)` e insere registro), `removeAttachment(attachment)` (remove arquivo no bucket e depois o vínculo, best-effort).
    - _Requisitos: 4.1, 4.2, 4.3, 4.4_

- [ ] 10. Front — hooks React Query (`hooks.ts`)
  - Implementar em `src/features/produtos/esteira/hooks.ts`: `useStageTemplate`, `useSaleStages(saleId)`, `useStageAttachments(stageId)` + mutations que invalidam as chaves correspondentes (padrão de `vendas/hooks.ts`).
  - _Requisitos: 1.1, 3.1, 3.5, 4.3_

- [ ] 11. Front — painel do consultor (`SaleStagePanel.tsx`)
  - [ ] 11.1 Implementar `src/features/produtos/esteira/SaleStagePanel.tsx`
    - Lista de passos na ordem, checkbox concluído/pendente, campo de observação, lista/upload/remoção de anexos e barra de progresso `done/total` (shadcn/ui).
    - _Requisitos: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.3, 4.4, 4.5_
  - [ ]* 11.2 Testes de exemplo do painel do consultor
    - Render: ordem dos passos, alternância de estado, barra de progresso, listagem de anexos.
    - _Requisitos: 3.1, 3.5, 4.3_

- [ ] 12. Front — admin do template (`StageTemplateAdmin.tsx`)
  - [ ] 12.1 Implementar `src/features/produtos/esteira/StageTemplateAdmin.tsx`
    - Adicionar/editar/remover/reordenar etapas (setas ou drag), validação de nome (`isValidStageName`) e botão "Inicializar com etapas padrão" quando vazio. Gated por papel admin/superadmin na UI.
    - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_
  - [ ]* 12.2 Testes de exemplo do admin do template
    - Validação de nome vazio recusada; seed padrão; reordenação reflete nova ordem.
    - _Requisitos: 1.6, 1.8, 1.5_

- [ ] 13. Front — re-exports
  - Criar `src/features/produtos/esteira/index.ts` re-exportando componentes, hooks e tipos públicos.
  - _Requisitos: 7.2_

- [ ] 14. Integração na UI de Vendas (sem tocar no CRM)
  - [ ] 14.1 Adicionar ação "Acompanhamento" no `SalesPipelineBoard`/painel de Vendas
    - No card de venda `fechado`, abrir o `SaleStagePanel` (Sheet/Dialog) da venda. Sem qualquer alteração em `kanban_stages`/`crm_deals`.
    - _Requisitos: 7.1, 7.2, 7.3_
  - [ ] 14.2 Expor a tela de admin do template na área administrativa de Produtos
    - Entrada de menu/admin para `StageTemplateAdmin`, gated por `has_role(admin/super_admin)` na UI.
    - _Requisitos: 1.1, 1.7_

- [ ]* 15. Testes de exemplo de RLS/storage e instanciação (integração)
  - [ ]* 15.1 Testes de isolamento e acesso (RLS)
    - Consultor só acessa progresso/anexos das próprias vendas; admin lê de qualquer venda; anônimo é recusado.
    - **Property 6: Progresso é isolado por venda** / **Validates: Requirements 2.5, 5.1, 5.2, 5.3, 5.4**
  - [ ]* 15.2 Teste de instanciação idempotente e snapshot
    - Chamar `ensure_sale_stage_progress` duas vezes não duplica nem altera progresso; renomear etapa no template não muda `name_snapshot` já gravado; etapas iniciam "pendente" na ordem.
    - **Property 4, 5, 12, 13** / **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 6.1, 6.2, 6.3, 6.4**
  - [ ]* 15.3 Teste de autoria/round-trip/CRM intacto
    - Concluir grava `completed_at`/`completed_by`; observação faz round-trip; operações da esteira não alteram `kanban_stages`/`crm_deals`.
    - **Property 7, 8, 14** / **Validates: Requirements 3.2, 3.3, 3.4, 5.5, 7.3**

- [ ] 16. Verificação final
  - Rodar `npx tsc --noEmit` e `npx vite build` (ambos exit 0).
  - Rodar a suíte com `npx vitest --run` (single-run, nunca watch).
  - Regenerar `src/integrations/supabase/types.ts` (MCP `generate_typescript_types`) para refletir as novas tabelas/enum.
  - Garantir que todos os testes passam; perguntar ao usuário se surgir dúvida.

## Notes

- Tarefas marcadas com `*` são opcionais (testes) e podem ser puladas para um MVP mais rápido, mas estão incluídas no grafo de dependências.
- Cada tarefa referencia requisitos específicos para rastreabilidade.
- Migrations de banco são aplicadas na hora via MCP `apply_migration` (project-ref `zlzasfhcxcznaprrragl`); nenhuma edge function muda nesta feature.
- Os testes de propriedade usam `fast-check` sobre `logic.ts` (mínimo 100 iterações) com a tag `Feature: acompanhamento-proposta, Property N: ...`.
- Não commitar `.kiro/settings/mcp.json`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "7"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3", "4", "5", "8.1"] },
    { "id": 3, "tasks": ["8.2", "8.3", "8.4", "8.5", "8.6", "8.7", "9.1", "9.2"] },
    { "id": 4, "tasks": ["10"] },
    { "id": 5, "tasks": ["11.1", "12.1"] },
    { "id": 6, "tasks": ["11.2", "12.2", "13"] },
    { "id": 7, "tasks": ["14.1", "14.2"] },
    { "id": 8, "tasks": ["15.1", "15.2", "15.3"] }
  ]
}
```
