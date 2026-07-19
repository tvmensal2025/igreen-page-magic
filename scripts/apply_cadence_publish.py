#!/usr/bin/env python3
"""Gera SQL de publish a partir de tmp_cadence_publish_payload.json (stdout)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAYLOAD = ROOT / "scripts" / "tmp_cadence_publish_payload.json"


def esc(s: str) -> str:
    return s.replace("'", "''")


def main() -> int:
    data = json.loads(PAYLOAD.read_text(encoding="utf-8"))
    if data.get("_blocked") or data.get("_reason", "").startswith("BLOQUEADO"):
        print(
            "ERRO: payload bloqueado (incidente catálogo curto 2026-07-19). "
            "Não gerar SQL de publish a partir deste arquivo.",
            file=sys.stderr,
        )
        return 2
    consultant = data["bot_flow"]["consultant_id"]
    variant = data["bot_flow"]["variant"]

    print("-- flow lookup")
    print(
        f"SELECT id INTO _flow_id FROM bot_flows WHERE consultant_id = '{consultant}'"
        f" AND variant = '{variant}' AND is_active = true ORDER BY updated_at DESC LIMIT 1;"
    )

    for step in data["bot_flow"]["steps"]:
        key = esc(step["step_key"])
        sets = ["updated_at = now()"]
        if step.get("message_text"):
            sets.append(f"message_text = E'{esc(step['message_text'])}'")
        if step.get("buttons"):
            btns = json.dumps(step["buttons"], ensure_ascii=False)
            sets.append(
                "captures = COALESCE("
                "(SELECT jsonb_agg(e) FROM jsonb_array_elements(COALESCE(captures, '[]'::jsonb)) e "
                "WHERE e->>'field' IS DISTINCT FROM '_buttons'), '[]'::jsonb)"
                f" || jsonb_build_array(jsonb_build_object('field','_buttons','enabled',true,'value', '{esc(btns)}'::jsonb))"
            )
        if step.get("voice_audio_clip_id"):
            sets.append(f"voice_audio_clip_id = '{esc(step['voice_audio_clip_id'])}'")
        print(
            f"\nUPDATE bot_flow_steps SET {', '.join(sets)} "
            f"WHERE flow_id = _flow_id AND step_key = '{key}';"
        )

    for ocr in data["bot_flow"]["ocr_retries"]:
        parent = esc(ocr["parent_key"])
        retry_text = esc(ocr["retry_text"])
        clip = ocr.get("retry_audio_clip_id")
        clip_sql = f", 'retry_audio_clip_id', '{esc(clip)}'" if clip else ""
        print(
            f"\nUPDATE bot_flow_steps SET fallback = COALESCE(fallback, '{{}}'::jsonb) || "
            f"jsonb_build_object('mode','retry','max_retries',2,'then','humano',"
            f"'retry_text', E'{retry_text}'{clip_sql}), updated_at = now() "
            f"WHERE flow_id = _flow_id AND step_key = '{parent}';"
        )

    for stage in data["stage_config"]["stages"]:
        st = esc(stage["stage"])
        body = esc(stage["message_text"])
        sets = [f"message_text = E'{body}'", "updated_at = now()"]
        if "buttons" in stage:
            if stage["buttons"] is None:
                sets.append("buttons = NULL")
            else:
                btns = esc(json.dumps(stage["buttons"], ensure_ascii=False))
                sets.append(f"buttons = '{btns}'::jsonb")
        if stage.get("voice_audio_clip_id"):
            sets.append(f"voice_audio_clip_id = '{esc(stage['voice_audio_clip_id'])}'")
        print(
            f"\nUPDATE cadence_stage_config SET {', '.join(sets)} "
            f"WHERE consultant_id IS NULL AND stage = '{st}';"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
