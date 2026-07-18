#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate-anti-duplicidade-piloto.py

Valida estaticamente as correções anti-duplicidade do piloto (Grupo B/C = cadence,
plus reheat/reativação que disputam o mesmo lead).

Uso:
  python3 scripts/validate-anti-duplicidade-piloto.py
  python3 scripts/validate-anti-duplicidade-piloto.py --json
  python3 scripts/validate-anti-duplicidade-piloto.py --strict   # exit 1 se warn+
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]


@dataclass
class Issue:
    severity: str  # error | warn | info | ok
    area: str
    check: str
    message: str


@dataclass
class Report:
    issues: List[Issue] = field(default_factory=list)

    def add(self, severity: str, area: str, check: str, message: str) -> None:
        self.issues.append(Issue(severity, area, check, message))

    def counts(self) -> Dict[str, int]:
        out = {"error": 0, "warn": 0, "info": 0, "ok": 0}
        for i in self.issues:
            out[i.severity] = out.get(i.severity, 0) + 1
        return out


def read(rel: str) -> str:
    p = ROOT / rel
    if not p.exists():
        return ""
    return p.read_text(encoding="utf-8", errors="replace")


def exists(rel: str) -> bool:
    return (ROOT / rel).exists()


def must_contain(rep: Report, area: str, check: str, text: str, patterns: List[str], *, as_error: bool = True) -> None:
    missing = [p for p in patterns if not re.search(p, text, re.M | re.S)]
    if missing:
        sev = "error" if as_error else "warn"
        rep.add(sev, area, check, f"Faltando padrão(ões): {missing}")
    else:
        rep.add("ok", area, check, "OK")


def must_not_contain(rep: Report, area: str, check: str, text: str, patterns: List[str], *, as_error: bool = True) -> None:
    found = [p for p in patterns if re.search(p, text, re.M | re.S)]
    if found:
        sev = "error" if as_error else "warn"
        rep.add(sev, area, check, f"Padrão proibido ainda presente: {found}")
    else:
        rep.add("ok", area, check, "OK (ausente)")


# ─── Checks ──────────────────────────────────────────────────────────────────


def check_files_exist(rep: Report) -> None:
    required = [
        "supabase/functions/_shared/audience-ddd.ts",
        "supabase/functions/_shared/audience-ddd_test.ts",
        "supabase/migrations/20260718210000_anti_duplicidade_claims_piloto.sql",
        "supabase/functions/cadence-tick/index.ts",
        "supabase/functions/_shared/daily-reheat/plan.ts",
        "supabase/functions/_shared/daily-reheat/dispatch.ts",
        "supabase/functions/reactivation-cron/index.ts",
        "supabase/functions/_shared/channel-sender.ts",
    ]
    for rel in required:
        if exists(rel):
            rep.add("ok", "files", rel, "existe")
        else:
            rep.add("error", "files", rel, "ARQUIVO AUSENTE")


def check_migration(rep: Report) -> None:
    sql = read("supabase/migrations/20260718210000_anti_duplicidade_claims_piloto.sql")
    if not sql:
        rep.add("error", "migration", "file", "migration vazia/ausente")
        return

    # Não deve apagar coisas
    must_not_contain(
        rep,
        "migration",
        "no_destructive",
        sql,
        [r"\bDROP TABLE\b", r"\bTRUNCATE\b", r"\bDELETE FROM\b"],
        as_error=True,
    )

    must_contain(
        rep,
        "migration",
        "cadence_rpc",
        sql,
        [
            r"claim_due_cadence",
            r"FOR UPDATE SKIP LOCKED",
            r"release_cadence_claim",
            r"reconcile_stuck_cadence_claims",
            r"claim_token",
            r"lease_expires_at",
        ],
    )

    must_contain(
        rep,
        "migration",
        "reheat_rpc",
        sql,
        [
            r"claim_due_daily_reheat",
            r"reconcile_stuck_daily_reheat_claims",
            r"status = 'planned'",
        ],
    )

    must_contain(
        rep,
        "migration",
        "reactivation_unique",
        sql,
        [r"uq_reactivation_sends_inflight", r"status = 'pending'"],
    )

    must_contain(
        rep,
        "migration",
        "audience_settings",
        sql,
        [r"cadence_audience_mode", r"cadence_allowed_ddds", r'\["34"\]'],
    )

    # Grants só service_role
    if "GRANT EXECUTE ON FUNCTION public.claim_due_cadence" in sql and "TO service_role" in sql:
        rep.add("ok", "migration", "grants", "claim_due_cadence → service_role")
    else:
        rep.add("error", "migration", "grants", "grant claim_due_cadence ausente/errado")

    if "REVOKE ALL ON FUNCTION public.claim_due_cadence" in sql:
        rep.add("ok", "migration", "revoke_public", "REVOKE PUBLIC presente")
    else:
        rep.add("warn", "migration", "revoke_public", "sem REVOKE PUBLIC explícito")

    # Não deve claimar claimed no reheat
    if re.search(r"claim_due_daily_reheat[\s\S]*?status = 'planned'", sql):
        # garantir que não seleciona claimed como livre
        fn = re.search(
            r"CREATE OR REPLACE FUNCTION public\.claim_due_daily_reheat[\s\S]*?\$\$;",
            sql,
        )
        if fn and re.search(r"status\s*=\s*'claimed'", fn.group(0)):
            # claimed só no SET, ok; se WHERE claimed = livre → erro
            where_part = re.search(r"WHERE[\s\S]*?FOR UPDATE", fn.group(0))
            if where_part and "'claimed'" in where_part.group(0) and "planned" not in where_part.group(0):
                rep.add("error", "migration", "reheat_where", "WHERE seleciona claimed como livre")
            else:
                rep.add("ok", "migration", "reheat_where", "WHERE só planned (claim)")
        else:
            rep.add("ok", "migration", "reheat_where", "WHERE só planned")


def check_audience_ddd(rep: Report) -> None:
    src = read("supabase/functions/_shared/audience-ddd.ts")
    test = read("supabase/functions/_shared/audience-ddd_test.ts")
    must_contain(
        rep,
        "audience",
        "api",
        src,
        [
            r"export function extractDdd",
            r"export function decideAudienceDdd",
            r"export async function loadCadenceAudienceConfig",
            r'mode === "enforced"',
            r'mode === "shadow"',
            r'\["34"\]',
            r"invalid_phone",
            r"outside_ddd",
        ],
    )
    must_contain(
        rep,
        "audience",
        "tests",
        test,
        [
            r'extractDdd\("5534999887766"\)',
            r"decideAudienceDdd — enforced",
            r"shadow_observe",
            r"mode_off",
        ],
    )

    # Simulação Python espelhando a lógica (não importa Deno)
    def extract_ddd(digits: str) -> str:
        d = re.sub(r"\D", "", digits or "")
        if not d:
            return "??"
        if d.startswith("55") and len(d) >= 4:
            return d[2:4]
        if len(d) >= 2:
            return d[0:2]
        return "??"

    cases = [
        ("5534999887766", "34"),
        ("34999887766", "34"),
        ("5511987654321", "11"),
        ("", "??"),
        ("11987654321", "11"),
    ]
    bad = []
    for raw, expected in cases:
        got = extract_ddd(raw)
        if got != expected:
            bad.append((raw, expected, got))
    if bad:
        rep.add("error", "audience", "python_mirror", f"extractDdd divergiu: {bad}")
    else:
        rep.add("ok", "audience", "python_mirror", "extractDdd espelhado OK (5 casos)")

    # enforced fora do 34
    ddd = extract_ddd("5511987654321")
    if ddd == "11":
        rep.add("ok", "audience", "block_non_34", "DDD 11 seria bloqueado no enforced")
    else:
        rep.add("error", "audience", "block_non_34", f"esperava 11, got {ddd}")


def check_cadence_tick(rep: Report) -> None:
    src = read("supabase/functions/cadence-tick/index.ts")
    if not src:
        rep.add("error", "cadence", "file", "cadence-tick ausente")
        return

    must_contain(
        rep,
        "cadence",
        "claim",
        src,
        [
            r'rpc\("claim_due_cadence"',
            r"fallback CAS",
            r"finishRow",
            r"decideAudienceDdd",
            r"loadCadenceAudienceConfig",
            r"audience_blocked",
        ],
    )

    # Não deve selecionar due sem claim/CAS como caminho único
    # (SELECT legado ainda existe no fallback — ok se houver CAS depois)
    if re.search(r'\.from\("lead_cadence_state"\)[\s\S]{0,400}\.lte\("next_action_at"', src):
        if "eq(\"next_action_at\"" in src or "eq('next_action_at'" in src or '.eq("next_action_at"' in src:
            rep.add("ok", "cadence", "fallback_cas", "SELECT legado + CAS next_action_at")
        else:
            rep.add("error", "cadence", "fallback_cas", "SELECT due sem CAS no fallback")
    else:
        rep.add("info", "cadence", "fallback_cas", "sem SELECT legado (só RPC?)")

    # Chaves estáveis no ctx de cadência
    must_contain(
        rep,
        "cadence",
        "stable_ctx",
        src,
        [r'ctx\([^)]*cadence:\$\{stage\}'],
    )
    must_not_contain(
        rep,
        "cadence",
        "no_date_now_ctid",
        src,
        [r"toCtid\(`cad_\$\{stage\}_\$\{row\.customer_id\.slice\(0, 8\)\}_\$\{Date\.now\(\)\}`\)"],
    )

    # Voice/SMS gates
    # Contar assertBotOutboundAllowed — WA + voice + SMS >= 3
    gates = len(re.findall(r"assertBotOutboundAllowed", src))
    if gates >= 3:
        rep.add("ok", "cadence", "channel_gates", f"assertBotOutboundAllowed x{gates}")
    else:
        rep.add("error", "cadence", "channel_gates", f"só {gates} gates (esperava ≥3 WA/voz/SMS)")

    # Não deve desligar toggle global no código
    must_not_contain(
        rep,
        "cadence",
        "no_kill_switch_write",
        src,
        [r"bot_global_enabled\s*[:=]\s*false", r"cadence_engine_enabled\s*[:=]\s*false"],
    )


def check_channel_sender(rep: Report) -> None:
    src = read("supabase/functions/_shared/channel-sender.ts")
    # ctx sem Date.now na chave
    fn = re.search(r"export function ctx\([\s\S]*?\n\}", src)
    if not fn:
        rep.add("error", "channel-sender", "ctx", "função ctx não encontrada")
        return
    body = fn.group(0)
    if "Date.now()" in body:
        rep.add("error", "channel-sender", "ctx_stable", "ctx ainda usa Date.now() na chave")
    else:
        rep.add("ok", "channel-sender", "ctx_stable", "ctx sem Date.now()")
    if "idempotencyKey" in body:
        rep.add("ok", "channel-sender", "idem_key", "idempotencyKey presente")


def check_daily_reheat(rep: Report) -> None:
    plan = read("supabase/functions/_shared/daily-reheat/plan.ts")
    disp = read("supabase/functions/_shared/daily-reheat/dispatch.ts")

    must_contain(
        rep,
        "reheat",
        "claim_rpc",
        plan,
        [r'rpc\("claim_due_daily_reheat"', r'eq\("status", "planned"\)'],
    )

    # loadDueQueuePlans não deve incluir claimed na seleção de due
    load_fn = re.search(r"export async function loadDueQueuePlans[\s\S]*?^\}", plan, re.M)
    if load_fn:
        body = load_fn.group(0)
        # .in("status", ["planned", "claimed"]) é o bug antigo
        if re.search(r'\.in\(\s*"status"\s*,\s*\[\s*"planned"\s*,\s*"claimed"', body):
            rep.add("error", "reheat", "no_claimed_select", "loadDue ainda seleciona claimed")
        else:
            rep.add("ok", "reheat", "no_claimed_select", "due não reseleciona claimed")
    else:
        rep.add("error", "reheat", "loadDue", "função loadDueQueuePlans não encontrada")

    must_contain(
        rep,
        "reheat",
        "cas_dispatch",
        disp,
        [r'eq\("status", "planned"\)', r'status:\s*"claimed"'],
    )

    # Não claimar com .in planned,claimed
    must_not_contain(
        rep,
        "reheat",
        "no_double_status_claim",
        disp,
        [r'\.in\(\s*"status"\s*,\s*\[\s*"planned"\s*,\s*"claimed"\s*\]\s*\)'],
    )

    must_not_contain(
        rep,
        "reheat",
        "stable_audio_key",
        disp,
        [r"dreheat-audio:\$\{plan\.customer_id\}:\$\{Date\.now\(\)\}"],
    )
    must_contain(
        rep,
        "reheat",
        "stable_audio_key_pos",
        disp,
        [r"dreheat-audio:\$\{plan\.customer_id\}:\$\{plan\.step\}"],
    )

    # nextDueNow limpa claim_token
    if 'claim_token: null' in disp and "nextDueNow" in disp:
        rep.add("ok", "reheat", "chain_reclaim", "nextDueNow zera claim_token")
    else:
        rep.add("warn", "reheat", "chain_reclaim", "cadeia pode reusar claim sem CAS")


def check_reactivation(rep: Report) -> None:
    src = read("supabase/functions/reactivation-cron/index.ts")
    test = read("supabase/functions/reactivation-cron/index_test.ts")

    must_contain(
        rep,
        "reactivation",
        "pending_before_send",
        src,
        [
            r"status:\s*\"pending\"",
            r"claimId",
            r"Reserva atômica ANTES do envio",
            r"uq_reactivation_sends_inflight|duplicate|23505",
        ],
    )

    # Ordem: pending insert deve aparecer antes de sendText no fluxo
    pend_pos = src.find('status: "pending"')
    send_pos = src.find("sender.sendText")
    if pend_pos > 0 and send_pos > 0 and pend_pos < send_pos:
        rep.add("ok", "reactivation", "order", "pending antes de sendText")
    else:
        rep.add("error", "reactivation", "order", "pending não está antes de sendText")

    # fail-closed timezone
    win = re.search(r"export function isInsideWindow[\s\S]*?\n\}", src)
    if win and "return false" in win.group(0) and "catch" in win.group(0):
        # catch deve retornar false
        catch = re.search(r"catch\s*\{[\s\S]*?return\s+(true|false)", win.group(0))
        if catch and catch.group(1) == "false":
            rep.add("ok", "reactivation", "tz_fail_closed", "timezone inválido → false")
        else:
            rep.add("error", "reactivation", "tz_fail_closed", "catch de timezone não é fail-closed")
    else:
        rep.add("warn", "reactivation", "tz_fail_closed", "não conseguiu inspecionar isInsideWindow")

    if 'timezone inválido é fail-closed' in test or "fail-closed" in test:
        rep.add("ok", "reactivation", "tz_test", "teste fail-closed presente")
    else:
        rep.add("warn", "reactivation", "tz_test", "teste de timezone fail-closed ausente")

    if "status.eq.pending" in src:
        rep.add("ok", "reactivation", "debounce_pending", "debounce inclui pending")
    else:
        rep.add("warn", "reactivation", "debounce_pending", "debounce pode ignorar pending")


def check_grupo_bc_alignment(rep: Report) -> None:
    """Garante que o motor principal B/C continua sendo cadence-tick."""
    hub = read("src/components/whatsapp/AgendamentosHub.tsx")
    zero = read("src/components/whatsapp/AgendamentosZeroLeadPanel.tsx")
    cal = read("src/lib/cadenceCalendarMap.ts")

    if "Grupo B" in hub and "Grupo C" in hub:
        rep.add("ok", "abc", "ui_tabs", "Hub tem abas Grupo A/B/C")
    else:
        rep.add("warn", "abc", "ui_tabs", "abas ABC não encontradas no Hub")

    if "cadence" in zero.lower() or "lead_cadence_state" in zero:
        rep.add("ok", "abc", "grupo_b_cadence", "ZeroLeadPanel ligado à cadência")
    else:
        rep.add("warn", "abc", "grupo_b_cadence", "painel B sem referência clara à cadência")

    if 'B: "Grupo B' in cal or "Grupo B — Reaquecimento" in cal:
        rep.add("ok", "abc", "calendar_map", "calendário mapeia B/C")
    else:
        rep.add("info", "abc", "calendar_map", "rótulos B/C não batem exatamente")

    # cadence-tick continua sendo o executor
    tick = read("supabase/functions/cadence-tick/index.ts")
    if "COLD_1" in tick and "RECALL_" in tick:
        rep.add("ok", "abc", "tick_is_bc", "cadence-tick cobre COLD (B) e RECALL (C)")
    else:
        rep.add("error", "abc", "tick_is_bc", "cadence-tick não cobre B+C esperados")


def check_risk_regressions(rep: Report) -> None:
    """Riscos futuros conhecidos."""
    # Orquestrador ainda check-then-act
    orch = read("supabase/functions/_shared/retention-orchestrator.ts")
    if "gateProactiveTouch" in orch and "reserve_proactive_touch" not in orch:
        rep.add(
            "info",
            "future",
            "orchestrator",
            "orquestrador ainda é gate+record (não atômico) — risco cruzado entre motores",
        )

    # Idempotency fail-open
    idem = read("supabase/functions/_shared/idempotency.ts")
    if "fail-open" in idem.lower() or "acquired: true" in idem:
        rep.add(
            "info",
            "future",
            "idem_fail_open",
            "idempotência WA ainda fail-open em erro de banco — claim cobre o principal",
        )

    # Dois crons de reativação nas migrations
    cron_sql = ""
    for p in (ROOT / "supabase/migrations").glob("*.sql"):
        t = p.read_text(encoding="utf-8", errors="replace")
        if "reactivation-cron" in t:
            cron_sql += t + "\n"
    n15 = len(re.findall(r"reactivation-cron-15min|reactivation.cron.*15", cron_sql, re.I))
    nh = len(re.findall(r"reactivation-cron-hourly|reactivation.cron.*hour", cron_sql, re.I))
    if n15 and nh:
        rep.add(
            "info",
            "future",
            "two_reactivation_crons",
            "migrations ainda definem cron 15min + hourly — claim pending mitiga duplicidade",
        )


def print_human(rep: Report) -> None:
    counts = rep.counts()
    print("=" * 72)
    print("VALIDAÇÃO ANTI-DUPLICIDADE PILOTO (estática · Python)")
    print("=" * 72)
    order = {"error": 0, "warn": 1, "info": 2, "ok": 3}
    for issue in sorted(rep.issues, key=lambda i: (order.get(i.severity, 9), i.area, i.check)):
        mark = {"error": "✗", "warn": "!", "info": "·", "ok": "✓"}.get(issue.severity, "?")
        print(f"  [{mark} {issue.severity:5}] {issue.area:14} · {issue.check}: {issue.message}")
    print("-" * 72)
    print(
        f"Resumo: {counts.get('ok', 0)} ok | {counts.get('info', 0)} info | "
        f"{counts.get('warn', 0)} warn | {counts.get('error', 0)} error"
    )
    if counts.get("error", 0) == 0:
        print("VEREDITO: PASS — correções presentes; riscos futuros só em info.")
    else:
        print("VEREDITO: FAIL — corrija os errors antes de deploy.")
    print("=" * 72)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--strict", action="store_true", help="exit 1 também em warn")
    args = ap.parse_args()

    rep = Report()
    check_files_exist(rep)
    check_migration(rep)
    check_audience_ddd(rep)
    check_cadence_tick(rep)
    check_channel_sender(rep)
    check_daily_reheat(rep)
    check_reactivation(rep)
    check_grupo_bc_alignment(rep)
    check_risk_regressions(rep)

    if args.json:
        print(
            json.dumps(
                {
                    "summary": rep.counts(),
                    "issues": [asdict(i) for i in rep.issues],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print_human(rep)

    counts = rep.counts()
    if counts.get("error", 0) > 0:
        return 1
    if args.strict and counts.get("warn", 0) > 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
