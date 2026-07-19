#!/usr/bin/env python3
"""Audit pizza A 'Fluxo': dwell, silêncio, bloqueios e gap vs ciclo A→B.

Fonte: export JSON de lead_cadence_state (AI_QUALIFYING/PAUSED) do consultor.
Regra de negócio esperada (produto):
  lead em conversa → silêncio ~2h → liga/retry/SMS/fecha (Grupo A)
  → depois Grupo B (COLD_*) — nunca A e B ao mesmo tempo.
  Tempos de entrada são append-only (nunca sumir da ficha).
"""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

NOW = datetime.now(timezone.utc)
DEAD_STEPS = (
    "atendimento_finalizado",
    "aguardando_avaliacao_atendimento",
    "aguardando_humano",
)


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace(" ", "T")
    if re.search(r"[+-]\d{2}$", text):
        text = text + ":00"
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def hours_ago(dt: datetime | None) -> float | None:
    if not dt:
        return None
    return round((NOW - dt).total_seconds() / 3600, 1)


def load_rows(path: Path) -> list[dict]:
    raw = path.read_text(encoding="utf-8")
    try:
        wrapper = json.loads(raw)
        if isinstance(wrapper, dict) and isinstance(wrapper.get("result"), str):
            raw = wrapper["result"]
        elif isinstance(wrapper, list):
            return wrapper
    except json.JSONDecodeError:
        pass

    match = re.search(
        r"<untrusted-data[^>]*>\s*(\[\s*\{.*\}\s*\])\s*</untrusted-data",
        raw,
        flags=re.S,
    )
    if match:
        return json.loads(match.group(1))

    start = raw.find("[{")
    end = raw.rfind("}]")
    if start >= 0 and end > start:
        return json.loads(raw[start : end + 2])
    raise ValueError(f"formato inesperado em {path}")


def classify(row: dict) -> dict:
    stage = row.get("stage") or ""
    step = (row.get("conversation_step") or row.get("current_step_id") or "") or ""
    step_l = step.lower()
    reason = row.get("paused_reason") or ""
    entered = (
        parse_dt(row.get("stage_entered_at"))
        or parse_dt(row.get("last_response_at"))
        or parse_dt(row.get("cadence_updated"))
    )
    last_in = parse_dt(row.get("last_msg_in")) or parse_dt(row.get("last_inbound_at"))
    next_at = parse_dt(row.get("next_action_at"))
    paused_until = parse_dt(row.get("paused_until"))
    created = parse_dt(row.get("customer_created"))
    silence_h = hours_ago(last_in) if last_in else hours_ago(entered)
    age_h = hours_ago(created)
    stage_h = hours_ago(entered)

    if reason == "dnc":
        block = "dnc_nao_deveria_estar_na_pizza"
    elif reason == "manual_admin_clear_sla_backlog":
        block = "congelado_sla_backlog_ate_ago"
    elif reason == "lead_responded":
        block = "paused_72h_pos_inbound"
    elif any(token in step_l for token in DEAD_STEPS):
        block = "conversa_encerrada_sem_avanco"
    elif "flow:" in step_l:
        block = "fluxo_ativo"
    else:
        block = "ai_ou_paused_generico"

    if silence_h is None:
        desired = "sem_sinal_tempo"
    elif silence_h >= 72:
        desired = "B_COLD_1"
    elif silence_h >= 24:
        desired = "A_fecha_depois_B"
    elif silence_h >= 2:
        desired = "A_silencio_liga_sms"
    else:
        desired = "ainda_quente"

    if stage == "PAUSED" and paused_until and paused_until > NOW:
        due_h = round((paused_until - NOW).total_seconds() / 3600, 1)
        auto = f"tick→COLD_1 em {due_h}h (pula fatias A)"
    elif next_at and next_at > NOW:
        due_h = round((next_at - NOW).total_seconds() / 3600, 1)
        auto = f"next_action em {due_h}h (sem ciclo A visual)"
    elif next_at and next_at <= NOW:
        auto = "next_action VENCIDO — tick deveria ter movido"
    else:
        auto = "SEM next_action — parado de vez"

    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "stage": stage,
        "step": step[:80] if step else None,
        "paused_reason": reason or None,
        "age_h": age_h,
        "stage_h": stage_h,
        "silence_h": silence_h,
        "msgs": row.get("msg_count"),
        "stage_sequence": row.get("stage_sequence"),
        "journey_started_at": row.get("journey_started_at"),
        "in_queue_b": bool(row.get("in_queue_b_today")),
        "block": block,
        "desired": desired,
        "auto": auto,
    }


def summarize(rows: list[dict]) -> dict:
    classified = [classify(r) for r in rows]
    blocks = Counter(x["block"] for x in classified)
    desired = Counter(x["desired"] for x in classified)
    silences = sorted(x["silence_h"] for x in classified if x["silence_h"] is not None)
    stages = sorted(x["stage_h"] for x in classified if x["stage_h"] is not None)
    seq_zero = sum(1 for x in classified if int(x.get("stage_sequence") or 0) == 0)
    overlap_b = sum(1 for x in classified if x["in_queue_b"])
    should_move = [
        x
        for x in classified
        if x["desired"] in {"A_silencio_liga_sms", "A_fecha_depois_B", "B_COLD_1"}
    ]

    def pctile(vals: list[float], p: float) -> float | None:
        if not vals:
            return None
        idx = min(len(vals) - 1, max(0, int(len(vals) * p)))
        return vals[idx]

    return {
        "generated_at": NOW.isoformat(),
        "n": len(classified),
        "overlap_queue_b_today": overlap_b,
        "stage_sequence_zero_pct": round(100 * seq_zero / max(len(classified), 1), 1),
        "blocks": dict(blocks),
        "desired_by_silence": dict(desired),
        "silence_h": {
            "min": silences[0] if silences else None,
            "p50": pctile(silences, 0.5),
            "p90": pctile(silences, 0.9),
            "max": silences[-1] if silences else None,
        },
        "stage_dwell_h": {
            "min": stages[0] if stages else None,
            "p50": pctile(stages, 0.5),
            "p90": pctile(stages, 0.9),
            "max": stages[-1] if stages else None,
        },
        "should_auto_advance_n": len(should_move),
        "should_auto_advance": sorted(
            should_move,
            key=lambda x: x["silence_h"] or 0,
            reverse=True,
        ),
        "leads": classified,
        "gaps": [
            "Pizza Fluxo = visual; ciclo A (wait2h/call/sms) vem do daily_reheat e ignora PAUSED",
            "cadence-tick: PAUSED→COLD_1 após 72h — pula silêncio/liga/SMS da pizza A",
            "manual_admin_clear_sla_backlog empurra next_action para semanas — trava o motor",
            "lead_cadence_state.stage sobrescreve; não há lead_cadence_stage_history append-only",
            "journey_started_at / stage_entered_at existem mas stage_sequence=0 em massa",
            "DNC não pode aparecer na pizza A",
        ],
    }


def main() -> None:
    src = Path(
        "/home/dev/.cursor/projects/home-dev-Documents-ultra-cursor-igreen-official-portal/"
        "agent-tools/0980c8d0-3b31-49a0-aac4-fd3b3242e7c6.txt"
    )
    out_json = Path("scripts/tmp_fluxo_a_audit.json")
    out_md = Path("scripts/tmp_fluxo_a_audit.md")
    rows = load_rows(src)
    report = summarize(rows)
    out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Audit Pizza A — Em conversa / fluxo",
        "",
        f"Gerado: `{report['generated_at']}`",
        f"Total leads: **{report['n']}**",
        f"Overlap fila B hoje: **{report['overlap_queue_b_today']}** (deve ser 0)",
        f"`stage_sequence=0`: **{report['stage_sequence_zero_pct']}%**",
        "",
        "## Bloqueios",
    ]
    for key, value in sorted(report["blocks"].items(), key=lambda kv: -kv[1]):
        lines.append(f"- `{key}`: {value}")
    lines += ["", "## Destino esperado por silêncio"]
    for key, value in sorted(report["desired_by_silence"].items(), key=lambda kv: -kv[1]):
        lines.append(f"- `{key}`: {value}")
    lines += [
        "",
        f"## Silêncio (h): {report['silence_h']}",
        f"## Dwell no stage (h): {report['stage_dwell_h']}",
        "",
        f"## Deveriam avançar automaticamente: {report['should_auto_advance_n']}",
    ]
    for item in report["should_auto_advance"][:25]:
        lines.append(
            f"- sil={item['silence_h']}h | {item['desired']} | {item['block']} | "
            f"{item['name']} | {item['auto']}"
        )
    lines += ["", "## Gaps de produto/código"]
    for gap in report["gaps"]:
        lines.append(f"- {gap}")
    out_md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(out_md.read_text(encoding="utf-8"))
    print(f"JSON → {out_json}")


if __name__ == "__main__":
    main()
