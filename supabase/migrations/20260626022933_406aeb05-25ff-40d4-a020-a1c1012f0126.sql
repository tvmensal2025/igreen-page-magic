ALTER TABLE public.consultants ADD COLUMN IF NOT EXISTS display_name TEXT;

COMMENT ON COLUMN public.consultants.display_name IS 'Nome humano usado nas mensagens enviadas ao lead (ex: "Abel Olympio"). Quando NULL, cai pro consultants.name; quando o name é slug-like (sem espaço, minúsculo, com dígitos ou >=9 chars), render-vars cai pro genérico "consultor".';

-- Backfill: copia name para display_name apenas quando o name já tem espaço
-- (é um nome humano real, não um slug de login como "abelolympio").
UPDATE public.consultants
SET display_name = name
WHERE display_name IS NULL
  AND name IS NOT NULL
  AND name ~ '\s'
  AND length(trim(name)) >= 3;