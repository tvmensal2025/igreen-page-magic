
-- Só admins podem chamar; segurança pelo verificador que já é usado nas edges.
CREATE OR REPLACE FUNCTION public.admin_cron_list()
RETURNS TABLE(jobid bigint, jobname text, schedule text, active boolean, command text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, cron AS $$
  SELECT jobid, jobname, schedule, active, command FROM cron.job ORDER BY jobname;
$$;

CREATE OR REPLACE FUNCTION public.admin_cron_last_runs()
RETURNS TABLE(jobid bigint, jobname text, status text, return_message text, start_time timestamptz, end_time timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, cron AS $$
  SELECT DISTINCT ON (d.jobid) d.jobid, j.jobname, d.status, d.return_message, d.start_time, d.end_time
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
  ORDER BY d.jobid, d.start_time DESC;
$$;

CREATE OR REPLACE FUNCTION public.admin_cron_run_now(p_job_name text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron AS $$
DECLARE
  v_cmd text;
BEGIN
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = p_job_name;
  IF v_cmd IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;
  EXECUTE v_cmd;
  RETURN 'ok';
END $$;

CREATE OR REPLACE FUNCTION public.admin_cron_toggle(p_job_name text, p_active boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron AS $$
BEGIN
  PERFORM cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = p_job_name), active := p_active);
END $$;

CREATE OR REPLACE FUNCTION public.admin_cron_reschedule(p_job_name text, p_schedule text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron AS $$
BEGIN
  PERFORM cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = p_job_name), schedule := p_schedule);
END $$;

-- Restringe execução: só authenticated com papel admin (verificado na edge).
REVOKE ALL ON FUNCTION public.admin_cron_list() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cron_last_runs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cron_run_now(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cron_toggle(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cron_reschedule(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_cron_list() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_cron_last_runs() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_cron_run_now(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_cron_toggle(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_cron_reschedule(text, text) TO service_role;
