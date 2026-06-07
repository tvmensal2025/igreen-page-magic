# Roteiros determinísticos (10)

Cada roteiro é uma lista ordenada de mensagens do lead. O script avança a fala
apenas quando a vendedora responde. Se o roteiro acaba antes do fim natural,
o script para e marca `ended_by: "script_exhausted"`.

Os roteiros vivem em `scripts/run.ts` na constante `SCRIPTED_SCENARIOS`. Esta
referência documenta o INTENT de cada um e o critério de sucesso.

| id | perfil | turnos do lead | critério de sucesso |
|----|--------|----------------|---------------------|
| `happy-path-curto` | comprador decidido | oi → sim → Maria → 450 → quero → (foto) → (doc) → maria@x.com | chega a `portal_submitting` em ≤9 turnos, sem handoff |
| `happy-path-longo` | comprador curioso | igual + 2 perguntas no meio (quanto economiza, demora quanto) | chega a `portal_submitting`, etapa `consideracao` aparece, sem loop |
| `cetico-golpe` | já foi enganado | oi → isso é golpe? → e como funciona? → ok João → 300 → quero → foto → doc → e@x.com | trata objeção `golpe`, chega a portal |
| `objecao-boleto` | preocupado com cobrança | oi → vem boleto? → vão mandar dois? → ok Ana → 600 → quero → … | resposta toca tema boleto, conversa avança |
| `objecao-fidelidade` | trabalhador autônomo | oi → tem fidelidade? → posso cancelar? → ok Pedro → 280 → quero → … | resposta toca tema fidelidade |
| `objecao-obra-aluguel` | alugado | oi → moro de aluguel, dá? → e se eu mudar? → ok Júlia → 350 → quero → … | resposta toca obra/aluguel, sem pedir foto cedo |
| `objecao-prazo` | apressado | oi → quanto tempo demora? → e a economia começa quando? → ok Carlos → 500 → quero → … | trata prazo |
| `pede-foto-cedo` | trolling | oi → manda lá a foto → quero economizar → manda o que tem que fazer → … | bot **NÃO** pede foto antes de `interesse_confirmado=true` |
| `loop-mesma-duvida` | indeciso | oi → tem fidelidade? → tem fidelidade mesmo? → mas tem fidelidade? → ok → … | bot responde com VARIANTES diferentes (não repete frase) e/ou usa "como te falei" |
| `mudou-de-ideia` | desistente | oi → sim → Lúcia → 400 → quero → … → na verdade não quero → tchau | bot reconhece desistência, não força foto, encerra educado |

## Notas

- Os turnos podem ser ajustados conforme a vendedora responde — se ela pular
  uma etapa, o lead pula a pergunta correspondente.
- "(foto)" / "(doc)" são placeholders: o script envia `__MIDIA_CONTA__` e
  `__MIDIA_DOC__` como `inboundText` + injeta a flag correspondente em
  `customerState.midia_recebida` (mesmo formato que o webhook real injeta).
- Critério de sucesso é avaliado pelo REPORT.md a partir das heurísticas:
  - `chegou_portal` ← último `conversationStepUpdate === "portal_submitting"`
  - `foto_cedo` ← bot menciona "foto" / "conta de luz" antes de
    `fluxo_b_state.interesse_confirmado === true`
  - `loop` ← duas respostas consecutivas iguais (hash sha1 do texto trimado)
  - `repeticao` ← mesma resposta 3× numa janela de 5 turnos
