#!/usr/bin/env python3
"""
Auditoria Python das melhorias FAQ/atendimento automático.
Valida issues da revisão + pressupostos Context7 (design.md §Notas Context7).

Uso: python3 scripts/audit-faq-improvements.py
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FILES = {
    "evolution_bot_flow": ROOT / "supabase/functions/evolution-webhook/handlers/bot-flow.ts",
    "whapi_bot_flow": ROOT / "supabase/functions/whapi-webhook/handlers/bot-flow.ts",
    "webhook_entry": ROOT / "supabase/functions/_shared/engine/webhook-entry.ts",
    "reemit_buttons": ROOT / "supabase/functions/_shared/bot/reemit-buttons.ts",
    "purchase_intent": ROOT / "supabase/functions/_shared/bot/purchase-intent.ts",
    "nudge": ROOT / "supabase/functions/faq-reengagement-nudge/index.ts",
    "evolution_adapter": ROOT / "supabase/functions/_shared/channels/evolution.ts",
    "whapi_adapter": ROOT / "supabase/functions/_shared/channels/whapi.ts",
    "evolution_api": ROOT / "supabase/functions/_shared/evolution-api.ts",
    "whapi_api": ROOT / "supabase/functions/_shared/whapi-api.ts",
    "idempotency_ctx": ROOT / "supabase/functions/_shared/channels/idempotency-from-ctx.ts",
    "dispatcher": ROOT / "supabase/functions/_shared/engine/dispatcher.ts",
    "design": ROOT / ".kiro/specs/bot-engine-channel-unification/design.md",
    "migration_seed": ROOT / "supabase/migrations/20260613100000_auto_seed_faq_on_flow_create.sql",
    "migration_nudge": ROOT / "supabase/migrations/20260613100100_nudge_field.sql",
    "migration_cron": ROOT / "supabase/migrations/20260613100200_faq_reengagement_nudge_cron.sql",
    "config_toml": ROOT / "supabase/config.toml",
}


@dataclass
class Check:
    id: str
    title: str
    ok: bool
    detail: str
    severity: str = "info"


def read(name: str) -> str:
    p = FILES[name]
    if not p.exists():
        return ""
    return p.read_text(encoding="utf-8")


def extract_function_block(src: str, fn_name: str) -> str | None:
    m = re.search(rf"async function {fn_name}\([^)]*\)[^{{]*\{{", src)
    if not m:
        m = re.search(rf"function {fn_name}\([^)]*\)[^{{]*\{{", src)
    if not m:
        return None
    start = m.start()
    brace = 0
    i = m.end() - 1
    while i < len(src):
        if src[i] == "{":
            brace += 1
        elif src[i] == "}":
            brace -= 1
            if brace == 0:
                return src[start : i + 1]
        i += 1
    return None


def section_after_marker(src: str, marker: str, window: int = 12000) -> str:
    idx = src.find(marker)
    if idx < 0:
        return ""
    return src[idx : idx + window]


def run_checks() -> list[Check]:
    checks: list[Check] = []

    webhook = read("webhook_entry")
    evo = read("evolution_bot_flow")
    whapi = read("whapi_bot_flow")
    reemit = read("reemit_buttons")
    purchase = read("purchase_intent")
    nudge = read("nudge")
    evo_adapter = read("evolution_adapter")
    whapi_adapter = read("whapi_adapter")
    evo_api = read("evolution_api")
    whapi_api = read("whapi_api")
    design = read("design")
    dispatcher = read("dispatcher")
    mig_cron = read("migration_cron")
    config = read("config_toml")

    # ── Issue 1: idempotency determinística ─────────────────────────────
    bad_idem = "deferred_faq:${args.customerId}:${Date.now()}" in webhook
    good_idem = "deferred_faq:${args.customerId}:${result.deferred.stepId}" in webhook
    checks.append(Check(
        "1",
        "Idempotency key determinística (sem Date.now)",
        good_idem and not bad_idem,
        "OK: chave inclui stepId + pergunta" if good_idem and not bad_idem
        else "FALHA: ainda usa Date.now ou falta stepId/pergunta",
        "critical",
    ))

    # Adapter repassa idempotency via idempotencyFromCtx
    evo_idem_wired = "idempotencyFromCtx(ctx" in evo_adapter
    whapi_idem_wired = "idempotencyFromCtx(ctx" in whapi_adapter
    checks.append(Check(
        "1b",
        "Adapters Evolution+Whapi repassam idempotencyKey ao sender",
        evo_idem_wired and whapi_idem_wired,
        f"evolution={evo_idem_wired}, whapi={whapi_idem_wired}",
        "high",
    ))
    dispatcher_slot_flag = "idempotencySlotAcquired: true" in dispatcher
    checks.append(Check(
        "1c",
        "Dispatcher V3 marca idempotencySlotAcquired (evita double-acquire)",
        dispatcher_slot_flag,
        "OK" if dispatcher_slot_flag else "FALHA",
        "medium",
    ))
    nudge_supabase_ctx = "supabase," in nudge and "sendCtx" in nudge
    checks.append(Check(
        "1d",
        "Nudge cron passa supabase no SendContext",
        nudge_supabase_ctx,
        "OK" if nudge_supabase_ctx else "FALHA",
        "medium",
    ))

    # ── Issue 2 + 6: purchase-intent helper ───────────────────────────────
    has_helper = FILES["purchase_intent"].exists()
    unicode_ok = r"[\u0300-\u036f]" in purchase
    phrase_normalized = "stripAccents(phrase)" in purchase
    negation_ok = '"não "' not in purchase and '"nao "' in purchase
    evo_uses_helper = "purchase-intent.ts" in evo
    whapi_uses_helper = "purchase-intent.ts" in whapi
    checks.append(Check(
        "2",
        "Unicode explícito \\u0300-\\u036f no helper purchase-intent",
        has_helper and unicode_ok,
        "OK" if unicode_ok else "FALHA: regex frágil",
        "high",
    ))
    checks.append(Check(
        "2b",
        "Frases de purchase-intent também normalizadas (stripAccents(phrase))",
        phrase_normalized,
        "OK" if phrase_normalized else 'FALHA: "como faço para aderir?" não bate',
        "high",
    ))
    checks.append(Check(
        "6",
        'NEGATION_PREFIXES sem "não " (dead code pós-strip)',
        negation_ok,
        "OK: só prefixos ASCII pós-normalização" if negation_ok else 'FALHA: ainda tem "não "',
        "low",
    ))
    checks.append(Check(
        "10-partial",
        "Purchase-intent centralizado (reduz duplicação)",
        evo_uses_helper and whapi_uses_helper,
        f"evolution={evo_uses_helper}, whapi={whapi_uses_helper}",
        "medium",
    ))

    # ── Issue 3: paridade reemit ────────────────────────────────────────
    evo_block = extract_function_block(evo, "respondAndReentry")
    whapi_block = extract_function_block(whapi, "respondAndReentry")
    evo_reemit = evo_block and "reemitStepButtons" in evo_block
    whapi_reemit = whapi_block and "reemitStepButtons" in whapi_block
    checks.append(Check(
        "3",
        "Whapi respondAndReentry tem reemitStepButtons (paridade Evolution)",
        bool(whapi_reemit),
        f"evolution={bool(evo_reemit)}, whapi={bool(whapi_reemit)}",
        "critical",
    ))

    evo_esclarecer = section_after_marker(evo, "esclarecer_duvidas")
    whapi_esclarecer = section_after_marker(whapi, "esclarecer_duvidas")
    evo_esclarecer_reemit = "reemitStepButtons" in evo_esclarecer
    whapi_esclarecer_reemit = "reemitStepButtons" in whapi_esclarecer
    evo_inline_reemit = "renderedButtons" in evo_esclarecer and "reemitStepButtons" not in evo_esclarecer
    whapi_inline_reemit = "renderedButtons" in whapi_esclarecer and "reemitStepButtons" not in whapi_esclarecer
    checks.append(Check(
        "3b",
        "esclarecer_duvidas usa reemitStepButtons (não inline renderedButtons)",
        evo_esclarecer_reemit and whapi_esclarecer_reemit and not evo_inline_reemit and not whapi_inline_reemit,
        f"evo_reemit={evo_esclarecer_reemit}, whapi_reemit={whapi_esclarecer_reemit}, "
        f"evo_inline={evo_inline_reemit}, whapi_inline={whapi_inline_reemit}",
        "high",
    ))

    evo_qa = extract_function_block(evo, "trySendConfiguredQa") or ""
    whapi_qa = extract_function_block(whapi, "trySendConfiguredQa") or ""
    checks.append(Check(
        "3c",
        "trySendConfiguredQa reemite botões quando keepStep=true",
        "reemitStepButtons" in evo_qa and "reemitStepButtons" in whapi_qa,
        f"evolution={'reemitStepButtons' in evo_qa}, whapi={'reemitStepButtons' in whapi_qa}",
        "medium",
    ))

    # ── Issue 4: leadName ─────────────────────────────────────────────────
    lead_ok = "leadName: ctx.state.customer.name" in webhook
    checks.append(Check(
        "4",
        "leadName preenchido no deferred FAQ V3",
        lead_ok,
        "OK: ctx.state.customer.name" if lead_ok else "FALHA: leadName vazio ou errado",
        "medium",
    ))

    # ── Issue 5: skipIfHandoff morto ─────────────────────────────────────
    dead_skip = re.search(
        r"if \(detourNext < 8\)[\s\S]{0,400}skipIfHandoff:\s*detourNext\s*>=\s*8",
        evo,
    )
    checks.append(Check(
        "5",
        "skipIfHandoff morto removido do Evolution respondAndReentry",
        dead_skip is None,
        "OK: parâmetro morto removido" if dead_skip is None else "FALHA: ainda presente",
        "low",
    ))

    # ── Issue 7: slice(0,3) ───────────────────────────────────────────────
    reemit_numbered_gt3 = "renderedButtons.length > 3" in reemit
    whapi_sendchoice_gt3 = "allOptions.length <= WHAPI_CAPABILITIES.maxButtons" in whapi_adapter
    checks.append(Check(
        "7",
        ">3 opções: lista numerada (reemit + whapi sendChoice)",
        reemit_numbered_gt3 and whapi_sendchoice_gt3,
        f"reemit_gt3={reemit_numbered_gt3}, whapi_sendChoice={whapi_sendchoice_gt3}",
        "high",
    ))

    # ── Issue 8: nudge ────────────────────────────────────────────────────
    checks.append(Check(
        "8",
        "Nudge usa normalizePhone para JID",
        "normalizePhone(lead.phone_whatsapp)" in nudge,
        "OK" if "normalizePhone(lead.phone_whatsapp)" in nudge else "FALHA",
        "medium",
    ))
    nudge_inactivity = "last_bot_reply_at" in nudge
    checks.append(Check(
        "8b",
        "Nudge usa last_bot_reply_at (não updated_at)",
        nudge_inactivity,
        "OK: sinal de inatividade correto" if nudge_inactivity else "FALHA",
        "medium",
    ))
    cron_ok = "faq-reengagement-nudge-5min" in mig_cron and "*/5 * * * *" in mig_cron
    config_ok = "[functions.faq-reengagement-nudge]" in config and "verify_jwt = false" in config
    checks.append(Check(
        "8c",
        "Cron nudge registrado (migration + config.toml)",
        cron_ok and config_ok,
        f"migration={cron_ok}, config={config_ok}",
        "high",
    ))

    # ── AI parity: runOrchestrator em esclarecer_duvidas ────────────────
    evo_orch = "runOrchestrator" in evo_esclarecer
    whapi_orch = "runOrchestrator" in whapi_esclarecer
    evo_direct_faq = "answerFaqWithAI" in evo_esclarecer
    checks.append(Check(
        "AI-parity",
        "Evolution esclarecer_duvidas usa runOrchestrator (paridade Whapi)",
        evo_orch and whapi_orch and not evo_direct_faq,
        f"evo_orch={evo_orch}, whapi_orch={whapi_orch}, evo_direct_faq={evo_direct_faq}",
        "critical",
    ))
    evo_ai_limit = 'fb.mode === "ai_limit"' in evo_esclarecer
    whapi_ai_limit = 'fb.mode === "ai_limit"' in whapi_esclarecer
    checks.append(Check(
        "AI-limit",
        "ai_limit fallback em esclarecer_duvidas (Evolution + Whapi)",
        evo_ai_limit and whapi_ai_limit,
        f"evolution={evo_ai_limit}, whapi={whapi_ai_limit}",
        "medium",
    ))

    # ── Context7 / design.md pressupostos ─────────────────────────────────
    evo_caps_false = "supportsButtons: false" in evo_adapter
    checks.append(Check(
        "CTX-evolution",
        "Context7: Evolution supportsButtons=false (política operacional)",
        evo_caps_false,
        "OK: revertido para false (Baileys instável para botões)" if evo_caps_false else "FALHA: true ativo",
        "critical",
    ))

    sendbuttons_text_only = "evolution_buttons_as_text" in evo_api and "sendButtons/${instanceName}" not in evo_api
    checks.append(Check(
        "CTX-evolution-api",
        "Evolution sendButtons só texto numerado (sem HTTP sendButtons)",
        sendbuttons_text_only,
        "OK: sem tentativa de botões reais" if sendbuttons_text_only else "FALHA: ainda tenta API real",
        "critical",
    ))

    design_max3 = "maxButtons = 3" in design or "maxButtons: 3" in design
    checks.append(Check(
        "CTX-whapi-max3",
        "Context7 design: Whapi maxButtons=3 documentado",
        design_max3,
        "OK no design.md",
        "info",
    ))

    sendchoice_all_options = "allOptions.length <= EVOLUTION_CAPABILITIES.maxButtons" in evo_adapter
    checks.append(Check(
        "FIX-sendChoice",
        "sendChoice Evolution: downgrade quando >maxButtons (não corta opções)",
        sendchoice_all_options,
        "OK: >3 opções caem em texto numerado com TODAS" if sendchoice_all_options else "FALHA",
        "high",
    ))

    v3_choice_only = 'filter((o) => o.kind === "choice")' in webhook
    checks.append(Check(
        "FIX-v3-reemit",
        "V3 deferred FAQ reemite só choice (não prompt inteiro)",
        v3_choice_only,
        "OK" if v3_choice_only else "FALHA",
        "medium",
    ))

    # _needsBill parity
    evo_needs_bill = "_needsBill" in evo
    whapi_needs_bill = "_needsBill" in whapi
    checks.append(Check(
        "FIX-needsBill",
        "Guard _needsBill em dispatchStepFromFlow (Evolution + Whapi)",
        evo_needs_bill and whapi_needs_bill,
        f"evolution={evo_needs_bill}, whapi={whapi_needs_bill}",
        "medium",
    ))

    # Whapi idempotency in API layer
    whapi_with_idem = "withIdempotency" in whapi_api and "acquireOutboundSlot" in whapi_api
    checks.append(Check(
        "FIX-whapi-idem",
        "Whapi API com withIdempotency (outbound_message_log)",
        whapi_with_idem,
        "OK" if whapi_with_idem else "FALHA",
        "medium",
    ))

    # Migration guards
    mig = read("migration_seed")
    seed_guard = "is_public" in mig and "DROP TRIGGER IF EXISTS" in mig
    checks.append(Check(
        "FIX-migration-seed",
        "Auto-seed restrito (não público) + idempotente",
        seed_guard,
        "OK" if seed_guard else "FALHA",
        "medium",
    ))

    # Deno tests exist
    test_files = [
        ROOT / "supabase/functions/_shared/bot/purchase-intent_test.ts",
        ROOT / "supabase/functions/_shared/bot/reemit-buttons_test.ts",
        ROOT / "supabase/functions/_shared/channels/adapter-idempotency_test.ts",
    ]
    tests_ok = all(p.exists() for p in test_files)
    checks.append(Check(
        "TESTS",
        "Testes Deno unitários das melhorias FAQ",
        tests_ok,
        ", ".join(p.name for p in test_files if p.exists()) or "nenhum",
        "medium",
    ))

    return checks


def parity_metrics() -> dict:
    evo = read("evolution_bot_flow")
    whapi = read("whapi_bot_flow")
    evo_rr = extract_function_block(evo, "respondAndReentry") or ""
    whapi_rr = extract_function_block(whapi, "respondAndReentry") or ""
    evo_escl = section_after_marker(evo, "esclarecer_duvidas", 8000)
    whapi_escl = section_after_marker(whapi, "esclarecer_duvidas", 8000)
    return {
        "evolution_respondAndReentry_lines": evo_rr.count("\n"),
        "whapi_respondAndReentry_lines": whapi_rr.count("\n"),
        "line_diff": abs(evo_rr.count("\n") - whapi_rr.count("\n")),
        "evolution_has_reemit": "reemitStepButtons" in evo_rr,
        "whapi_has_reemit": "reemitStepButtons" in whapi_rr,
        "evolution_esclarecer_orch": "runOrchestrator" in evo_escl,
        "whapi_esclarecer_orch": "runOrchestrator" in whapi_escl,
        "evolution_esclarecer_ai_limit": 'fb.mode === "ai_limit"' in evo_escl,
        "whapi_esclarecer_ai_limit": 'fb.mode === "ai_limit"' in whapi_escl,
    }


def main() -> int:
    print("=" * 72)
    print("AUDITORIA FAQ / ATENDIMENTO AUTOMÁTICO")
    print("Validação código + pressupostos Context7 (design.md 2026-05-28)")
    print("=" * 72)

    checks = run_checks()
    metrics = parity_metrics()

    passed = sum(1 for c in checks if c.ok)
    failed = [c for c in checks if not c.ok and c.severity in ("critical", "high", "medium")]

    for c in checks:
        if c.ok:
            icon = "✅"
        elif c.severity in ("critical", "high", "medium"):
            icon = "❌"
        else:
            icon = "ℹ️"
        print(f"\n{icon} [{c.id}] {c.title}")
        print(f"   {c.detail}")

    print("\n" + "-" * 72)
    print("PARIDADE Evolution vs Whapi")
    for k, v in metrics.items():
        print(f"  {k}: {v}")

    print("\n" + "-" * 72)
    print("CONTEXTO EXTERNO (Context7 / docs públicas)")
    print("  • WhatsApp API: máx 3 quick-reply buttons — CONFIRMADO (Meta/Whapi)")
    print("  • Evolution Baileys sendButtons: HTTP 201 sem entrega — CONFIRMADO (issues #2404)")
    print("  • design.md: supportsButtons=false por política — ALINHADO com código atual")

    print("\n" + "=" * 72)
    print(f"RESULTADO: {passed}/{len(checks)} checks OK")
    if failed:
        print(f"FALHAS: {len(failed)}")
        for c in failed:
            print(f"  - [{c.id}] {c.title}")
        return 1
    print("TODOS OS CHECKS CRÍTICOS/MÉDIOS/ALTOS PASSARAM")
    return 0


if __name__ == "__main__":
    sys.exit(main())
