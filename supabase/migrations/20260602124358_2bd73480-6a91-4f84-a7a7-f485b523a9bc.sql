DO $$
DECLARE
  r RECORD;
  new_trans jsonb;
  t jsonb;
  i int;
  pos int;
  variants text[];
  existing text[];
  merged text[];
BEGIN
  FOR r IN
    SELECT s.id, s.transitions
    FROM bot_flow_steps s
    JOIN bot_flows f ON f.id = s.flow_id
    WHERE f.is_public = true AND f.variant = 'D'
      AND jsonb_typeof(s.transitions) = 'array'
      AND jsonb_array_length(s.transitions) > 0
  LOOP
    new_trans := '[]'::jsonb;
    pos := 0;
    FOR i IN 0..(jsonb_array_length(r.transitions)-1) LOOP
      t := r.transitions -> i;
      -- skip default transitions
      IF coalesce(t->>'trigger_intent','') = 'default' THEN
        new_trans := new_trans || jsonb_build_array(t);
        CONTINUE;
      END IF;
      pos := pos + 1;
      variants := CASE pos
        WHEN 1 THEN ARRAY['1','1)','1.','um','primeira','primeiro']
        WHEN 2 THEN ARRAY['2','2)','2.','dois','segunda','segundo']
        WHEN 3 THEN ARRAY['3','3)','3.','três','tres','terceira','terceiro']
        ELSE ARRAY[]::text[]
      END;
      existing := COALESCE(ARRAY(SELECT jsonb_array_elements_text(t->'trigger_phrases')), ARRAY[]::text[]);
      merged := ARRAY(SELECT DISTINCT unnest(existing || variants));
      t := jsonb_set(t, '{trigger_phrases}', to_jsonb(merged));
      new_trans := new_trans || jsonb_build_array(t);
    END LOOP;
    UPDATE bot_flow_steps SET transitions = new_trans WHERE id = r.id;
  END LOOP;
END $$;