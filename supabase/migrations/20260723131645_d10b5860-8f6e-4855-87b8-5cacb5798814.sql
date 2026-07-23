-- Caps por grupo da esteira Multicanal (A/B/C).
-- Grupo A: sem limite (lead novo/inbound). Não conta e não alerta.
-- Grupo B: reengajamento (nós tocamos). Cap default 150/dia.
-- Grupo C: reciclagem fria (RECALL_*). Cap default 50/dia.
-- Global outreach (B+C): teto anti-ban do canal WhatsApp. Default 200/dia.
ALTER TABLE public.daily_reheat_settings
  ADD COLUMN IF NOT EXISTS cap_b INTEGER NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS cap_c INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS cap_global_outreach INTEGER NOT NULL DEFAULT 200;