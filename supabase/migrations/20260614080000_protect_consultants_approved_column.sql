-- ============================================================================
-- SEGURANÇA — Proteção da coluna public.consultants.approved (anti self-approval)
-- ============================================================================
-- Problema (estado verificado no código/migrations, NÃO testado contra o banco):
-- A política RLS "Owner update" em public.consultants foi criada em
-- 20260326121425 como:
--   CREATE POLICY "Owner update" ON public.consultants
--     FOR UPDATE TO authenticated USING (id = auth.uid());
-- Ela nunca foi dropada nem redefinida, NÃO tem WITH CHECK e NÃO há
-- REVOKE UPDATE (approved). Como o gate de acesso ao painel depende de
-- consultants.approved (ver useAdminAuth/Admin.tsx, checagem client-side),
-- um consultor autenticado poderia, em tese, dar UPDATE na própria linha
-- setando approved = true e se auto-aprovar, furando o fluxo de aprovação
-- pelo admin/super-admin.
--
-- Por que WITH CHECK não basta:
-- Diferente de "Owner update customers" (onde o risco era reatribuir
-- consultant_id e WITH CHECK (consultant_id = auth.uid()) resolve), aqui o
-- risco é mudar a coluna `approved` na PRÓPRIA linha. WITH CHECK (id =
-- auth.uid()) continuaria passando, porque o id permanece o do próprio dono.
--
-- Por que REVOKE de coluna não basta:
-- REVOKE UPDATE (approved) ... FROM authenticated também bloquearia o admin,
-- que também é `authenticated` — quebraria a aprovação legítima.
--
-- Correção: trigger BEFORE UPDATE que só permite alterar `approved` quando o
-- chamador é admin/super-admin (has_role/is_super_admin) OU quando não há
-- usuário no contexto (auth.uid() IS NULL = backend/service_role/migrations).
-- Para o dono comum, qualquer tentativa de mudar `approved` é silenciosamente
-- revertida ao valor antigo (OLD.approved), preservando os demais campos do
-- UPDATE. Assim a edição de perfil do próprio consultor continua funcionando.
--
-- ESCOPO CIRÚRGICO: cria 1 função + 1 trigger. NÃO altera a policy "Owner
-- update", nem GRANTs, nem outras políticas de public.consultants.
--
-- ⚠️ NÃO AUTO-APLICÁVEL: requer aprovação humana explícita. Validar com roles
-- simuladas (dono comum tenta self-approve = revertido; admin aprova = ok)
-- antes de aplicar em produção.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_protect_consultants_approved ON public.consultants;
--   DROP FUNCTION IF EXISTS public.protect_consultants_approved();
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_consultants_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sem mudança no valor de approved: nada a fazer.
  IF NEW.approved IS NOT DISTINCT FROM OLD.approved THEN
    RETURN NEW;
  END IF;

  -- Backend (service_role, migrations, triggers internos) roda sem auth.uid().
  -- Mantém comportamento atual de seed/backfill/aprovação programática.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admin e super-admin podem alterar approved (aprovação legítima).
  IF public.has_role(auth.uid(), 'admin'::app_role)
     OR public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Qualquer outro chamador (o próprio dono comum): ignora a tentativa de
  -- mudar `approved`, preservando o restante do UPDATE.
  NEW.approved := OLD.approved;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_consultants_approved ON public.consultants;
CREATE TRIGGER trg_protect_consultants_approved
  BEFORE UPDATE OF approved ON public.consultants
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_consultants_approved();
