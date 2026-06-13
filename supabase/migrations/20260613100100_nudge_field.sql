-- Campo para controlar nudge de re-engajamento pós-FAQ
ALTER TABLE customers ADD COLUMN IF NOT EXISTS nudge_sent_at timestamptz;

-- Index parcial para a cron query de nudge (filtra por detour_count + bot ativo)
CREATE INDEX IF NOT EXISTS idx_customers_nudge_candidates
  ON customers (last_bot_reply_at, nudge_sent_at)
  WHERE detour_count > 0 AND bot_paused = false AND is_converted = false;
