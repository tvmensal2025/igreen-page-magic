#!/usr/bin/env python3
"""Reaplica Grok 4.5 (first-party Cursor) como padrão do Agent + subagentes.

Uso:
  python3 scripts/cursor-restore-grok-firstparty.py
  # depois: Ctrl+Shift+P → Developer: Reload Window
"""

from __future__ import annotations

import json
import sqlite3
import sys

DB = "/home/dev/.config/Cursor/User/globalStorage/state.vscdb"
APP_KEY = (
    "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl"
    ".persistentStorage.applicationUser"
)
SUB_KEY = "cursor/subagentModelOverrides"
MODEL = "grok-4.5"
DROP = {
    "grok-4.5-xai",
    "xai-grok-4.5",
    "Sol 5.6 (sem BYOK)",
    "gpt-5.6-sol-medium",
}
SUB_TYPES = [
    "explore",
    "shell",
    "generalPurpose",
    "ci-investigator",
    "cursor-guide",
    "best-of-n-runner",
    "docs-researcher",
]


def main() -> None:
    con = sqlite3.connect(DB, timeout=60)
    cur = con.cursor()
    cur.execute("PRAGMA busy_timeout=60000")
    cur.execute("SELECT value FROM ItemTable WHERE key=?", (APP_KEY,))
    row = cur.fetchone()
    if not row:
        print("ERRO: banco do Cursor sem applicationUser", file=sys.stderr)
        sys.exit(1)

    obj = json.loads(row[0] if isinstance(row[0], str) else row[0].decode())
    obj["useOpenAIKey"] = False
    obj["openAIBaseUrl"] = ""
    obj["azureState"] = {
        "useAzure": False,
        "baseUrl": "",
        "deployment": "",
        "apiKey": "",
    }

    ai = obj.setdefault("aiSettings", {})
    models = obj.get("availableDefaultModels2") or []
    obj["availableDefaultModels2"] = [
        m
        for m in models
        if not (m.get("isUserAdded") and m.get("name") in DROP)
    ]
    ai["userAddedModels"] = [
        m for m in (ai.get("userAddedModels") or []) if m not in DROP
    ]
    if obj.get("availableAPIKeyModels"):
        obj["availableAPIKeyModels"] = [
            m for m in obj["availableAPIKeyModels"] if m not in DROP
        ]

    enabled = [
        m
        for m in (ai.get("modelOverrideEnabled") or [])
        if m not in DROP and "sol" not in str(m).lower()
    ]
    for must in [MODEL, "composer-2.5", "default"]:
        if must not in enabled:
            enabled.append(must)
    ai["modelOverrideEnabled"] = enabled
    ai["modelOverrideDisabled"] = [
        m for m in (ai.get("modelOverrideDisabled") or []) if m != MODEL
    ]

    sel = [{"modelId": MODEL, "parameters": []}]
    prefs = (ai.get("modelParameterPreferences") or {}).get(MODEL)
    if prefs and prefs.get("parameters"):
        sel = [{"modelId": MODEL, "parameters": prefs["parameters"]}]

    mc = ai.setdefault("modelConfig", {})
    for mode in [
        "cmd-k",
        "composer",
        "background-composer",
        "composer-ensemble",
        "plan-execution",
        "spec",
        "deep-search",
        "quick-agent",
    ]:
        prev = mc.get(mode) or {}
        mc[mode] = {
            "modelName": MODEL,
            "maxMode": mode in ("composer", "background-composer")
            or bool(prev.get("maxMode", False)),
            "selectedModels": sel,
        }

    fmc = obj.setdefault("featureModelConfigs", {})
    for feature in [
        "composer",
        "cmdK",
        "backgroundComposer",
        "planExecution",
        "spec",
        "deepSearch",
        "quickAgent",
    ]:
        cfg = fmc.setdefault(feature, {})
        cfg["defaultModel"] = MODEL

    for name, cfg in list(fmc.setdefault("subagentModels", {}).items()):
        if isinstance(cfg, dict):
            cfg["defaultModel"] = MODEL
            cfg["fallbackModels"] = []
            cfg["bestOfNDefaultModels"] = []

    cur.execute(
        "UPDATE ItemTable SET value=? WHERE key=?",
        (json.dumps(obj, separators=(",", ":")), APP_KEY),
    )

    new_sub = {
        t: {
            "mode": "model",
            "modelConfig": {
                "modelName": MODEL,
                "maxMode": False,
                "selectedModels": [{"modelId": MODEL, "parameters": []}],
            },
        }
        for t in SUB_TYPES
    }
    cur.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)",
        (SUB_KEY, json.dumps(new_sub, separators=(",", ":"))),
    )

    # patch chats recentes do header
    ids: list[str] = []
    cur.execute("SELECT value FROM ItemTable WHERE key=?", ("composer.composerHeaders",))
    hdr = cur.fetchone()
    if hdr:
        try:
            h = json.loads(hdr[0] if isinstance(hdr[0], str) else hdr[0].decode())
            for c in (h.get("allComposers") or [])[:20]:
                cid = c.get("composerId")
                if cid:
                    ids.append(cid)
        except Exception:
            pass

    patched = 0
    for cid in dict.fromkeys(ids):
        key = f"composerData:{cid}"
        cur.execute("SELECT value FROM cursorDiskKV WHERE key=?", (key,))
        row = cur.fetchone()
        if not row:
            continue
        raw = (
            row[0].decode("utf-8", "replace")
            if isinstance(row[0], (bytes, bytearray))
            else row[0]
        )
        try:
            data = json.loads(raw)
        except Exception:
            continue
        prev = data.get("modelConfig") or {}
        data["modelConfig"] = {
            "modelName": MODEL,
            "maxMode": bool(prev.get("maxMode", True)),
            "selectedModels": [{"modelId": MODEL, "parameters": []}],
        }
        cur.execute(
            "UPDATE cursorDiskKV SET value=? WHERE key=?",
            (json.dumps(data, separators=(",", ":")), key),
        )
        patched += 1

    con.commit()
    con.close()
    print("OK: Agent + subagentes ->", MODEL)
    print("  chats patch:", patched)
    print("  Agora: Ctrl+Shift+P → Developer: Reload Window")
    print("  No seletor do chat escolha Cursor Grok 4.5 se ainda mostrar Auto")


if __name__ == "__main__":
    main()
