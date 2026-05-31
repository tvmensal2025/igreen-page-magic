-- ============================================================================
-- REQ 4 — WITH CHECK em "Owner update customers" (public.customers)
-- ============================================================================
-- Spec: evolution-multiconsultor-pronto / Tarefa 7.2
-- _Requirements: 4.1, 4.2, 4.3, 6.1, 6.3, 6.4_
--
-- Problema (estado verificado em produção): a política RLS
-- "Owner update customers" em public.customers tem
--   USING (consultant_id = auth.uid())  e  WITH CHECK = NULL.
-- Com múltiplos consultores reais, a ausência de WITH CHECK permite que um dono
-- reatribua `consultant_id` para si ou para outro consultor durante um UPDATE,
-- quebrando o isolamento multi-tenant (IDOR). A USING só filtra a linha ANTES
-- da alteração; sem WITH CHECK, o valor RESULTANTE não é validado.
--
-- Correção: recriar a política mantendo o mesmo USING e adicionando
--   WITH CHECK (consultant_id = auth.uid())
-- de modo que o consultant_id resultante de qualquer UPDATE permaneça igual a
-- auth.uid(). Qualquer UPDATE que tente apontar consultant_id para outro
-- consultor passa a ser rejeitado.
--
-- ESCOPO CIRÚRGICO: esta migração toca SOMENTE a política
-- "Owner update customers". Todas as outras 8 políticas de public.customers
-- permanecem INTACTAS, incluindo:
--   - "Assigned consultant update customers" (UPDATE, assigned_consultant_id)
--   - acessos de admin / líder / manager (SELECT)
--   - "Owner select/insert/delete customers"
-- Backup verbatim das 9 políticas: .kiro/specs/evolution-multiconsultor-pronto/rollback/req4-backup.md
--
-- ⚠️ NÃO AUTO-APLICÁVEL: requer aprovação humana explícita e validação prévia
-- com roles simuladas. NÃO aplicar via apply_migration sem o sinal verde do
-- operador (_Requirements 6.1, 6.3, 6.4_).
--
-- Rollback (ver tarefa 7.4): recriar a política SEM a cláusula WITH CHECK:
--   DROP POLICY "Owner update customers" ON public.customers;
--   CREATE POLICY "Owner update customers" ON public.customers
--     FOR UPDATE TO authenticated
--     USING (consultant_id = auth.uid());
-- ============================================================================

DROP POLICY "Owner update customers" ON public.customers;

CREATE POLICY "Owner update customers" ON public.customers
  FOR UPDATE TO authenticated
  USING (consultant_id = auth.uid())
  WITH CHECK (consultant_id = auth.uid());
