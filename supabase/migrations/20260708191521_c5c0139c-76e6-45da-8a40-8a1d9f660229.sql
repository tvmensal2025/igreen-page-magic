ALTER TABLE public.network_members
  ADD COLUMN IF NOT EXISTS igreen_account_id uuid REFERENCES public.igreen_portal_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS network_members_owner_account_idx
  ON public.network_members(consultant_id, igreen_account_id);