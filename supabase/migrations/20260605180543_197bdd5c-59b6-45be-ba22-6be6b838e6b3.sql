CREATE OR REPLACE FUNCTION public.try_lock_step_dispatch(p_customer_id uuid, p_step_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key1 bigint;
  v_key2 bigint;
BEGIN
  -- Compor chave estável a partir do customer + step (independente do plano)
  v_key1 := ('x' || substr(md5(p_customer_id::text), 1, 16))::bit(64)::bigint;
  v_key2 := ('x' || substr(md5(COALESCE(p_step_key, '')), 1, 16))::bit(64)::bigint;
  RETURN pg_try_advisory_xact_lock(v_key1, v_key2);
END;
$$;

GRANT EXECUTE ON FUNCTION public.try_lock_step_dispatch(uuid, text) TO authenticated, service_role;