---
inclusion: manual
---

# Auditoria do pack steering (2026-07-23)

Fontes: docs Kiro (steering inclusion), AGENTS.md standard, gap vs `.cursor/rules`, Context7 Supabase auth.

## Achados
1. **Token bloat:** 14 files `always` (~750 linhas) em todo prompt — modelo fraco dilui regras.
2. **Zero `auto`** e quase zero `fileMatch` — domínio Portal/Club/Sync/Ads só no Cursor globs.
3. **Zero `#[[file:...]]`** — docs oficiais não eram linkados ao vivo.
4. **AGENTS.md** com YAML `inclusion` (inválido no padrão AGENTS) + duplicava always.
5. **Gaps de conteúdo:** portal ouro, club JWT, sync URL, cérebro 48h/15%, rodízio 180min, ads contraste.
6. **Domínios ainda finos:** pos-venda, wallet/Stripe, solar-3d, remote-support, flow-engine-v3, MinIO.
7. **Contradição:** `convencoes` dizia light-only vs tema dual.
8. **Analyzer Biome** não instalado no MCP (`@biomejs/biome` ausente) — lint TS via analyzer indisponível.

## Correções aplicadas nesta rodada
- Always enxuto: foundation + regras + armadilhas + helpers + idioma
- Domínio → `fileMatch` / `auto` / `manual`
- Novos: club, sync, cerebro+rodizio, ads-contraste, security-auth
- AGENTS.md limpo (padrão agents.md)
- `convencoes` tema dual; portal2 globs expandidos

## Round 2 (2026-07-23) — domínios secundários
Adicionados `fileMatch`/`auto`: `pos-venda`, `wallet-stripe`, `minio-storage`, `solar-3d`, `remote-support`, `flow-engine-v3`, `nomes-e-tema`.

## Ainda aberto (fino)
- Instalar Biome no analyzer MCP ou documentar `npm run lint`
- Fundir `projeto.md` residual com `product.md` se redundante
- Testar no Kiro painel Steering: always count ≤ 7
- Esteira multiproduto (`sale_stage_*` / `src/features/produtos/esteira`) se virar foco
