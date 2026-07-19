/**
 * Gera migration de refresh dos atalhos Sofia A:
 * - upsert (seed se novo + refresh texto/triggers)
 * - lacunas de mídia (áudio + vídeo vazios) por QA
 */
import {
  OBJECTION_SHORTCUTS,
  formatIntentName,
  getMediaSlots,
} from "../src/lib/objectionShortcuts.ts";

const esc = (s: string) => s.replace(/'/g, "''");
const flowId = "59f53614-196c-4b6f-a029-59fadca78bd7";

let sql = `-- ============================================================================
-- Atalhos Sofia A v3 — textos profissionais + lacunas áudio/vídeo por QA
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_qa_media_slots(
  _qa_id uuid,
  _kinds text[] DEFAULT ARRAY['audio','video']::text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _kind text;
  _pos int;
BEGIN
  IF _qa_id IS NULL THEN RETURN; END IF;

  FOREACH _kind IN ARRAY _kinds LOOP
    IF _kind NOT IN ('audio', 'video', 'image') THEN CONTINUE; END IF;

    IF EXISTS (
      SELECT 1 FROM bot_flow_qa_media
      WHERE qa_id = _qa_id AND media_kind = _kind
    ) THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(MAX(position), -1) + 1 INTO _pos
    FROM bot_flow_qa_media WHERE qa_id = _qa_id;

    INSERT INTO bot_flow_qa_media (qa_id, position, media_kind, media_id, slot_key)
    VALUES (_qa_id, _pos, _kind, NULL, NULL);
  END LOOP;
END;
$$;

-- seed: cria QA + triggers + lacunas (se ainda não existir)
CREATE OR REPLACE FUNCTION public.seed_objection_shortcut(
  _flow_id uuid,
  _intent_name text,
  _text_response text,
  _triggers text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _qa_id uuid;
  _next_pos int;
  _phrase text;
BEGIN
  SELECT id INTO _qa_id FROM bot_flow_qa
  WHERE flow_id = _flow_id AND intent_name = _intent_name
  LIMIT 1;

  IF _qa_id IS NOT NULL THEN
    PERFORM public.ensure_qa_media_slots(_qa_id);
    RETURN _qa_id;
  END IF;

  SELECT COALESCE(MAX(position), -1) + 1 INTO _next_pos
  FROM bot_flow_qa WHERE flow_id = _flow_id;

  INSERT INTO bot_flow_qa (flow_id, position, intent_name, is_opening, is_closing, text_response)
  VALUES (_flow_id, _next_pos, _intent_name, false, false, NULLIF(_text_response, ''))
  RETURNING id INTO _qa_id;

  FOREACH _phrase IN ARRAY _triggers LOOP
    IF length(trim(_phrase)) > 0 THEN
      INSERT INTO bot_flow_qa_triggers (qa_id, phrase) VALUES (_qa_id, trim(_phrase));
    END IF;
  END LOOP;

  PERFORM public.ensure_qa_media_slots(_qa_id);
  RETURN _qa_id;
END;
$$;

-- refresh: atualiza texto + triggers e garante lacunas (não apaga mídia já preenchida)
CREATE OR REPLACE FUNCTION public.refresh_objection_shortcut(
  _flow_id uuid,
  _intent_name text,
  _text_response text,
  _triggers text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _qa_id uuid;
  _phrase text;
BEGIN
  SELECT id INTO _qa_id FROM bot_flow_qa
  WHERE flow_id = _flow_id AND intent_name = _intent_name
  LIMIT 1;

  IF _qa_id IS NULL THEN
    -- cria se ainda não existir (novos atalhos)
    _qa_id := public.seed_objection_shortcut(_flow_id, _intent_name, _text_response, _triggers);
    RETURN _qa_id;
  END IF;

  UPDATE bot_flow_qa
  SET text_response = NULLIF(_text_response, ''),
      updated_at = now()
  WHERE id = _qa_id;

  DELETE FROM bot_flow_qa_triggers WHERE qa_id = _qa_id;

  FOREACH _phrase IN ARRAY _triggers LOOP
    IF length(trim(_phrase)) > 0 THEN
      INSERT INTO bot_flow_qa_triggers (qa_id, phrase) VALUES (_qa_id, trim(_phrase));
    END IF;
  END LOOP;

  PERFORM public.ensure_qa_media_slots(_qa_id);
  RETURN _qa_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_qa_media_slots(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_objection_shortcut(uuid, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_objection_shortcut(uuid, text, text, text[]) TO authenticated;

`;

for (const s of OBJECTION_SHORTCUTS) {
  const intent = formatIntentName(s);
  const triggers = "ARRAY[" + s.triggers.map((t) => `'${esc(t)}'`).join(",") + "]::text[]";
  const kinds = getMediaSlots(s);
  sql += `SELECT public.refresh_objection_shortcut('${flowId}', '${esc(intent)}', '${esc(s.text)}', ${triggers});\n`;
  // ensure slots with explicit kinds (idempotent)
  sql += `SELECT public.ensure_qa_media_slots(\n  (SELECT id FROM bot_flow_qa WHERE flow_id = '${flowId}' AND intent_name = '${esc(intent)}' LIMIT 1),\n  ARRAY[${kinds.map((k) => `'${k}'`).join(",")}]::text[]\n);\n`;
}

const totalTriggers = OBJECTION_SHORTCUTS.reduce((n, s) => n + s.triggers.length, 0);
sql += `\n-- Total: ${OBJECTION_SHORTCUTS.length} QAs, ${totalTriggers} gatilhos, lacunas áudio+vídeo por atalho\n`;

const out = "supabase/migrations/20260719030000_sofia_qa_shortcuts_v3_media_slots.sql";
await Deno.writeTextFile(out, sql);
console.log(`written ${out}: ${OBJECTION_SHORTCUTS.length} qas, ${totalTriggers} triggers`);
