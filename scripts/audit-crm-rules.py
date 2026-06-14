#!/usr/bin/env python3
"""
Auditoria CRM — valida regras de entrada/saída, sync bot→Kanban e dívidas conhecidas.

Detecta:
  • Invariantes que DEVEM passar (funil lead, guards, triggers, testes Deno)
  • Drift arquitetural (coexistência legado vs pós-venda) — falha até corrigir

Uso:
  python3 scripts/audit-crm-rules.py
  python3 scripts/audit-crm-rules.py --json
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FILES = {
    "crm_stage_sync": ROOT / "supabase/functions/_shared/crm-stage-sync.ts",
    "crm_sync_wrapper": ROOT / "supabase/functions/_shared/conversion/crm-sync.ts",
    "crm_auto_progress": ROOT / "supabase/functions/crm-auto-progress/index.ts",
    "pos_venda_auto": ROOT / "supabase/functions/pos-venda-auto-progress/index.ts",
    "use_kanban_stages": ROOT / "src/hooks/useKanbanStages.ts",
    "use_kanban_deals": ROOT / "src/hooks/useKanbanDeals.ts",
    "add_lead_dialog": ROOT / "src/components/whatsapp/AddLeadDialog.tsx",
    "pos_venda_kanban": ROOT / "src/components/whatsapp/PosVendaKanban.tsx",
    "whapi_webhook": ROOT / "supabase/functions/whapi-webhook/index.ts",
    "evolution_webhook": ROOT / "supabase/functions/evolution-webhook/index.ts",
    "webhook_entry": ROOT / "supabase/functions/_shared/engine/webhook-entry.ts",
    "trigger_insert": ROOT / "supabase/migrations/20260601220741_9b2a2c22-9015-41ca-84ad-9adbb41e89bd.sql",
    "prevent_non_lead": ROOT / "supabase/migrations/20260525150020_2cd1ba5f-357d-4692-8411-371f80b857da.sql",
    "lead_kanban_split": ROOT / "supabase/migrations/20260608142027_50c8de95-3f22-4cbb-9771-c9e94c67094b.sql",
    "compute_pos_venda": ROOT / "supabase/migrations/20260525164339_5ee1ed37-8e6a-48e3-ad17-cd1049eb1a69.sql",
    "recompute_pos_venda": ROOT / "supabase/migrations/20260613110000_crm_pos_venda_unify.sql",
    "crm_auto_cron": ROOT / "supabase/migrations/20260330164754_71ec10ee-b470-42dc-8330-bb3e4c9d2ad1.sql",
    "crm_stage_sync_test": ROOT / "supabase/functions/_shared/crm-stage-sync_test.ts",
    "temp_classifier": ROOT / "supabase/functions/lead-temperature-classifier/index.ts",
    "sync_igreen": ROOT / "supabase/functions/sync-igreen-customers/index.ts",
    "conversao_cockpit": ROOT / "src/components/admin/conversao/ConversaoCockpit.tsx",
    "classifier_daily_cron": ROOT / "supabase/migrations/20260613150000_conversion_classifier_daily.sql",
    "origin_guard": ROOT / "supabase/functions/lead-temperature-classifier/origin-guard.ts",
    "origin_guard_test": ROOT / "supabase/functions/lead-temperature-classifier/origin-guard_test.ts",
    "process_followups": ROOT / "supabase/functions/process-followups/index.ts",
    "bot_followup_checker": ROOT / "supabase/functions/bot-followup-checker/index.ts",
    "reactivation_cron": ROOT / "supabase/functions/reactivation-cron/index.ts",
    "submit_otp": ROOT / "supabase/functions/submit-otp/index.ts",
    "finalize_capture": ROOT / "supabase/functions/finalize-capture/index.ts",
}

LEAD_STAGES = [
    "novo_lead",
    "qualificando",
    "valor_conta",
    "conta_enviada",
    "doc_enviado",
    "finalizando",
]

POST_LEAD_STAGES = ["aprovado", "reprovado", "30_dias", "60_dias", "90_dias", "120_dias", "espera"]


@dataclass
class Check:
    id: str
    title: str
    ok: bool
    detail: str
    category: str  # invariant | drift
    severity: str = "medium"  # critical | high | medium | low | info


def read(name: str) -> str:
    p = FILES.get(name)
    if not p or not p.exists():
        return ""
    return p.read_text(encoding="utf-8")


def extract_map(src: str, const_name: str) -> dict[str, str]:
    m = re.search(rf"const {const_name}[\s\S]*?=\s*\{{([\s\S]*?)\}};", src)
    if not m:
        return {}
    return dict(re.findall(r"^\s*(\w+):\s*\"([^\"]+)\"", m.group(1), re.M))


def count_await_calls(
    pattern: str,
    exclude: Path | None = None,
    exclude_test_files: bool = False,
) -> list[tuple[str, int]]:
    hits: list[tuple[str, int]] = []
    rx = re.compile(pattern)
    for p in ROOT.rglob("*.ts"):
        if "node_modules" in str(p):
            continue
        if exclude_test_files and p.name.endswith("_test.ts"):
            continue
        if exclude and p.resolve() == exclude.resolve():
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        for i, line in enumerate(text.splitlines(), 1):
            if rx.search(line) and not line.strip().startswith("//"):
                hits.append((f"{p.relative_to(ROOT)}:{i}", 1))
    return hits


def run_deno_tests() -> tuple[bool, str]:
    test_file = FILES["crm_stage_sync_test"]
    if not test_file.exists():
        return False, "crm-stage-sync_test.ts ausente"
    proc = subprocess.run(
        ["deno", "test", "--allow-env", str(test_file)],
        capture_output=True,
        text=True,
        cwd=str(ROOT),
    )
    tail = (proc.stdout + proc.stderr)[-600:]
    return proc.returncode == 0, tail


def run_origin_guard_test() -> tuple[bool, str]:
    # origin-guard.ts é um módulo puro (sem side-effects), então o teste roda
    # sem flags de env — importa só a função isLeadClassifiable.
    test_file = FILES["origin_guard_test"]
    if not test_file.exists():
        return False, "origin-guard_test.ts ausente"
    proc = subprocess.run(
        ["deno", "test", str(test_file)],
        capture_output=True,
        text=True,
        cwd=str(ROOT),
    )
    tail = (proc.stdout + proc.stderr)[-600:]
    return proc.returncode == 0, tail


def run_checks() -> list[Check]:
    checks: list[Check] = []

    uks = read("use_kanban_stages")
    kbd = read("use_kanban_deals")
    sync = read("crm_stage_sync")
    ald = read("add_lead_dialog")
    pvk = read("pos_venda_kanban")
    cap = read("crm_auto_progress")
    pvp = read("pos_venda_auto")
    trig = read("trigger_insert")
    prev = read("prevent_non_lead")
    split = read("lead_kanban_split")
    recompute = read("recompute_pos_venda")
    compute = read("compute_pos_venda")
    cron = read("crm_auto_cron")

    # ── Invariantes (devem passar) ───────────────────────────────────────
    found_stages = re.findall(r'stage_key:\s*"([^"]+)"', uks)
    checks.append(
        Check(
            "INV-01",
            "DEFAULT_STAGES tem 6 colunas lead na ordem correta",
            found_stages == LEAD_STAGES,
            str(found_stages),
            "invariant",
            "critical",
        )
    )

    checks.append(
        Check(
            "INV-02",
            "useKanbanStages filtra stage_scope=lead",
            "stage_scope.eq.lead" in uks,
            "fetchStages",
            "invariant",
            "high",
        )
    )

    active = re.findall(
        r'"([^"]+)"',
        re.search(r"ACTIVE_FUNNEL_STAGES = new Set\(\[([\s\S]*?)\]\)", sync).group(1)
        if "ACTIVE_FUNNEL_STAGES" in sync
        else "",
    )
    checks.append(
        Check(
            "INV-03",
            "ACTIVE_FUNNEL_STAGES = 6 estágios lead",
            set(active) == set(LEAD_STAGES),
            str(active),
            "invariant",
            "critical",
        )
    )

    legacy = extract_map(sync, "LEGACY_STEP_TO_STAGE")
    checks.append(
        Check(
            "INV-04",
            "portal_submitting mapeia para finalizando",
            legacy.get("portal_submitting") == "finalizando",
            legacy.get("portal_submitting", "?"),
            "invariant",
            "high",
        )
    )

    guards_ok = all(
        g in sync
        for g in [
            "targetOrder <= currentOrder",
            "ACTIVE_FUNNEL_STAGES.has(currentStage)",
            "if (!customerId || !conversationStep) return",
        ]
    )
    checks.append(
        Check(
            "INV-05",
            "Guards crm-stage-sync (não rebaixa, só funil ativo, noop)",
            guards_ok,
            "crm-stage-sync.ts",
            "invariant",
            "critical",
        )
    )

    webhook_calls = {
        "whapi": "await syncCustomerStage" in read("whapi_webhook"),
        "evolution": "await syncCustomerStage" in read("evolution_webhook"),
        "engine": "await syncCustomerStage" in read("webhook_entry"),
    }
    checks.append(
        Check(
            "INV-06",
            "syncCustomerStage nos 3 chokepoints de webhook",
            all(webhook_calls.values()),
            str(webhook_calls),
            "invariant",
            "high",
        )
    )

    checks.append(
        Check(
            "INV-07",
            "Trigger INSERT cria deal novo_lead (whatsapp_lead/manual)",
            "'novo_lead'" in trig and "'whatsapp_lead'" in trig,
            "create_lead_deal_on_customer_insert",
            "invariant",
            "critical",
        )
    )

    checks.append(
        Check(
            "INV-08",
            "prevent_non_lead_deals bloqueia igreen_sync",
            "customer_origin = 'igreen_sync'" in prev and "remote_jid" in prev,
            "trigger BEFORE INSERT crm_deals",
            "invariant",
            "critical",
        )
    )

    checks.append(
        Check(
            "INV-09",
            "Migration removeu estágios pós-finalizando do kanban lead",
            "DELETE FROM public.kanban_stages" in split
            and all(s in split for s in ["aprovado", "30_dias", "120_dias"]),
            "20260608142027",
            "invariant",
            "high",
        )
    )

    checks.append(
        Check(
            "INV-10",
            "useKanbanDeals filtra só whatsapp_lead/manual",
            "whatsapp_lead,manual" in kbd.replace(" ", ""),
            "customers!inner",
            "invariant",
            "high",
        )
    )

    checks.append(
        Check(
            "INV-11",
            "moveDeal não seta approved_at/rejected_at",
            "approved_at" not in (kbd.split("const moveDeal")[1] if "const moveDeal" in kbd else kbd),
            "useKanbanDeals.ts",
            "invariant",
            "medium",
        )
    )

    pv_stages = re.findall(r'key:\s*"([^"]+)"', pvk)[:7]
    checks.append(
        Check(
            "INV-12",
            "PosVendaKanban tem colunas espera→d120",
            pv_stages
            == ["espera", "aprovado", "reprovado", "d30", "d60", "d90", "d120"],
            str(pv_stages),
            "invariant",
            "high",
        )
    )

    deno_ok, deno_tail = run_deno_tests()
    checks.append(
        Check(
            "INV-13",
            "crm-stage-sync_test.ts (Deno) passa",
            deno_ok,
            deno_tail.splitlines()[-1] if deno_tail else "sem saída",
            "invariant",
            "critical",
        )
    )

    # ── Temperatura × origem: carteira iGreen não entra em lead_insights ────
    clf = read("temp_classifier")
    cockpit = read("conversao_cockpit")
    sync_customers = read("sync_igreen")
    daily_cron = read("classifier_daily_cron")

    # INV-14: classifyOne tem guarda de origem (select + retorno cedo via
    # isLeadClassifiable). É o gravador único de lead_insights, então essa guarda
    # cobre todos os caminhos (customer_id, customer_ids, scopes). A função pura
    # vive em origin-guard.ts (sem side-effects) e tem teste Deno dedicado.
    # Remover isso = carteira volta a ser classificada em temperatura.
    guard = read("origin_guard")
    guard_test = read("origin_guard_test")
    guard_selects_origin = re.search(
        r'\.select\([^)]*customer_origin[^)]*\)', clf
    ) is not None
    guard_module_logic = 'customerOrigin !== "igreen_sync"' in guard
    guard_returns_early = re.search(
        r'!isLeadClassifiable\([^)]*\)[\s\S]{0,120}?skipped:\s*"igreen_sync"',
        clf,
    ) is not None
    guard_has_test = (
        "isLeadClassifiable" in guard_test
        and '"igreen_sync"' in guard_test
    )
    checks.append(
        Check(
            "INV-14",
            "classifyOne barra igreen_sync (isLeadClassifiable + retorno cedo + teste)",
            guard_selects_origin and guard_module_logic and guard_returns_early and guard_has_test,
            f"select={guard_selects_origin} module={guard_module_logic} early={guard_returns_early} test={guard_has_test}",
            "invariant",
            "critical",
        )
    )

    # INV-15: scope global do cron filtra igreen_sync no inner join — senão
    # repesca resíduo de carteira em loop ocioso (Achado 1).
    global_filters_origin = (
        "needs_reclassify_global" in clf
        and "customers!inner" in clf
        and 'neq("customers.customer_origin", "igreen_sync")' in clf
    )
    checks.append(
        Check(
            "INV-15",
            "scope needs_reclassify_global exclui igreen_sync (sem loop ocioso)",
            global_filters_origin,
            "inner join customers + neq igreen_sync",
            "invariant",
            "high",
        )
    )

    # INV-16: sync limpa resíduo (lead_insights/crm_deals) de leads que viram
    # carteira, escopado por consultor. Sem isso, um lead que converteu mantém
    # linha de temperatura/funil órfã.
    sync_cleans_residue = (
        "flippingToWalletIds" in sync_customers
        and 'from("lead_insights")' in sync_customers
        and ".delete(" in sync_customers
    )
    checks.append(
        Check(
            "INV-16",
            "sync-igreen-customers limpa lead_insights/crm_deals de leads→carteira",
            sync_cleans_residue,
            "flippingToWalletIds + delete",
            "invariant",
            "high",
        )
    )

    # INV-17: classificação sob demanda na abertura da Central (substitui o
    # trabalho ocioso do cron de 15 min).
    cockpit_on_open = (
        "autoClassifiedFor" in cockpit and "autoClassifyOnOpen" in cockpit
    )
    checks.append(
        Check(
            "INV-17",
            "ConversaoCockpit classifica sob demanda ao abrir (top N)",
            cockpit_on_open,
            "autoClassifyOnOpen + guard por consultor",
            "invariant",
            "medium",
        )
    )

    # INV-18: cron migrado de 15 min para diário leve. A migration desagenda o
    # job antigo e agenda o diário — confirma que a estratégia sob demanda não
    # convive com o trabalho ocioso periódico.
    cron_migrated = (
        "unschedule('conversion-classifier-15min')" in daily_cron
        and "'conversion-classifier-daily'" in daily_cron
        and "needs_reclassify_global" in daily_cron
    )
    checks.append(
        Check(
            "INV-18",
            "cron 15min desagendado e trocado por diário leve",
            cron_migrated,
            "20260613150000_conversion_classifier_daily.sql",
            "invariant",
            "medium",
        )
    )

    # INV-19: teste Deno da guarda de origem (origin-guard_test.ts) passa.
    # Executa a lógica de fato — não só checagem estática.
    guard_ok, guard_tail = run_origin_guard_test()
    checks.append(
        Check(
            "INV-19",
            "origin-guard_test.ts (Deno) passa",
            guard_ok,
            guard_tail.splitlines()[-1] if guard_tail else "sem saída",
            "invariant",
            "critical",
        )
    )

    # ── Follow-up / reativação automática: carteira não recebe mensagem ─────
    proc_fup = read("process_followups")
    bot_fup = read("bot_followup_checker")
    react_cron = read("reactivation_cron")
    submit_otp = read("submit_otp")
    finalize_capture = read("finalize_capture")

    ORIGIN_FILTER = "customer_origin.in.(whatsapp_lead,manual),customer_origin.is.null"

    # INV-20: process-followups barra igreen_sync na query E tem guarda de passo
    # terminal (defesa em profundidade). É o único cron de follow-up que dispara
    # por next_followup_at sem checar step — a fresta que fechamos nesta sessão.
    proc_filters_origin = ORIGIN_FILTER in proc_fup
    proc_terminal_guard = (
        "TERMINAL_STEPS" in proc_fup
        and "!TERMINAL_STEPS.has" in proc_fup
    )
    checks.append(
        Check(
            "INV-20",
            "process-followups exclui igreen_sync + guarda passo terminal",
            proc_filters_origin and proc_terminal_guard,
            f"origin={proc_filters_origin} terminal={proc_terminal_guard}",
            "invariant",
            "critical",
        )
    )

    # INV-21: a conclusão (submit-otp + finalize-capture) zera next_followup_at,
    # eliminando o agendamento órfão que dispararia follow-up após o cliente
    # entrar no portal e virar carteira. Trata a causa na fonte.
    conclusion_clears_followup = (
        "next_followup_at: null" in submit_otp
        and "next_followup_at: null" in finalize_capture
    )
    checks.append(
        Check(
            "INV-21",
            "submit-otp e finalize-capture zeram next_followup_at na conclusão",
            conclusion_clears_followup,
            "next_followup_at=null em ambos",
            "invariant",
            "high",
        )
    )

    # INV-22: os dois crons que usam TERMINAL_STEPS (process-followups e
    # bot-followup-checker) mantêm a MESMA lista. Divergência aqui reabre a
    # fresta de "passo terminal num cron, não no outro".
    def _terminal_set(src: str) -> set[str]:
        m = re.search(r"TERMINAL_STEPS\s*=\s*new Set\(\[([\s\S]*?)\]\)", src)
        return set(re.findall(r'"([^"]+)"', m.group(1))) if m else set()

    proc_terminal = _terminal_set(proc_fup)
    bot_terminal = _terminal_set(bot_fup)
    checks.append(
        Check(
            "INV-22",
            "TERMINAL_STEPS idêntico entre process-followups e bot-followup-checker",
            len(proc_terminal) > 0 and proc_terminal == bot_terminal,
            f"proc={len(proc_terminal)} bot={len(bot_terminal)} igual={proc_terminal == bot_terminal}",
            "invariant",
            "high",
        )
    )

    # INV-23: bot-followup-checker filtra origem (candidatos + cold). Carteira
    # não recebe follow-up nem é marcada como "fria".
    bot_filters_origin = bot_fup.count(ORIGIN_FILTER) >= 2
    checks.append(
        Check(
            "INV-23",
            "bot-followup-checker exclui igreen_sync (candidatos + cold)",
            bot_filters_origin,
            f"ocorrencias_filtro={bot_fup.count(ORIGIN_FILTER)}",
            "invariant",
            "high",
        )
    )

    # INV-24: reactivation-cron filtra origem em fetchCandidates. Mesma trava
    # explícita dos outros crons, além do filtro por status/step que já tinha.
    react_filters_origin = ORIGIN_FILTER in react_cron
    checks.append(
        Check(
            "INV-24",
            "reactivation-cron exclui igreen_sync em fetchCandidates",
            react_filters_origin,
            "filtro de origem presente",
            "invariant",
            "high",
        )
    )

    # ── Drift / dívida (devem falhar até plano de correção) ────────────────
    unify = read("recompute_pos_venda")
    sql_uses_coalesce = "COALESCE(c.pos_venda_approved_at, c.portal_submitted_at)" in unify
    edge_uses_approved = "pos_venda_approved_at" in pvp
    ui_uses_fallback = "pos_venda_approved_at || c.portal_submitted_at" in pvk
    checks.append(
        Check(
            "DRIFT-01",
            "Marco temporal único: SQL cron e Edge/UI usam a mesma data",
            sql_uses_coalesce and edge_uses_approved and ui_uses_fallback,
            f"sql_coalesce={sql_uses_coalesce} edge={edge_uses_approved} ui_fallback={ui_uses_fallback}",
            "drift",
            "high",
        )
    )

    wrapper_calls = count_await_calls(r"await syncCustomerStage\(", exclude=FILES["crm_sync_wrapper"])
    direct_calls = count_await_calls(
        r"await syncDealStageFromStep\(",
        exclude_test_files=True,
    )
    # Única chamada direta permitida: dentro do wrapper conversion/crm-sync.ts
    direct_prod = [
        h for h in direct_calls
        if "crm-stage-sync.ts" not in h[0] and "conversion/crm-sync.ts" not in h[0]
    ]
    checks.append(
        Check(
            "DRIFT-02",
            "syncCustomerStage é o chokepoint único (wrapper usado, não bypass)",
            len(wrapper_calls) >= 3 and len(direct_prod) == 0,
            f"wrapper_calls={len(wrapper_calls)} direct_prod={len(direct_prod)}",
            "drift",
            "medium",
        )
    )

    ald_legacy = 'stage === "aprovado"' in ald or 'stage === "reprovado"' in ald
    checks.append(
        Check(
            "DRIFT-03",
            "AddLeadDialog sem lógica legada aprovado/reprovado em crm_deals",
            not ald_legacy,
            "approved_at/rejected_at removidos do insert",
            "drift",
            "low",
        )
    )

    cap_legacy_progression = "APPROVED_PROGRESSION" in cap or (
        '"aprovado"' in cap and "30_dias" in cap
    )
    checks.append(
        Check(
            "DRIFT-04",
            "crm-auto-progress não move deals lead em estágios pós-finalizando",
            not cap_legacy_progression,
            "Só linka deals órfãos" if not cap_legacy_progression else "Ainda tem progressão legada",
            "drift",
            "high",
        )
    )

    cron_scheduled = "crm-auto-progress" in cron
    link_only = "unlinkedDeals" in cap and "APPROVED_PROGRESSION" not in cap
    checks.append(
        Check(
            "DRIFT-05",
            "Cron crm-auto-progress restrito a link órfão (sem progressão legada)",
            link_only,
            "pg_cron ativo" if cron_scheduled else "cron desagendado",
            "drift",
            "medium",
        )
    )

    compute_uses_approved = "pos_venda_approved_at" in unify and "stamp_pos_venda_approved_at" in unify
    checks.append(
        Check(
            "DRIFT-06",
            "compute/recompute e trigger usam pos_venda_approved_at",
            compute_uses_approved,
            "20260613110000_crm_pos_venda_unify.sql",
            "drift",
            "high",
        )
    )

    return checks


def main() -> int:
    parser = argparse.ArgumentParser(description="Auditoria regras CRM")
    parser.add_argument("--json", action="store_true", help="Saída JSON")
    args = parser.parse_args()

    checks = run_checks()
    invariants = [c for c in checks if c.category == "invariant"]
    drifts = [c for c in checks if c.category == "drift"]

    inv_ok = sum(1 for c in invariants if c.ok)
    drift_ok = sum(1 for c in drifts if c.ok)

    payload = {
        "invariants": {"passed": inv_ok, "total": len(invariants)},
        "drift": {"resolved": drift_ok, "total": len(drifts)},
        "checks": [asdict(c) for c in checks],
    }

    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print("=" * 72)
        print("AUDITORIA CRM — regras, sync e drift arquitetural")
        print("=" * 72)

        print("\n── INVARIANTES (não podem quebrar) ──")
        for c in invariants:
            icon = "✅" if c.ok else "❌"
            print(f"{icon} [{c.id}] {c.title}")
            print(f"    {c.detail}")

        print("\n── DRIFT (coexistência legado — corrigir pelo plano) ──")
        for c in drifts:
            icon = "✅" if c.ok else "⚠️"
            print(f"{icon} [{c.id}] {c.title}")
            print(f"    {c.detail}")

        print("\n" + "=" * 72)
        print(f"Invariantes: {inv_ok}/{len(invariants)} OK")
        print(f"Drift resolvido: {drift_ok}/{len(drifts)}")
        if inv_ok < len(invariants):
            print("FALHA: invariante quebrado — regressão real")
            return 2
        if drift_ok < len(drifts):
            print("PENDENTE: drift arquitetural detectado (ver plano de correção)")
            return 1
        print("TUDO OK — invariantes e drift resolvidos")
        return 0

    if inv_ok < len(invariants):
        return 2
    if drift_ok < len(drifts):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
