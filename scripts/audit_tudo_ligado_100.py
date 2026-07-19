#!/usr/bin/env python3
"""Auditoria rápida ON vs envio — REST se tiver SERVICE_ROLE."""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
env_path = ROOT / ".env.mcp.local"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

URL = (os.environ.get("SUPABASE_URL") or "https://zlzasfhcxcznaprrragl.supabase.co").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SERVICE_ROLE_KEY")


def rest(path: str, params: str = "") -> list:
    if not KEY:
        raise RuntimeError("sem SERVICE_ROLE_KEY")
    req = urllib.request.Request(
        f"{URL}/rest/v1/{path}?{params}",
        headers={
            "apikey": KEY,
            "Authorization": f"Bearer {KEY}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def main() -> int:
    report: dict = {"ok": True, "blockers": [], "notes": []}
    if not KEY:
        report["notes"].append(
            "Sem SERVICE_ROLE_KEY — validar via MCP: "
            "SELECT enabled, live_dispatch_enabled FROM daily_reheat_settings;"
        )
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    settings = rest(
        "daily_reheat_settings",
        "id=eq.global&select=enabled,live_dispatch_enabled,daily_whapi_cap",
    )
    row = settings[0] if settings else {}
    report["daily_reheat_settings"] = row
    if not row.get("enabled"):
        report["blockers"].append("enabled=false")
        report["ok"] = False
    if not row.get("live_dispatch_enabled"):
        report["blockers"].append("live_dispatch_enabled=false")
        report["ok"] = False

    global_row = rest(
        "app_settings",
        "id=eq.global&select=bot_global_enabled,cadence_engine_enabled",
    )
    report["app_settings"] = global_row[0] if global_row else {}
    offs = rest("automation_toggles", "enabled=eq.false&select=key")
    report["toggles_off"] = [r["key"] for r in (offs or [])]
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 2


if __name__ == "__main__":
    sys.exit(main())
