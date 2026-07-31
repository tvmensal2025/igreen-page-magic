CREATE TABLE public.academy_progress (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  item_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'lesson',
  pct INTEGER NOT NULL DEFAULT 0,
  done BOOLEAN NOT NULL DEFAULT false,
  score INTEGER,
  passed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT academy_progress_unique UNIQUE (user_id, kind, item_key),
  CONSTRAINT academy_progress_kind_chk CHECK (kind IN ('lesson','exam')),
  CONSTRAINT academy_progress_pct_chk CHECK (pct >= 0 AND pct <= 100)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.academy_progress TO authenticated;
GRANT ALL ON public.academy_progress TO service_role;

ALTER TABLE public.academy_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own academy progress"
ON public.academy_progress FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins read academy progress"
ON public.academy_progress FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_academy_progress_user ON public.academy_progress (user_id);

CREATE TRIGGER update_academy_progress_updated_at
BEFORE UPDATE ON public.academy_progress
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();