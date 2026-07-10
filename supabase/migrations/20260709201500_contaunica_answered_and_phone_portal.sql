-- Flag: lead já respondeu boleto unificado vs separado (contaunica).
-- Sem isso, DEFAULT false em contaunica fazia o bot pular a pergunta.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS contaunica_answered boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.customers.contaunica_answered IS
  'true quando o lead escolheu boleto unificado/separado no bot (ask_contaunica).';

COMMENT ON COLUMN public.customers.contaunica IS
  'true = boleto unificado; false = boleto separado. Só válido se contaunica_answered=true.';
