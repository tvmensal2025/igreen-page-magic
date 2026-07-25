-- Novos consultores: Cérebro OFF até ligar no modal de automações.
-- Não altera quem já está 'on' (piloto / existentes).
ALTER TABLE public.consultants
  ALTER COLUMN cerebro_ativo SET DEFAULT 'off';

COMMENT ON COLUMN public.consultants.cerebro_ativo IS
  'Cérebro IA no WhatsApp: off|on. Default off — consultor liga no modal Mensagens automáticas (opt-in).';
