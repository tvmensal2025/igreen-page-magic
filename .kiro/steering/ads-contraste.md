---
inclusion: auto
name: ads-contraste
description: Contraste de status na UI Ads. Use ao editar chips/alerts/badges Ads.
---

# Ads — contraste de status

Nunca texto mid-tone sobre tint da mesma cor.

## Proibido
- `text-warning` + `bg-warning/15`
- `text-destructive` + `bg-destructive/10` no **corpo**
- Status + `opacity-70/80`
- `--warning`/`--info` globais em chips dentro de `.ads-central-2026`

## Padrão
| Papel | Token |
|---|---|
| Fundo tint | `--ads-warn\|danger\|emerald` / .08–.12 |
| Título/ícone | `--ads-*-fg` |
| Corpo | `--ads-text` / `--ads-muted` |
| Chips | `.ads-chip-ok\|warn\|danger\|info\|muted` |
| Alerta | `.ads-alert-danger` + `.ads-alert-title` |

## Campanha Inteligente / escala (produto)

- Ícone 1-clique na Central: molde cidade sede + Cérebro âncora — ver `#cerebro-mg-e-rodizio` e `docs/CEREBRO-ADS-OFICIAL.md` §5.7.
- Não mostrar chips DDD ao consultor no fluxo de criar; público automático.
- Badge **Âncora** na lista quando `id === brain_config.anchor_campaign_id`.
