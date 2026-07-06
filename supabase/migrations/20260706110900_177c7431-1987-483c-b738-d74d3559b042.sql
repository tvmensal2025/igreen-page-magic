
-- Claim atômico de 1 job pendente
CREATE OR REPLACE FUNCTION public.claim_recon_job()
RETURNS TABLE (
  id UUID, kind TEXT, target TEXT, params JSONB, attempts INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT q.id INTO v_id
  FROM public.igreen_recon_queue q
  WHERE q.status = 'pending'
  ORDER BY q.priority ASC, q.created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.igreen_recon_queue
  SET status = 'running', claimed_at = now(), attempts = attempts + 1
  WHERE public.igreen_recon_queue.id = v_id;

  RETURN QUERY
  SELECT q.id, q.kind, q.target, q.params, q.attempts
  FROM public.igreen_recon_queue q
  WHERE q.id = v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_recon_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_recon_job() TO service_role;

-- Storage policies para bucket igreen-recon (admins podem ler)
DROP POLICY IF EXISTS "Admins can read igreen-recon" ON storage.objects;
CREATE POLICY "Admins can read igreen-recon"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'igreen-recon' AND public.has_role(auth.uid(), 'admin'));
