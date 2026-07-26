"""Análise profunda Cérebro Ads Rafael — 2026 (somente leitura/cálculo).

Não altera motor. Consolida evidência prod + política Meta (Context7) +
playbook Campanha Inteligente (cidade sede + escala vertical).
"""

from __future__ import annotations

from dataclasses import dataclass


def brl(cents: float | None) -> str:
    if cents is None:
        return "—"
    return (
        f"R$ {cents / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    )


def cpl(spend: int, conv: int) -> float | None:
    if conv <= 0:
        return None
    return spend / conv


@dataclass(frozen=True)
class Window:
    label: str
    spend: int
    conv: int
    imps: int = 0
    clicks: int = 0

    @property
    def cpl_cents(self) -> float | None:
        return cpl(self.spend, self.conv)

    @property
    def ctr_bps(self) -> float | None:
        if self.imps <= 0:
            return None
        return self.clicks * 10000 / self.imps


# Série diária (prod facebook_metrics_daily, consultor Rafael)
DAILY: list[tuple[str, int, int, int, int]] = [
    # date, spend, conv, imps, clicks
    ("2026-07-08", 4774, 21, 3166, 45),
    ("2026-07-09", 7777, 21, 5191, 52),
    ("2026-07-10", 6806, 33, 4984, 69),
    ("2026-07-11", 7403, 27, 5390, 64),
    ("2026-07-12", 8253, 46, 6421, 78),
    ("2026-07-13", 1990, 14, 1531, 22),
    ("2026-07-14", 634, 1, 342, 8),
    ("2026-07-19", 780, 2, 378, 5),
    ("2026-07-20", 3653, 6, 903, 18),
    ("2026-07-21", 3145, 3, 821, 16),
    ("2026-07-22", 5604, 5, 1266, 27),
    ("2026-07-23", 4478, 3, 1207, 27),
    ("2026-07-24", 3442, 2, 883, 26),
    ("2026-07-25", 926, 1, 171, 3),
]

# Ranking real (gasto total conhecido) — name, spend_cents, conv
RANKING: list[tuple[str, int, int]] = [
    ("Jaraguá (multi-raio)", 29665, 151),
    ("Rua João Carlos 3km (vídeo)", 11700, 48),
    ("remarketing-uberlandia (cidade)", 10104, 15),
    ("Brasilândia / Horacio (vídeo)", 5800, 12),
    ("SEDE-UDI-50km / CPL / MG-ROT fracos", 1011, 0),
]

# Campanhas-chave (era boa 08–13 vs era cara 19–25)
CAMPAIGNS = [
    # name, spend_good, conv_good, spend_bad, conv_bad
    ("Jaraguá (raio multi-cidade) [PAUSADA]", 29665, 147, 0, 0),
    ("Horacio Brasilândia [PAUSADA]", 5139, 12, 0, 0),
    ("remarketing-uberlandia (cidade) [molde]", 0, 0, 10104, 15),
    ("MG-ROT exploradoras (soma)", 0, 0, 7015, 5),
    ("Waste queimado (AUTO_PERF/SEDE)", 0, 0, 5216, 0),
]

# Config política oficial (pós Campanha Inteligente)
CURRENT = {
    "automation_mode": "full",
    "autopilot": True,
    "kill_switch": False,
    "target_cpl_cents": 750,
    "max_explorers": 0,
    "explorer_budget_cents": 517,
    "anchor_budget_cents_cfg": 3000,
    "anchor_budget_live_cents": 3000,
    "waste_zero_conv_cents": 1000,
    "waste_anchor_zero_conv_cents": 4000,
}

# Funil 14d
FUNNEL = {"ads_leads": 40, "portal": 2, "portal_rate": 0.05}

# Meta / Context7 principles (Marketing API)
META_PRINCIPLES = [
    "CTWA: OUTCOME_ENGAGEMENT + destination WHATSAPP + optimize CONVERSATIONS",
    "Advantage+ audience/placements + budget concentrado na âncora",
    "Learning stage: ~50 resultados/semana; evitar editar ad set sem diff",
    "CAPI + ctwa_clid: evento de valor pós-mensagem",
    "1 action_type canônico (pickMetaConversations)",
]


def sum_window(start: str, end: str) -> Window:
    spend = conv = imps = clicks = 0
    for d, s, c, i, k in DAILY:
        if start <= d <= end:
            spend += s
            conv += c
            imps += i
            clicks += k
    return Window(f"{start}→{end}", spend, conv, imps, clicks)


def simulate_policies() -> list[dict[str, object]]:
    """Simula custo diário teórico sob políticas (sem mudar motor)."""
    anchor_cpl = 674  # remarketing UDI
    explorer_cpl = 1403
    rows: list[dict[str, object]] = []
    for name, explorers, waste_cents, anchor_budget in [
        ("Fragmentado (4 exploradoras + waste R$10)", 4, 1000, 517),
        ("Âncora-only R$30 + waste âncora R$40", 0, 4000, 3000),
        ("Âncora R$50 escalada + 0 exploradora", 0, 4000, 5000),
        ("Âncora estável + 1 exploradora (fase 3)", 1, 1000, 5000),
    ]:
        day_budget = anchor_budget + explorers * 517
        explore_tax = explorers * (waste_cents * 0.35)
        anchor_leads = anchor_budget / anchor_cpl
        explorer_leads = (explorers * 517) / explorer_cpl if explorers else 0
        total_leads = anchor_leads + explorer_leads
        blended = day_budget / total_leads if total_leads else None
        rows.append(
            {
                "policy": name,
                "day_budget_cents": day_budget,
                "explore_tax_est_cents": round(explore_tax),
                "leads_day_est": round(total_leads, 2),
                "blended_cpl_cents": round(blended) if blended else None,
            }
        )
    return rows


def frozen_policy_2026() -> dict[str, object]:
    """Política congelada — Campanha Inteligente + escala vertical."""
    return {
        "principio": (
            "1-clique cidade sede → aprender → escala vertical → "
            "só então 1 exploradora → multi-consultor"
        ),
        "brain_config": {
            "target_cpl_cents": 750,
            "max_explorers": 0,
            "explorer_budget_cents": 517,
            "anchor_budget_cents": 3000,
            "scale_step_pct": 15,
            "automation_mode": "full",
            "kill_switch": False,
            "mode": "conservative",
            "geo_mode": "radius_sede",
        },
        "waste_guard": {
            "WASTE_ZERO_CONV_SPEND_CENTS": 1000,
            "WASTE_ANCHOR_ZERO_CONV_SPEND_CENTS": 4000,
            "nota": "Âncora precisa de pista; exploradora corta cedo",
        },
        "smart_anchor": {
            "geo": "cidade Meta da sede (não raio frio 50km)",
            "is_remarketing": True,
            "budget_min_cents": 3000,
            "creative": "oferta 28% / Simule no zap",
            "ddd": "só backend",
        },
        "operacao_sem_codigo": [
            "Usar Campanha Inteligente (ícone) em vez de N MG-ROT",
            "Trocar criativo se CPL sobe 2 dias (cansaço), não matar a praça",
            "Não PATCH targeting/idade em ativas (learning reset)",
            "Não pedir DDD ao consultor",
        ],
        "proibido_mexer_codigo": [
            "Não novo motor / targeting_patch automático / create_object genérico",
            "Não brain_scale em MG-ROT nem âncora",
            "Não baixar target de volta para R$2",
            "Não subir max_explorers sem âncora estável 3 dias",
        ],
        "kpi_congelados": {
            "cpl_ancora_alerta_cents": 800,
            "cpl_ancora_critico_cents": 1200,
            "portal_rate_min": 0.10,
            "revisao": "só se KPI quebrar 3 dias seguidos",
        },
    }


def main() -> None:
    era_boa = sum_window("2026-07-08", "2026-07-13")
    era_cara = sum_window("2026-07-19", "2026-07-25")
    print("=" * 72)
    print("CÉREBRO FACEBOOK — ANÁLISE + CAMPANHA INTELIGENTE 2026")
    print("=" * 72)
    print("\n## 1) Janelas")
    for w in (era_boa, era_cara):
        print(
            f"  {w.label}: gasto={brl(w.spend)} conv={w.conv} "
            f"CPL={brl(w.cpl_cents)} CTR_bps={w.ctr_bps and round(w.ctr_bps)}"
        )
    if era_boa.cpl_cents and era_cara.cpl_cents:
        print(
            f"  Δ CPL: {era_cara.cpl_cents / era_boa.cpl_cents:.1f}x pior na era cara"
        )

    print("\n## 2) Ranking real (gasto > 0)")
    for name, spend, conv in RANKING:
        print(f"  {name}: {brl(spend)} / {conv} → CPL {brl(cpl(spend, conv))}")

    print("\n## 3) O que performou por era")
    for name, sg, cg, sb, cb in CAMPAIGNS:
        print(
            f"  {name}\n"
            f"    boa: {brl(sg)} / {cg} → CPL {brl(cpl(sg, cg))}\n"
            f"    cara: {brl(sb)} / {cb} → CPL {brl(cpl(sb, cb))}"
        )

    jaragua_cpl = cpl(29665, 151)
    udi_cpl = cpl(10104, 15)
    print(
        f"\n  CONCLUSÃO: Jaraguá CPL {brl(jaragua_cpl)} · UDI cidade "
        f"{brl(udi_cpl)} — molde = cidade + budget + CONVERSATIONS."
    )

    print("\n## 4) Config política oficial")
    print(f"  target_cpl: {brl(CURRENT['target_cpl_cents'])}")
    print(f"  anchor budget: {brl(CURRENT['anchor_budget_live_cents'])}")
    print(f"  max_explorers: {CURRENT['max_explorers']}")
    print(
        f"  waste exploradora/âncora: "
        f"{brl(CURRENT['waste_zero_conv_cents'])} / "
        f"{brl(CURRENT['waste_anchor_zero_conv_cents'])}"
    )
    print(
        f"  Funil 14d Ads→portal: {FUNNEL['ads_leads']}→{FUNNEL['portal']} "
        f"({FUNNEL['portal_rate'] * 100:.0f}%)"
    )
    if udi_cpl:
        custo_portal = udi_cpl / FUNNEL["portal_rate"]
        print(f"  Custo implícito por PORTAL (se taxa 5%): {brl(custo_portal)}")

    print("\n## 5) Simulação de políticas (estimativa)")
    for row in simulate_policies():
        print(
            f"  {row['policy']}\n"
            f"    budget/dia={brl(row['day_budget_cents'])} "
            f"leads≈{row['leads_day_est']} "
            f"CPL misturado≈{brl(row['blended_cpl_cents'])} "
            f"taxa exploração≈{brl(row['explore_tax_est_cents'])}"
        )

    print("\n## 6) Princípios Meta (Context7 Marketing API)")
    for p in META_PRINCIPLES:
        print(f"  - {p}")

    print("\n## 7) POLÍTICA CONGELADA 2026")
    pol = frozen_policy_2026()
    print(f"  Princípio: {pol['principio']}")
    print(f"  brain_config: {pol['brain_config']}")
    print(f"  waste: {pol['waste_guard']}")
    print(f"  smart_anchor: {pol['smart_anchor']}")
    print("  Operação:")
    for x in pol["operacao_sem_codigo"]:  # type: ignore[union-attr]
        print(f"    • {x}")
    print("  Proibido:")
    for x in pol["proibido_mexer_codigo"]:  # type: ignore[union-attr]
        print(f"    • {x}")
    print(f"  KPIs: {pol['kpi_congelados']}")

    print("\n## 8) Veredito")
    print(
        "  Mais lead mais barato = 1 CTWA cidade sede + Cérebro escala vertical.\n"
        "  Campanha Inteligente (1-clique) bootstrapa âncora; waste R$40 na âncora;\n"
        "  DDD só backend; não fragmentar com MG-ROT até fase 3."
    )
    print("=" * 72)


if __name__ == "__main__":
    main()
