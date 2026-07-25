# AGENTS — Cérebro (`_shared/cerebro`)

Produção = `resposta-hook.ts` (`responderComCerebro`).  
Simulador = `fluxo-b-ai` (dryRun default true) — **não** é este diretório.

## Canônico obrigatório
Ver `#cerebro-fluxo-b` (**always** no pack) + rule Cursor `cerebro-vs-grupo-a` + armadilha #36.

**Grupo A manda no cadastro.** Cérebro não substitui OCR/portal/passos esperados.

| Situação | Quem responde |
|---|---|
| Variante A + em cadastro | Determinístico (`fluxo-a-bypass`) |
| Cadastro + input esperado | Determinístico |
| Cadastro + pergunta livre | Cérebro (sem mudar step) |
| Fora do cadastro / carteira | Cérebro |
| Lead silencioso | Cadência A (não Cérebro) |

Ativação: `consultants.cerebro_ativo` opt-in (default `off`), modal `CEREBRO_OPT_IN`.

Fail-open. Não tocar anti-ban/dedupe aqui.  
Cross-sell neste folder = sombra por padrão (`CROSS_SELL_SHADOW`).

Proibido: restaurar `_shared/vendedora/`; confundir com Cérebro Ads/MG.
