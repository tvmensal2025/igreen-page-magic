"""Análise profunda Cérebro Ads Rafael — 2026 (somente leitura/cálculo).

Não altera motor. Consolida evidência prod + política Meta (Context7) +
proposta congelada operacional.
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

# Campanhas-chave (era boa 08–13 vs era cara 19–25)
CAMPAIGNS = [
    # name, spend_good, conv_good, spend_bad, conv_bad
    ("Jaraguá (raio multi-cidade) [PAUSADA]", 29665, 147, 0, 0),
    ("Horacio Brasilândia [PAUSADA]", 5139, 12, 0, 0),
    ("remarketing-uberlandia ÂNCORA [ATIVA]", 0, 0, 10104, 15),
    ("MG-ROT exploradoras (soma ativa/pausada)", 0, 0, 7015, 5),
    ("Waste queimado (AUTO_PERF/UDI-CPL)", 0, 0, 5216, 0),
]

# Config atual brain_config Rafael
CURRENT = {
    "automation_mode": "full",
    "autopilot": True,
    "kill_switch": False,
    "target_cpl_cents": 200,
    "max_explorers": 4,
    "explorer_budget_cents": 517,
    "anchor_budget_cents_cfg": 1000,
    "anchor_budget_live_cents": 517,
    "waste_zero_conv_cents": 1000,
}

# Funil 14d
FUNNEL = {"ads_leads": 40, "portal": 2, "portal_rate": 0.05}

# Meta / Context7 principles (Marketing API)
META_PRINCIPLES = [
    "Advantage Campaign Budget / rebalance: deslocar verba para top performers, pausar high CPA",
    "Learning stage: evitar editar ad set ativo sem necessidade (reset de aprendizado)",
    "CAPI + ctwa_clid: otimizar com evento de valor pós-mensagem, não só conversa Meta",
    "cost_per_action_type / cost_per_result: 1 action_type canônico (já corrigido no projeto)",
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
    anchor_cpl = 674  # 7d âncora
    explorer_cpl = 1403
    rows: list[dict[str, object]] = []
    for name, explorers, waste_cents in [
        ("Atual (4 exploradoras + waste R$10)", 4, 1000),
        ("Remendo (2 exploradoras + waste R$10)", 2, 1000),
        ("Defesa 2026 (0–1 exploradora + waste R$6)", 1, 600),
        ("Âncora-only (0 exploradora)", 0, 600),
    ]:
        # orçamento diário teórico
        day_budget = 517 + explorers * 517
        # queima esperada por exploradora morta até waste (aprox 1 ciclo)
        explore_tax = explorers * (waste_cents * 0.35)  # nem toda exploradora morre
        # leads/dia se âncora mantém CPL e exploradoras no CPL médio
        anchor_leads = 517 / anchor_cpl
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
    """Política congelada — só CONFIG / operação, sem redesenhar motor."""
    return {
        "principio": "Âncora primeiro → explorar 0–1 → matar rápido → escalar só com CPL ok",
        "brain_config": {
            "target_cpl_cents": 750,  # R$7,50 realista pós-queda
            "max_explorers": 1,  # código atual não aceita 0 (clamp min=1)
            "explorer_budget_cents": 517,
            "anchor_budget_cents": 1500,  # concentrar, não espalhar
            "scale_step_pct": 15,
            "automation_mode": "full",  # mantém; proteções waste/saldo sempre on
            "kill_switch": False,
            "mode": "conservative",
        },
        "waste_guard_desejado": {
            "WASTE_ZERO_CONV_SPEND_CENTS": 600,
            "nota": "ÚNICA mudança de constante permitida se for tocar código; senão Play manual mais cedo",
        },
        "operacao_sem_codigo": [
            "Pausar MG-ROT Uberaba, Araguari e qualquer CPL>R$10",
            "Manter só UDI + no máx 1 de Patos/Divinópolis",
            "NÃO reativar Jaraguá cega — estudar criativo/ângulo que gerou 147 conv @ ~R$2",
            "Não PATCH targeting/idade em ativas (learning reset — incidente 23/07)",
            "Congelar preferred_slugs; rank só semanal, não a cada tick mental",
        ],
        "proibido_mexer_codigo": [
            "Não novo motor / targeting_patch automático / create_object genérico",
            "Não brain_scale em MG-ROT nem âncora",
            "Não baixar target de volta para R$2",
            "Não subir max_explorers acima de 2 enquanto CPL âncora > R$8",
        ],
        "kpi_congelados": {
            "cpl_ancora_alerta_cents": 800,
            "cpl_ancora_critico_cents": 1200,
            "portal_rate_min": 0.10,
            "revisao": "só se KPI quebrar 3 dias seguidos — não a cada conversa",
        },
    }


def main() -> None:
    era_boa = sum_window("2026-07-08", "2026-07-13")
    era_cara = sum_window("2026-07-19", "2026-07-25")
    print("=" * 72)
    print("CÉREBRO FACEBOOK — ANÁLISE PROFUNDA 2026 (Rafael)")
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

    print("\n## 2) O que realmente performou (causa raiz)")
    for name, sg, cg, sb, cb in CAMPAIGNS:
        print(
            f"  {name}\n"
            f"    boa: {brl(sg)} / {cg} → CPL {brl(cpl(sg, cg))}\n"
            f"    cara: {brl(sb)} / {cb} → CPL {brl(cpl(sb, cb))}"
        )

    jaragua_cpl = cpl(29665, 147)
    udi_cpl = cpl(10104, 15)
    print(
        f"\n  CONCLUSÃO: Jaraguá CPL {brl(jaragua_cpl)} vs âncora atual "
        f"{brl(udi_cpl)} — o Cérebro MG NÃO é a máquina da era barata."
    )

    print("\n## 3) Config atual vs realidade")
    print(f"  target_cpl configurado: {brl(CURRENT['target_cpl_cents'])}")
    print(
        f"  âncora live budget: {brl(CURRENT['anchor_budget_live_cents'])} (piso Meta)"
    )
    print(
        f"  max_explorers: {CURRENT['max_explorers']} × {brl(CURRENT['explorer_budget_cents'])}"
    )
    print(f"  waste zero-conv: {brl(CURRENT['waste_zero_conv_cents'])}")
    print(
        f"  Funil 14d Ads→portal: {FUNNEL['ads_leads']}→{FUNNEL['portal']} "
        f"({FUNNEL['portal_rate'] * 100:.0f}%)"
    )
    if udi_cpl:
        custo_portal = udi_cpl / FUNNEL["portal_rate"]
        print(f"  Custo implícito por PORTAL (se taxa 5%): {brl(custo_portal)}")

    print("\n## 4) Simulação de políticas (estimativa)")
    for row in simulate_policies():
        print(
            f"  {row['policy']}\n"
            f"    budget/dia={brl(row['day_budget_cents'])} "
            f"leads≈{row['leads_day_est']} "
            f"CPL misturado≈{brl(row['blended_cpl_cents'])} "
            f"taxa exploração≈{brl(row['explore_tax_est_cents'])}"
        )

    print("\n## 5) Princípios Meta (Context7 Marketing API)")
    for p in META_PRINCIPLES:
        print(f"  - {p}")

    print("\n## 6) POLÍTICA CONGELADA 2026 (não ficar remendando)")
    pol = frozen_policy_2026()
    print(f"  Princípio: {pol['principio']}")
    print(f"  brain_config: {pol['brain_config']}")
    print(f"  waste desejado: {pol['waste_guard_desejado']}")
    print("  Operação sem código:")
    for x in pol["operacao_sem_codigo"]:  # type: ignore[union-attr]
        print(f"    • {x}")
    print("  Proibido:")
    for x in pol["proibido_mexer_codigo"]:  # type: ignore[union-attr]
        print(f"    • {x}")
    print(f"  KPIs: {pol['kpi_congelados']}")

    print("\n## 7) Veredito")
    print(
        "  O Cérebro ESTÁ ligado (waste/slots/rank), mas otimiza o arranjo ERRADO:\n"
        "  espalha exploração pós-queda + alvo R$2 irreal + waste tarde.\n"
        "  Melhor 2026 = CONGELAR política âncora-first + config única +\n"
        "  operação Play/pausa — SEM novo motor e SEM patch semanal de código."
    )
    print("=" * 72)


if __name__ == "__main__":
    main()
