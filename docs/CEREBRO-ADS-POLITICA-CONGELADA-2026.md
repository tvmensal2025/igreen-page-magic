# Cérebro Ads — Política congelada 2026

> **Canônica completa:** [`docs/CEREBRO-ADS-OFICIAL.md`](./CEREBRO-ADS-OFICIAL.md) (Meta oficial + arquitetura + este resumo).

**Status:** congelada · **Escopo:** operação + `brain_config` · **Motor:** não redesenhar  
**Evidência:** prod Rafael `0c2711ad-…` · script `scripts/analysis/cerebro_ads_2026_analysis.py`  
**Context7:** Meta Marketing API (`/websites/developers_facebook_marketing-api`) — CBO/rebalance, learning stage, CAPI+ctwa_clid, 1 action_type

## Veredito (uma linha)

O Cérebro **protege e gira**; a Meta barateia. Formato oficial 2026: **1 CTWA · raio 50 km na sede · budget concentrado**. MG-ROT multi-cidade fragmentava learning.

## O que NÃO fazer

- Novo motor, `targeting_patch` automático, `create_object` genérico no cron.
- `brain_scale` em `MG-ROT-*` ou na âncora.
- Voltar `target_cpl_cents` para **200** (R$2) enquanto o mercado real está R$7–12.
- Semear `MG-ROT-*` com `geo_mode=radius_sede` / `max_explorers=0`.
- Criar campanha **sem** `initial_message` (frase CTWA).
- Patch semanal de código “para ver se melhora”.
- POST cego de targeting/idade em campanha ativa (reset de learning — incidente 23/07).

## Política operacional (congelar)

```
1 campanha sede 50 km → Cérebro protege + escala âncora → sem MG-ROT automático
```

| Alavanca | Valor congelado | Por quê |
|---|---|---|
| `geo_mode` | **`radius_sede`** | Formato Meta concentrado |
| `sede_radius_km` | **50** | Sede Jaraguá/UDI |
| `target_cpl_cents` | **750** (R$7,50) | Alvo realista; com 200 a escala nunca sobe |
| `max_explorers` | **0** | Só âncora; sem slots cidade |
| `require_initial_message` | **true** | Toda campanha CTWA exige frase WA |
| `explorer_budget_cents` | 517 | Piso Meta (só se reabrir exploração) |
| `anchor_budget_cents` | **1500** | Concentrar na vencedora (Meta premia volume) |
| `scale_step_pct` | 15 | Já no motor |
| `automation_mode` | `full` (piloto) | Waste/saldo já protegem; não desligar à toa |
| `mode` | `conservative` | — |

### Operação (Play / pausa)

1. Manter **só** a âncora sede (`SEDE-UDI-50km` · UUID em `anchor_campaign_id`).
2. Não reativar MG-ROT sem pedido explícito.
3. Próximas campanhas: **raio na sede** + **mensagem inicial WhatsApp obrigatória** (única).
4. Medir CPL com 1 action (`pickMetaConversations`).
5. Waste a R$10: se não tocar constante, **pausar manual** antes dos R$10.

### Única constante de código permitida (se um dia tocar)

`WASTE_ZERO_CONV_SPEND_CENTS`: 1000 → **600**. Nada mais no waste/escala/rotator sem pedido explícito.

## KPIs — só reabrir debate se quebrar 3 dias

| KPI | Alerta | Crítico |
|---|---|---|
| CPL âncora (48h, 1 action Meta) | > R$8 | > R$12 |
| Taxa Ads → portal (14d) | < 10% | < 5% |
| Exploradoras ativas | > 0 sem pedido | > 1 |

## Alinhamento Meta (Context7)

- Rebalance / Advantage budget: **deslocar verba para top**, pausar high CPA — igual à política âncora-first.
- Learning stage: **não editar** ad set ativo sem diff real.
- CAPI + `ctwa_clid`: evento de valor pós-WA (já há caminho no projeto) > só conversa Meta.
- 1 `action_type` canônico (`pickMetaConversations`) — manter.

## Artefato reproduzível

```bash
python3 scripts/analysis/cerebro_ads_2026_analysis.py
```

## Como “parar de mexer”

1. `brain_config` piloto já na sede (`max_explorers=0`, `geo_mode=radius_sede`).
2. MG-ROT extras pausadas; âncora sede no ar.
3. Qualquer mudança de motor exige pedido explícito + KPI quebrado 3 dias.
4. Agentes: ler este doc + `#cerebro-mg-e-rodizio` antes de patch Ads.
