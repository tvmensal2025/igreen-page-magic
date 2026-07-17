
CREATE TABLE public.admin_setup_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  done_at timestamptz NOT NULL DEFAULT now(),
  note text,
  UNIQUE (user_id, item_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_setup_checklist TO authenticated;
GRANT ALL ON public.admin_setup_checklist TO service_role;
ALTER TABLE public.admin_setup_checklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own checklist" ON public.admin_setup_checklist FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
