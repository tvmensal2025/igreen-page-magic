---
inclusion: manual
---

# Auditoria do pack steering

Última verificação contra código: **2026-07-23** (pós `08a27d1d7` + correções).

## Estado atual
- **Always:** 6 files (~196 LOC) — idioma, regras-duras, armadilhas, product, tech, structure
- **Auto:** ~10 (banco, edges, fluxos, helpers, nomes-e-tema, …)
- **fileMatch:** portal/club/sync/cérebro/ads/pos-venda/wallet/minio/solar/remote/engine-v3
- **AGENTS.md:** padrão agents.md (sem YAML); índice alinhado aos modes

## Verificado CORRETO no código
pos-venda (toggle, sem bot_global, marco `pos_venda_approved_at`) · wallet líquido · MinIO `igreen` · Club JWT · sync `d9v63q` · Portal extract · Whapi · `conversations` · `webhook_message_dedup` · tema dual · `#[[file:]]` existentes · AGENTS `#refs` batem com stems

## Correções pós-auditoria
1. Engine V3: takeover só `'on'` ou `use_engine_v3` — não dark/canary
2. MinIO fallback `whatsapp-media` = **público** (`getPublicUrl`)
3. AGENTS: `helpers-canonicos` saiu da lista always (é `auto`)
4. fileMatch engine inclui whapi/evolution webhooks

## Riscos residuais
- Globs largos (`*Club*`, `*igreen*`, ads/**) podem puxar contexto a mais
- `projeto.md` (auto) overlap com `product.md` (always)
- Pós-venda **não** respeita kill switch global — só toggle próprio (fato do código)
- Esteira multiproduto (`sale_stage_*`) ainda sem steering dedicado
