## Status atual

✅ **Já aplicado em código** (commits anteriores):
- `_shared/flow-router.ts` → `_norm` agora tira acentos (`NFD` + strip diacritics)
- `_shared/engine/helpers.ts` → `norm` idem

Isso já resolve `rápida` ↔ `rapida` para **qualquer lead novo** que clicar no botão "💡 Simulação rápida" daqui pra frente.

⚠️ **Ainda falta aplicar** (1 migration):

### Migration única em `bot_flow_steps`

Passo `d_escolher_simulacao` (id `b1a53333-3333-4333-8333-000000000003`):

1. **fallback** muda de `{mode:'goto', goto_step_id:'…d_como_funciona'}` para `{mode:'repeat'}`.
   → Se o lead escrever algo que não casa, o bot repete a pergunta com os 2 botões em vez de jogar pro vídeo institucional.

2. **trigger_phrases** ganham variantes extras (defesa em profundidade, caso a normalização do canal devolva texto diferente):
   - `simular_rapida`: + `simulacao rapida`, `simulação rápida`, `rapido`, `rápido`, `quero rapida`, `quero rápida`
   - `simular_completa`: + `simulacao completa`, `simulação completa`, `quero completa`, `foto da conta`, `mandar conta`

## Fora de escopo (confirmado)

- ❌ **Não vou mexer nos leads antigos** (Heloísa, Deus e fiel, ROBERTO, Keh, BRUNO) — eles ficam como estão.
- ❌ Não tocar em `d_welcome`, `d_como_funciona`, Gemini, UI do editor.

## Resultado esperado

Próximo lead que clicar "💡 Simulação rápida" → engine casa por acento-insensível → vai pra `d_simular_valor` corretamente. Qualquer texto solto cai no `repeat` (mostra os botões de novo) em vez de pular pro vídeo institucional.

## Arquivos

- 1 migration `UPDATE bot_flow_steps WHERE id = 'b1a53333-…-0003'` (sem CREATE, sem GRANT — só update de dados)
