# Cérebro Ads — Política congelada 2026

> **Canônica completa:** [`docs/CEREBRO-ADS-OFICIAL.md`](./CEREBRO-ADS-OFICIAL.md) (Meta oficial + arquitetura + este resumo).

**Status:** congelada · **Escopo:** operação + `brain_config` · **Motor:** não redesenhar  
**Evidência:** prod Rafael `0c2711ad-…` · script `scripts/analysis/cerebro_ads_2026_analysis.py`  
**Context7:** Meta Marketing API (`/websites/developers_facebook_marketing-api`) — CBO/rebalance, learning stage, CAPI+ctwa_clid, 1 action_type

## Veredito (uma linha)

O Cérebro **protege e escala a âncora**; a Meta barateia. Formato oficial 2026: **1 CTWA · cidade da sede · budget concentrado · Advantage+**. MG-ROT multi-cidade fragmentava learning. Raio frio 50 km sem lista quente morreu cedo (SEDE).

## O que NÃO fazer

- Novo motor, `targeting_patch` automático, `create_object` genérico no cron.
- `brain_scale` em `MG-ROT-*` ou na âncora.
- Voltar `target_cpl_cents` para **200** (R$2) enquanto o mercado real está R$7–12.
- Semear `MG-ROT-*` com `geo_mode=radius_sede` / `max_explorers=0`.
- Criar campanha **sem** `initial_message` (frase CTWA).
- Exigir consultor preencher **DDD** (público automático via geo + audience).
- Patch semanal de código “para ver se melhora”.
- POST cego de targeting/idade em campanha ativa (reset de learning — incidente 23/07).

## Política operacional (congelar)

```
1 campanha cidade sede (molde UDI) → Cérebro protege + escala vertical → sem MG-ROT automático
```

| Alavanca | Valor congelado | Por quê |
|---|---|---|
| `geo_mode` | **`radius_sede`** | Config Cérebro concentrado (slots cidade off) |
| Geo da campanha 1-clique | **Cidade Meta da sede** | Evidência: cidade UDI > raio frio |
| `target_cpl_cents` | **750** (R$7,50) | Alvo realista; com 200 a escala nunca sobe |
| `max_explorers` | **0** | Só âncora até fase 3 |
| `require_initial_message` | **true** | Toda campanha CTWA exige frase WA |
| `explorer_budget_cents` | 517 | Piso Meta (só se reabrir exploração) |
| `anchor_budget_cents` | **≥ 3000** | Aprendizado (~R$30/dia mínimo no 1-clique) |
| `scale_step_pct` | 15 | Já no motor |
| Waste exploradora | R$10 zero-conv | Corta queima |
| Waste **âncora** | **R$40** zero-conv | Não matar com 3 cliques |
| `automation_mode` | `full` (piloto) | Waste/saldo já protegem; não desligar à toa |
| `mode` | `conservative` | — |

### Campanha Inteligente (1-clique)

1. Ícone Sparkles na Central de Anúncios → confirmação → `smart_anchor`.
2. Cria CTWA cidade sede + remarketing + criativo oferta + budget ≥ R$30.
3. Seta `anchor_campaign_id`, `target_cpl_cents=750`, `max_explorers=0`.
4. Escala: vertical primeiro; só depois 1 exploradora / raio (pedido explícito).

### Operação (Play / pausa)

1. Manter **só** a âncora (UUID em `anchor_campaign_id`).
2. Não reativar MG-ROT sem pedido explícito.
3. Próximas campanhas: **cidade da sede** + mensagem WA obrigatória; DDD só backend.
4. Medir CPL com 1 action (`pickMetaConversations`).

## KPIs — só reabrir debate se quebrar 3 dias

| KPI | Alerta | Crítico |
|---|---|---|
| CPL âncora (48h, 1 action Meta) | > R$8 | > R$12 |
| Taxa Ads → portal (14d) | < 10% | < 5% |
| Exploradoras ativas | > 0 sem pedido | > 1 |

## Alinhamento Meta (Context7)

- Rebalance / Advantage budget: **deslocar verba para top**, pausar high CPA — igual à política âncora-first.
- Learning stage: **não editar** ad set ativo sem diff real (~50 resultados/semana).
- CAPI + `ctwa_clid`: evento de valor pós-WA (já há caminho no projeto) > só conversa Meta.
- 1 `action_type` canônico (`pickMetaConversations`) — manter.

## Artefato reproduzível

```bash
python3 scripts/analysis/cerebro_ads_2026_analysis.py
```

## Como “parar de mexer”

1. `brain_config` piloto: `max_explorers=0`, `target_cpl=750`, âncora = Campanha Inteligente.
2. MG-ROT extras pausadas; escala vertical ligada.
3. Qualquer mudança de motor exige pedido explícito + KPI quebrado 3 dias.
4. Agentes: ler este doc + `#cerebro-mg-e-rodizio` + §5.7 do oficial antes de patch Ads.
