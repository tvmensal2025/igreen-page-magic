#!/usr/bin/env python3
"""Valida migration onda3 contra inventário real de cron.job (IGREEN).

Uso:
  python3 docs/auditoria-completa/scripts/validate_onda3_cron.py

Não aplica migrate. Só checa se cron.schedule usa nomes ⊆ inventário prod.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MIG = ROOT / "supabase/migrations/20260716120000_onda3_cron_auth_headers.sql"

# Inventário prod 2026-07-16 (SQL cron.job) — jobs de envio/hardening
PROD_JOBS = {
    "bulk-scheduler-5min",
    "bot-followup-checker-daily",
    "faq-reengagement-nudge-hourly",
    "reactivation-cron-15min",
    "reactivation-cron-hourly",
    "cadence-tick-5min",
    "cadence-tick-every-5min",
    "send-scheduled-messages-2min",
    "rodizio-metrics-10m",
    "outbound-media-flush-3min",
    "bot-watchdogs-2h",
    "portal-otp-watchdog-1m",
    "bot-loop-watchdog-2h",
    "super-admin-alerts-hourly",
    "process-followups-tick",
    "process-followups-10min",
}

# Duplicatas que a migration aposenta (unschedule sem recrear)
MUST_NOT_RESCHEDULE = {
    "cadence-tick-every-5min",
    "process-followups-10min",
}


def main() -> int:
    if not MIG.exists():
        print(f"FAIL: migration ausente: {MIG}", file=sys.stderr)
        return 1
    text = MIG.read_text()
    scheduled = set(re.findall(r"cron\.schedule\(\s*'([^']+)'", text))
    unsched = set(re.findall(r"cron\.unschedule\('([^']+)'\)", text))

    bad_new = sorted(scheduled - PROD_JOBS)
    if bad_new:
        print("FAIL: schedule com nomes fora do inventário prod:", bad_new)
        return 1

    resurrected = sorted(scheduled & MUST_NOT_RESCHEDULE)
    if resurrected:
        print("FAIL: duplicatas aposentadas foram recriadas:", resurrected)
        return 1

    for name in MUST_NOT_RESCHEDULE:
        if name not in unsched:
            print(f"FAIL: duplicata {name} não está no unschedule")
            return 1

    if "x-internal-secret" not in text:
        print("FAIL: falta x-internal-secret nos headers")
        return 1

    print("OK: onda3 alinhada ao inventário prod")
    print(f"  schedule={len(scheduled)} unschedule={len(unsched)}")
    print(f"  jobs: {sorted(scheduled)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
