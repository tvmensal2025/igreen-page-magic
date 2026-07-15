-- Worker Club: colunas próprias de status (NÃO misturar com portal2_*).
-- Incremental: só ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS club_status text,
  ADD COLUMN IF NOT EXISTS club_error text,
  ADD COLUMN IF NOT EXISTS club_error_kind text,
  ADD COLUMN IF NOT EXISTS club_payload jsonb,
  ADD COLUMN IF NOT EXISTS club_response jsonb,
  ADD COLUMN IF NOT EXISTS club_dry_run boolean,
  ADD COLUMN IF NOT EXISTS club_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS club_updated_at timestamptz;

COMMENT ON COLUMN public.customers.club_status IS
  'Status do WorkerClub (dry_run|dry_run_ok|submitting|submitted|error) — independente do Portal 2';
