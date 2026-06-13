#!/usr/bin/env python3
"""Auditoria estática do sistema de Conversão (Sprint 1 + Sprint 2)."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def ok(msg: str) -> None:
    print(f"  OK  {msg}")


def fail(msg: str) -> None:
    print(f"  FAIL {msg}")
    global _errors
    _errors += 1


_errors = 0


def main() -> int:
    print("=== audit-conversao.py ===\n")

    # 1. Shared modules exist
    for p in [
        "supabase/functions/_shared/conversion/phrase-catalog.ts",
        "supabase/functions/_shared/conversion/rule-classifier.ts",
        "supabase/functions/_shared/conversion/rule-classifier.test.ts",
        "supabase/migrations/20260613120000_conversion_phrase_catalog.sql",
    ]:
        if (ROOT / p).exists():
            ok(p)
        else:
            fail(f"missing {p}")

    # 2. Classifier uses rules-first
    clf = (ROOT / "supabase/functions/lead-temperature-classifier/index.ts").read_text()
    if "classifyByRules" in clf and "next_msg_draft" not in clf.split("TOOL_SCHEMA_LITE")[1][:800]:
        ok("classifier rules-first + AI lite sem draft no tool")
    else:
        fail("classifier ainda gera draft via IA no tool schema")

    if "classification_source" in clf:
        ok("classification_source gravado")
    else:
        fail("classification_source ausente no classifier")

    # 3. Cockpit inbound_count
    cockpit = (ROOT / "src/components/admin/conversao/ConversaoCockpit.tsx").read_text()
    if "count_inbound_messages" in cockpit:
        ok("Cockpit usa RPC count_inbound_messages")
    else:
        fail("Cockpit sem inbound_count")

    if "classifyStale" in cockpit and "stepLabel" in cockpit:
        ok("Cockpit: reclassify 24h + step label")
    else:
        fail("Cockpit incompleto (stale/step)")

    # 4. Dead code removed
    if not (ROOT / "src/components/admin/ConversaoTab.tsx").exists():
        ok("ConversaoTab.tsx removido")
    else:
        fail("ConversaoTab.tsx ainda existe")

    # 5. Phrase catalog shortcuts aligned
    cat = (ROOT / "supabase/functions/_shared/conversion/phrase-catalog.ts").read_text()
    shortcuts = set(re.findall(r'shortcut: "(/[^"]+)"', cat))
    migration = (ROOT / "supabase/migrations/20260613120000_conversion_phrase_catalog.sql").read_text()
    seed_shortcuts = set(re.findall(r"\('(/[^']+)'", migration))
    missing_in_seed = shortcuts - seed_shortcuts
    if not missing_in_seed:
        ok(f"{len(shortcuts)} shortcuts sincronizados TS ↔ migration")
    else:
        fail(f"shortcuts no TS sem seed: {missing_in_seed}")

    # 6. Fix migration: RPC com filtro de tenant + policies idempotentes
    fix = ROOT / "supabase/migrations/20260613130000_conversion_sprint1_fixes.sql"
    if fix.exists():
        fix_txt = fix.read_text()
        if "auth.uid()" in fix_txt and "count_inbound_messages" in fix_txt:
            ok("RPC count_inbound_messages com filtro de tenant")
        else:
            fail("RPC ainda sem filtro de tenant")
        if fix_txt.count("DROP POLICY IF EXISTS") >= 3:
            ok("policies do catálogo idempotentes")
        else:
            fail("policies do catálogo não idempotentes")
    else:
        fail("migration de fix ausente")

    # 7. types.ts tem classification_source
    types = (ROOT / "src/integrations/supabase/types.ts").read_text()
    if "classification_source" in types:
        ok("types.ts com classification_source")
    else:
        fail("types.ts sem classification_source")

    # 8. sent_bill restrito a mídia (sem match por texto "conta"/"fatura")
    rc = (ROOT / "supabase/functions/_shared/conversion/rule-classifier.ts").read_text()
    sent_bill_block = rc.split("const sentBill")[1].split("});")[0] if "const sentBill" in rc else ""
    if 'includes("conta")' not in sent_bill_block and 'includes("fatura")' not in sent_bill_block:
        ok("sent_bill exige mídia (sem falso positivo por texto)")
    else:
        fail("sent_bill ainda casa texto 'conta'/'fatura'")

    # 9. Cockpit trata erro do RPC
    if "count_inbound_messages" in cockpit and "countErr" in cockpit:
        ok("Cockpit trata erro do RPC")
    else:
        fail("Cockpit ainda ignora erro do RPC")

    # ─── Sprint 2 ────────────────────────────────────────────────────────────
    # 10. Migration Sprint 2: RPCs de outcome (tenant-safe) + cron
    s2 = ROOT / "supabase/migrations/20260613140000_conversion_sprint2.sql"
    if s2.exists():
        s2_txt = s2.read_text()
        if "reactivation_outcome_stats" in s2_txt and "auth.uid()" in s2_txt:
            ok("RPC reactivation_outcome_stats com filtro de tenant")
        else:
            fail("RPC de outcome ausente ou sem filtro de tenant")
        if "reactivation_outcome_by_step" in s2_txt:
            ok("RPC reactivation_outcome_by_step")
        else:
            fail("RPC reactivation_outcome_by_step ausente")
        if "conversion-classifier-15min" in s2_txt and "needs_reclassify_global" in s2_txt:
            ok("cron de classificação por regras agendado")
        else:
            fail("cron de classificação ausente")
    else:
        fail("migration Sprint 2 ausente")

    # 11. Classifier: catálogo do DB (overrides) + scope global
    if "resolveDraftWithOverrides" in clf and "loadConsultantOverrides" in clf:
        ok("classifier lê overrides do catálogo (DB) com fallback TS")
    else:
        fail("classifier não lê overrides do catálogo")
    if "needs_reclassify_global" in clf:
        ok("classifier suporta scope needs_reclassify_global")
    else:
        fail("classifier sem scope global")

    # 12. UI: aba Resultados + envio em lote
    if (ROOT / "src/components/admin/conversao/ResultadosPanel.tsx").exists():
        ok("ResultadosPanel.tsx criado")
    else:
        fail("ResultadosPanel.tsx ausente")
    if "reactivation_outcome_stats" in cockpit or "ResultadosPanel" in cockpit:
        ok("Cockpit tem aba Resultados")
    else:
        fail("Cockpit sem aba Resultados")
    if "sendBatch" in cockpit and "mode: \"batch\"" in cockpit:
        ok("Cockpit tem envio em lote")
    else:
        fail("Cockpit sem envio em lote")

    # 13. deno check do classifier (type-safe — não só import)
    chk = subprocess.run(
        ["deno", "check", "supabase/functions/lead-temperature-classifier/index.ts"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if chk.returncode == 0:
        ok("deno check classifier")
    else:
        fail("deno check classifier falhou")
        print(chk.stderr[-500:] if chk.stderr else chk.stdout[-500:])

    # 14. Deno tests
    test_file = ROOT / "supabase/functions/_shared/conversion/rule-classifier.test.ts"
    r = subprocess.run(
        ["deno", "test", "--allow-read", str(test_file)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if r.returncode == 0:
        ok("deno test rule-classifier")
    else:
        fail("deno test rule-classifier falhou")
        print(r.stdout[-500:] if r.stdout else r.stderr[-500:])

    print(f"\n=== {_errors} falha(s) ===")
    return 1 if _errors else 0


if __name__ == "__main__":
    sys.exit(main())
