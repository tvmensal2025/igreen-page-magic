-- Flag: lead já respondeu se deseja transferir titularidade (campo independente de contaunica).
-- No portal iGreen, contaunica e transferir_titularidade são perguntas separadas.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS transferir_titularidade_answered boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.customers.transferir_titularidade_answered IS
  'true quando o lead respondeu sim/não à transferência de titularidade (ask_transferir_titularidade).';

COMMENT ON COLUMN public.customers.transferir_titularidade IS
  'true = deseja transferir titularidade para a iGreen; false = manter no próprio nome. Só válido se transferir_titularidade_answered=true.';
