-- ============================================================================
-- Fix: coluna consultant_id ausente em ai_knowledge_sections (drift de migration)
-- ============================================================================
-- A migration 20260522220000_ai_learning_improvements.sql adicionava esta coluna,
-- mas nunca foi aplicada neste banco (drift entre repo e DB vivo). As edge
-- functions do bot (ai-faq-answerer, ai-agent-router, ai-sales-agent) consultam
-- a base com:
--   .or('consultant_id.is.null,consultant_id.eq.<uuid>')
-- e a query FALHAVA (coluna inexistente) → data=null → base de conhecimento
-- vinha vazia → a IA caía direto em handoff humano em vez de responder dúvidas
-- (golpe?, é seguro?, como funciona?) com a base do /admin/conhecimento.
--
-- Correção mínima e aditiva: adiciona a coluna (nullable = global por padrão).
-- As seções existentes ficam com consultant_id = NULL = global, que é
-- exatamente o que o filtro .or(consultant_id.is.null,...) espera.
-- Idempotente (IF NOT EXISTS).

ALTER TABLE public.ai_knowledge_sections
  ADD COLUMN IF NOT EXISTS consultant_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_consultant
  ON public.ai_knowledge_sections (consultant_id, is_active, position)
  WHERE is_active = true;
