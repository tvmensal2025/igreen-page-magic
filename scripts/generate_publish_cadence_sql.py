#!/usr/bin/env python3
"""Gera SQL transacional para publish Multicanal → bot_flow_steps + cadence_stage_config."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAYLOAD = ROOT / "scripts" / "tmp_cadence_publish_payload.json"
FLOW_ID = "59f53614-196c-4b6f-a029-59fadca78bd7"
OUT = ROOT / "scripts" / "tmp_publish_cadence.sql"


_tag_counter = 0


def dollar_tag(text: str) -> str:
    global _tag_counter
    while True:
        _tag_counter += 1
        tag = f"cad{_tag_counter}"
        if f"${tag}$" not in text:
            return tag


def q_literal(text: str) -> str:
    tag = dollar_tag(text)
    return f"${tag}${text}${tag}$"


def main() -> None:
    data = json.loads(PAYLOAD.read_text(encoding="utf-8"))
    lines: list[str] = ["BEGIN;"]

    for step in data["bot_flow"]["steps"]:
        key = step["step_key"].replace("'", "''")
        sets = ["updated_at = now()"]
        if step.get("message_text"):
            sets.append(f"message_text = {q_literal(step['message_text'])}")
        if step.get("buttons"):
            btns = json.dumps(step["buttons"], ensure_ascii=False)
            sets.append(
                "captures = COALESCE("
                "(SELECT jsonb_agg(e) FROM jsonb_array_elements(COALESCE(captures, '[]'::jsonb)) e "
                "WHERE e->>'field' IS DISTINCT FROM '_buttons'), '[]'::jsonb)"
                f" || jsonb_build_array(jsonb_build_object('field','_buttons','enabled',true,'value', {q_literal(btns)}::jsonb))"
            )
        if step.get("voice_audio_clip_id"):
            clip = step["voice_audio_clip_id"].replace("'", "''")
            sets.append(f"voice_audio_clip_id = '{clip}'")
        lines.append(
            f"UPDATE bot_flow_steps SET {', '.join(sets)} "
            f"WHERE flow_id = '{FLOW_ID}' AND step_key = '{key}';"
        )

    for ocr in data["bot_flow"]["ocr_retries"]:
        parent = ocr["parent_key"].replace("'", "''")
        retry_text = q_literal(ocr["retry_text"])
        clip = ocr.get("retry_audio_clip_id")
        if clip:
            clip_part = f", 'retry_audio_clip_id', '{clip.replace(chr(39), chr(39)*2)}'"
        else:
            clip_part = ""
        lines.append(
            f"UPDATE bot_flow_steps SET fallback = COALESCE(fallback, '{{}}'::jsonb) || "
            f"jsonb_build_object('mode','retry','max_retries',2,'then','humano',"
            f"'retry_text', {retry_text}{clip_part}), updated_at = now() "
            f"WHERE flow_id = '{FLOW_ID}' AND step_key = '{parent}';"
        )

    for stage in data["stage_config"]["stages"]:
        st = stage["stage"].replace("'", "''")
        sets = [f"message_text = {q_literal(stage['message_text'])}", "updated_at = now()"]
        if "buttons" in stage:
            if stage["buttons"] is None:
                sets.append("buttons = NULL")
            else:
                btns = json.dumps(stage["buttons"], ensure_ascii=False)
                sets.append(f"buttons = {q_literal(btns)}::jsonb")
        if stage.get("voice_audio_clip_id"):
            clip = stage["voice_audio_clip_id"].replace("'", "''")
            sets.append(f"voice_audio_clip_id = '{clip}'")
        lines.append(
            f"UPDATE cadence_stage_config SET {', '.join(sets)} "
            f"WHERE consultant_id IS NULL AND stage = '{st}';"
        )

    # Biblioteca remota (espelho do painel)
    lib_payload = json.dumps(
        {
            "version": 2,
            "bodies": {s["step_key"]: s.get("message_text", "") for s in data["bot_flow"]["steps"]},
            "buttons": {
                s["step_key"]: s["buttons"]
                for s in data["bot_flow"]["steps"]
                if s.get("buttons")
            },
            "audioClipIds": {},
            "segmentBodies": {},
            "segmentApproved": {},
            "approved": {},
            "audioUrls": {},
            "updatedAt": data["generated_at"],
        },
        ensure_ascii=False,
    )
    consultant = data["bot_flow"]["consultant_id"]
    lines.append(
        "UPDATE ai_media_library SET active = false, updated_at = now() "
        f"WHERE consultant_id = '{consultant}' AND slot_key = 'multichannel_cadence_v2' AND active = true;"
    )
    lines.append(
        "INSERT INTO ai_media_library (consultant_id, slot_key, kind, label, url, text_content, active, send_order, is_draft, is_public, delay_before_ms, priority) "
        f"VALUES ('{consultant}', 'multichannel_cadence_v2', 'text', 'Multicanal · biblioteca painel', 'about:blank', "
        f"{q_literal(lib_payload)}, true, 0, false, false, 0, 0);"
    )

    lines.append("COMMIT;")
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT} ({len(lines)} statements)")


if __name__ == "__main__":
    main()
