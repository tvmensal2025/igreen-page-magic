#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audit-cadence-groups-abc.py — Mapeamento Grupos A / B / C da cadência multicanal.

Valida alinhamento entre:
  - Catálogo UI (`src/lib/multichannelCadenceTexts.ts`)
  - Motor (`cadence_stage_config` / `syncCadenceToBotFlow.ts`)
  - Envio (`cadence-tick` + `cadence-stage-buttons.ts`)
  - Retorno inbound (`cadence-inbound-router.ts` + webhooks)

Uso:
  python3 scripts/audit-cadence-groups-abc.py
  python3 scripts/audit-cadence-groups-abc.py --markdown
  python3 scripts/audit-cadence-groups-abc.py --json > /tmp/audit-abc.json

Context7: documentação Whapi/Evolution pode ser consultada via MCP
`@upstash/context7-mcp` (ver docs/MCP_SETUP.md) para validar contratos
de `sendButtons` — este script audita o repositório local.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

ROOT = Path(__file__).resolve().parents[1]

# ─── Estágios motor (B + C WA com botões) ───────────────────────────────────
STAGE_BUTTONS_EXPECTED: Dict[str, List[str]] = {
    "COLD_1": ["bill_low", "bill_mid", "bill_high"],
    "COLD_2": ["bill_low", "bill_mid", "bill_high"],
    "COLD_3": ["bill_low", "bill_mid", "bill_high"],
    "COLD_4": ["analyze", "call_me", "stop"],
    "RECALL_60D": ["bill_low", "bill_mid", "bill_high"],
    "RECALL_90D": ["bill_low", "bill_mid", "bill_high"],
    "RECALL_5M": ["bill_low", "bill_mid", "bill_high"],
    "RECALL_8M": ["bill_low", "bill_mid", "bill_high"],
    "RECALL_12M": ["bill_low", "bill_mid", "bill_high"],
    "RECALL_YEARLY": ["bill_low", "bill_mid", "bill_high"],
}

# Botões que o router DEVE tratar (sem vácuo)
BUTTON_SPREADS: Dict[str, List[str]] = {
    "BILL_RANGE_BUTTONS": ["bill_low", "bill_mid", "bill_high"],
    "ANALYZE_OR_CALL_BUTTONS": ["analyze", "call_me", "send_photo"],
    "NEXT_ACTION_BUTTONS": ["send_photo", "call_me", "stop"],
    "AFTER_EXPLAIN_BUTTONS": ["more_benefits", "activate", "human"],
    "AFTER_CLUB_BUTTONS": ["register", "human"],
    "ACTIVATE_BENEFIT_BUTTONS": ["activate", "human", "how_it_works"],
}

ROUTER_REQUIRED_BUTTONS: Set[str] = {
    "bill_low", "bill_mid", "bill_high",
    "analyze", "send_photo", "register", "activate", "bill_value",
    "explain", "economy", "club", "referral", "more_benefits", "how_it_works",
    "call_me", "human", "stop",
}

# Destinos canônicos Grupo A
GRUPO_A_ENTRY_STEP = "aguardando_conta"
GRUPO_A_VARIANT = "A"


@dataclass
class TemplateRow:
    key: str
    group: str
    channel: str
    title: str
    button_ids: List[str] = field(default_factory=list)


@dataclass
class AuditIssue:
    severity: str  # error | warn | info
    area: str
    message: str


@dataclass
class AuditReport:
    version: int = 1
    templates: List[TemplateRow] = field(default_factory=list)
    issues: List[AuditIssue] = field(default_factory=list)
    summary: Dict[str, int] = field(default_factory=dict)

    def add(self, severity: str, area: str, message: str) -> None:
        self.issues.append(AuditIssue(severity, area, message))


def read_text(rel: str) -> str:
    p = ROOT / rel
    if not p.exists():
        return ""
    return p.read_text(encoding="utf-8", errors="replace")


def parse_multichannel_templates(src: str) -> List[TemplateRow]:
    """Extrai templates do catálogo TS (heurística por blocos `key:`)."""
    rows: List[TemplateRow] = []
    blocks = re.split(r"\n\s*\{", src)
    for block in blocks:
        km = re.search(r'key:\s*"([^"]+)"', block)
        gm = re.search(r'group:\s*"([ABC])"', block)
        cm = re.search(r'channel:\s*"([^"]+)"', block)
        tm = re.search(r'title:\s*"([^"]+)"', block)
        if not km or not gm:
            continue
        btn_ids = re.findall(r'id:\s*"([^"]+)"', block)
        # Preferir botões declarados em `buttons: [...]`
        bm = re.search(r"buttons:\s*\[([\s\S]*?)\]", block)
        if bm:
            spread = bm.group(1).strip()
            if spread.startswith("..."):
                const = re.sub(r"^\.\.\.", "", spread).strip()
                btn_ids = list(BUTTON_SPREADS.get(const, []))
            else:
                btn_ids = re.findall(r'id:\s*"([^"]+)"', bm.group(1))
        rows.append(
            TemplateRow(
                key=km.group(1),
                group=gm.group(1),
                channel=cm.group(1) if cm else "",
                title=tm.group(1) if tm else km.group(1),
                button_ids=btn_ids,
            )
        )
    return rows


def parse_stage_sync_map(src: str) -> Tuple[Dict[str, str], Dict[str, str]]:
    b_map: Dict[str, str] = {}
    c_map: Dict[str, str] = {}
    b_block = re.search(r"const GROUP_B_TO_STAGE[^=]*=\s*\{([\s\S]*?)\};", src)
    c_block = re.search(r"const GROUP_C_TO_STAGE[^=]*=\s*\{([\s\S]*?)\};", src)
    if b_block:
        for m in re.finditer(r"(\w[\w\d_]*):\s*\"([^\"]+)\"", b_block.group(1)):
            b_map[m.group(1)] = m.group(2)
    if c_block:
        for m in re.finditer(r"(\w[\w\d_]*):\s*\"([^\"]+)\"", c_block.group(1)):
            c_map[m.group(1)] = m.group(2)
    return b_map, c_map


def parse_router_buttons(src: str) -> Set[str]:
    found: Set[str] = set()
    for pat in (
        r'CADASTRO_BUTTON_IDS\s*=\s*new Set\(\[([\s\S]*?)\]\)',
        r'EDUCATIONAL_BUTTON_IDS\s*=\s*new Set\(\[([\s\S]*?)\]\)',
        r'HUMAN_BUTTON_IDS\s*=\s*new Set\(\[([\s\S]*?)\]\)',
        r'STOP_BUTTON_IDS\s*=\s*new Set\(\[([\s\S]*?)\]\)',
        r'BILL_BUTTON_VALUES[^=]*=\s*\{([^}]+)\}',
    ):
        m = re.search(pat, src)
        if not m:
            continue
        found.update(re.findall(r'"([^"]+)"', m.group(1)))
    return found


def parse_stage_buttons_file(src: str) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = {}
    m = re.search(r"STAGE_BUTTONS[^=]*=\s*\{([\s\S]*?)\n\};", src)
    if not m:
        return out
    block = m.group(1)
    for stage_m in re.finditer(r"(\w+):\s*(?:BILL_RANGE_BUTTONS|\[)", block):
        stage = stage_m.group(1)
        # pegar bloco até próxima chave de estágio
        start = stage_m.start()
        next_key = re.search(r"\n\s+\w+:", block[start + 1 :])
        chunk = block[start : start + 1 + (next_key.start() if next_key else len(block))]
        if "BILL_RANGE_BUTTONS" in chunk:
            out[stage] = ["bill_low", "bill_mid", "bill_high"]
        else:
            out[stage] = re.findall(r'id:\s*"([^"]+)"', chunk)
    return out


def audit() -> AuditReport:
    report = AuditReport()

    catalog_src = read_text("src/lib/multichannelCadenceTexts.ts")
    sync_src = read_text("src/lib/syncCadenceToBotFlow.ts")
    stage_btn_src = read_text("supabase/functions/_shared/cadence-stage-buttons.ts")
    router_src = read_text("supabase/functions/_shared/cadence-inbound-router.ts")
    tick_src = read_text("supabase/functions/cadence-tick/index.ts")
    whapi_src = read_text("supabase/functions/whapi-webhook/index.ts")
    evo_src = read_text("supabase/functions/evolution-webhook/index.ts")
    flow_router_src = read_text("supabase/functions/_shared/flow-router.ts")

    templates = parse_multichannel_templates(catalog_src)
    report.templates = templates

    by_group: Dict[str, List[TemplateRow]] = {"A": [], "B": [], "C": []}
    for t in templates:
        by_group.setdefault(t.group, []).append(t)

    b_sync, c_sync = parse_stage_sync_map(sync_src)
    stage_buttons = parse_stage_buttons_file(stage_btn_src)
    router_buttons = parse_router_buttons(router_src)

    # ── Grupo A: templates espelhados em bot_flow ──
    grupo_a_keys = [t.key for t in by_group["A"] if not t.key.startswith("_")]
    if "syncCadenceLibraryToBotFlow" not in sync_src:
        report.add("warn", "grupo_a", "syncCadenceLibraryToBotFlow não encontrado em syncCadenceToBotFlow.ts")
    if GRUPO_A_ENTRY_STEP not in flow_router_src:
        report.add("error", "grupo_a", f"{GRUPO_A_ENTRY_STEP} ausente de CADASTRO_STEPS em flow-router.ts")

    wa_a_with_buttons = [t for t in by_group["A"] if "whatsapp" in t.channel and t.button_ids]
    report.add("info", "grupo_a", f"{len(by_group['A'])} templates Grupo A ({len(wa_a_with_buttons)} com botões WA)")

    # ── Grupo B: estágios + botões ──
    b_wa_buttons = [t for t in by_group["B"] if "whatsapp_buttons" in t.channel]
    for t in b_wa_buttons:
        stage = b_sync.get(t.key)
        if not stage:
            report.add("warn", "grupo_b", f"Template {t.key} com botões mas sem mapeamento GROUP_B_TO_STAGE")
            continue
        expected_ids = t.button_ids
        runtime_ids = stage_buttons.get(stage, [])
        if expected_ids and runtime_ids != expected_ids:
            report.add(
                "error",
                "grupo_b",
                f"Estágio {stage} ({t.key}): botões runtime {runtime_ids} ≠ catálogo {expected_ids}",
            )
        if stage not in tick_src and "buttonsForStage" not in tick_src:
            report.add("error", "grupo_b", "cadence-tick não referencia buttonsForStage")

    for stage, ids in STAGE_BUTTONS_EXPECTED.items():
        if stage.startswith("RECALL"):
            continue  # Grupo C abaixo
        if stage not in stage_buttons:
            report.add("error", "grupo_b", f"Estágio {stage} sem botões em cadence-stage-buttons.ts")

    # ── Grupo C: recalls com faixas ──
    c_wa_buttons = [t for t in by_group["C"] if "whatsapp_buttons" in t.channel]
    for t in c_wa_buttons:
        stage = c_sync.get(t.key)
        if not stage:
            report.add("warn", "grupo_c", f"Recall {t.key} sem GROUP_C_TO_STAGE")
            continue
        runtime_ids = stage_buttons.get(stage, [])
        if t.button_ids and runtime_ids != t.button_ids:
            report.add(
                "error",
                "grupo_c",
                f"Recall {stage}: runtime {runtime_ids} ≠ catálogo {t.button_ids}",
            )

    for stage in [s for s in STAGE_BUTTONS_EXPECTED if s.startswith("RECALL")]:
        if stage not in stage_buttons:
            report.add("error", "grupo_c", f"Recall {stage} sem botões no motor")

    # ── Router inbound: cobertura de botões ──
    missing_router = ROUTER_REQUIRED_BUTTONS - router_buttons
  # bill_* também vêm de BILL_BUTTON_VALUES
    for bid in ("bill_low", "bill_mid", "bill_high"):
        if bid not in router_buttons and "BILL_BUTTON_VALUES" not in router_src:
            missing_router.add(bid)
        else:
            missing_router.discard(bid)

    if missing_router:
        report.add("error", "router", f"Botões sem handler no router: {sorted(missing_router)}")

    if f'conversation_step: "{GRUPO_A_ENTRY_STEP}"' not in router_src and GRUPO_A_ENTRY_STEP not in router_src:
        report.add("error", "router", f"Router não referencia entrada {GRUPO_A_ENTRY_STEP}")
    if f'flow_variant: "{GRUPO_A_VARIANT}"' not in router_src:
        report.add("error", "router", "Router não força flow_variant A")

    if "cadence_default_nudge" not in router_src:
        report.add("warn", "router", "Fallback anti-vácuo (cadence_default_nudge) não encontrado")

  # Valor digitado Grupo C
    if "cadence_typed_bill" not in router_src:
        report.add("error", "router", "Grupo C: valor digitado não mapeado (cadence_typed_bill)")

    # ── Webhooks integrados ──
    for name, src in (("whapi-webhook", whapi_src), ("evolution-webhook", evo_src)):
        if "applyCadenceInboundRoute" not in src:
            report.add("error", "webhook", f"{name} não chama applyCadenceInboundRoute")
        if "cadence-inbound-router" not in src:
            report.add("error", "webhook", f"{name} não importa cadence-inbound-router")

    # ── cadence-tick sendButtons ──
    if "sendButtons" not in tick_src:
        report.add("error", "cadence-tick", "dispatchWhatsApp não usa sendButtons")
    if "stageHasButtons" not in tick_src:
        report.add("error", "cadence-tick", "stageHasButtons não usado no tick")

    # ── Matriz resumo A→B→C ──
    report.add("info", "fluxo", "Grupo A = bot_flow_steps variant A (cadastro Sofia)")
    report.add("info", "fluxo", "Grupo B = onda COLD_* → router → aguardando_conta")
    report.add("info", "fluxo", "Grupo C = recalls RECALL_* → router → aguardando_conta")

    errors = sum(1 for i in report.issues if i.severity == "error")
    warns = sum(1 for i in report.issues if i.severity == "warn")
    report.summary = {
        "templates_total": len(templates),
        "grupo_a": len(by_group["A"]),
        "grupo_b": len(by_group["B"]),
        "grupo_c": len(by_group["C"]),
        "b_stages_mapped": len(b_sync),
        "c_stages_mapped": len(c_sync),
        "router_buttons": len(router_buttons),
        "errors": errors,
        "warnings": warns,
        "ok": errors == 0,
    }
    return report


def to_markdown(report: AuditReport) -> str:
    lines = [
        "# Auditoria Cadência — Grupos A / B / C",
        "",
        f"**Status:** {'✅ OK' if report.summary.get('ok') else '❌ COM ERROS'}",
        "",
        "## Resumo",
        "",
        f"| Métrica | Valor |",
        f"| --- | --- |",
    ]
    for k, v in report.summary.items():
        lines.append(f"| {k} | {v} |")

    lines.extend(["", "## Fluxo canônico", ""])
    lines.append("```")
    lines.append("Grupo B/C outbound (cadence-tick + botões)")
    lines.append("  → lead responde")
    lines.append("  → onLeadInboundResponse (pausa cadência)")
    lines.append("  → cadence-inbound-router")
    lines.append("  → flow_variant=A + aguardando_conta (+ valor)")
    lines.append("  → Grupo A: foto → doc → email → OTP → portal")
    lines.append("```")

    if report.issues:
        lines.extend(["", "## Issues", ""])
        for iss in report.issues:
            icon = {"error": "❌", "warn": "⚠️", "info": "ℹ️"}.get(iss.severity, "•")
            lines.append(f"- {icon} **[{iss.area}]** {iss.message}")

    lines.extend(["", "## Templates com botões (B + C)", ""])
    for t in report.templates:
        if t.group in ("B", "C") and t.button_ids:
            lines.append(f"- `{t.key}` ({t.group}) → `{', '.join(t.button_ids)}`")

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Auditoria Grupos A/B/C cadência multicanal")
    parser.add_argument("--markdown", action="store_true", help="Saída em Markdown")
    parser.add_argument("--json", action="store_true", help="Saída JSON (default)")
    args = parser.parse_args()

    report = audit()
    payload = {
        "version": report.version,
        "summary": report.summary,
        "issues": [asdict(i) for i in report.issues],
        "templates_with_buttons": [
            asdict(t) for t in report.templates if t.button_ids
        ],
    }

    if args.markdown:
        sys.stdout.write(to_markdown(report))
    else:
        json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")

    return 0 if report.summary.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
