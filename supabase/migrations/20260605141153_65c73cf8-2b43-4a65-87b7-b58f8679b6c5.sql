DO $saneamento$
DECLARE
  s record;
  v_step_key text;
  matching_id uuid;
  new_fallback jsonb;
  broken_key text;
  fixed_count int := 0;
  removed_count int := 0;
BEGIN
  FOR s IN
    SELECT bfs.id, bfs.flow_id, bfs.step_key, bfs.fallback
    FROM public.bot_flow_steps bfs
    WHERE bfs.fallback IS NOT NULL
      AND (bfs.fallback ? 'goto_step_id' OR bfs.fallback ? 'success_goto_step_id')
  LOOP
    new_fallback := s.fallback;

    FOREACH broken_key IN ARRAY ARRAY['goto_step_id','success_goto_step_id']
    LOOP
      IF NOT (new_fallback ? broken_key) THEN
        CONTINUE;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.bot_flow_steps
        WHERE flow_id = s.flow_id
          AND id::text = (new_fallback->>broken_key)
      ) THEN
        CONTINUE;
      END IF;

      v_step_key := NULL;
      SELECT step_key INTO v_step_key
      FROM public.bot_flow_steps
      WHERE id::text = (new_fallback->>broken_key)
      LIMIT 1;

      matching_id := NULL;
      IF v_step_key IS NOT NULL THEN
        SELECT id INTO matching_id
        FROM public.bot_flow_steps
        WHERE flow_id = s.flow_id
          AND step_key = v_step_key
        LIMIT 1;
      END IF;

      IF matching_id IS NOT NULL THEN
        new_fallback := new_fallback || jsonb_build_object(broken_key, matching_id::text);
        fixed_count := fixed_count + 1;
        RAISE NOTICE 'Fixed % on step % (flow %): -> %', broken_key, s.step_key, s.flow_id, matching_id;
      ELSE
        new_fallback := new_fallback - broken_key;
        removed_count := removed_count + 1;
        RAISE NOTICE 'Removed broken % on step % (flow %)', broken_key, s.step_key, s.flow_id;
      END IF;
    END LOOP;

    IF new_fallback IS DISTINCT FROM s.fallback THEN
      UPDATE public.bot_flow_steps SET fallback = new_fallback WHERE id = s.id;
    END IF;
  END LOOP;

  RAISE NOTICE 'Saneamento concluído: % corrigidos, % removidos', fixed_count, removed_count;
END
$saneamento$;