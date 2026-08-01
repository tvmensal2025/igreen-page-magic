-- Liberar reuso de assistant_name entre consultores.
-- Motivo: mesmo nome de IA (ex.: Sofia, Yasmin) permite reaproveitar áudios
-- e não há problema de negócio em duas contas usarem o mesmo nome.
-- A migration antiga (20260727122226) e a função ficam no histórico;
-- o trigger de bloqueio é desativado e a função vira no-op.

CREATE OR REPLACE FUNCTION public.enforce_reserved_assistant_names()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Reuso permitido (qualquer consultor pode usar Sofia/Yasmin/Sol/Luciana/etc.).
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_reserved_assistant_names ON public.consultants;
