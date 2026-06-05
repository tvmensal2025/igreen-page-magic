
# Auditoria revisada — fluxo D step `d_resultado` (lead 5511971254913)

Estado real do lead: `previous_conversation_step = d_resultado`, slot `fazenda_solar`, consultor `igreen-953f7e48509b`. Texto cru do step:

```
Pronto, {{nome}}! 🎉
💡 Sua conta hoje: *R$ {{valor_conta}}*
💚 Economia estimada: *{{economia_range}}* por mês
…
```

## Bugs confirmados (5)

### B1 — Placeholders `{{valor_conta}}` e `{{economia_range}}` vão crus para o WhatsApp
`bot-flow.ts` linhas 1208-1218: o dispatch monta um `vars` local **só com `{{nome}}`, `{{nome_completo}}`, `{{representante}}`** e usa um `applyVars` ad-hoc. As variáveis de economia só são injetadas em outros dois caminhos (linhas 2489 e 3295) — não no dispatcher principal de `d_resultado`. `_shared/render-vars.ts` já sabe calcular `economia_range` a partir de `valor_conta` (linha 110), mas não é chamado aqui. Por isso o lead leu `R$ {{valor_conta}}` literal.

### B2 — Áudio público enviado num step onde o consultor não subiu mídia
`ai_media_library` para `consultant_id=953f…` + `slot=fazenda_solar` = 0 linhas. Fallback público (linha 1188-1198) acha 1 item ativo: áudio `fazenda_solar_1778939279397.ogg`. Resultado: bot enviou áudio "alheio".

### B3 — Mensagem duplicada
Dedupe atual (`canSendMediaOnce`) só cobre **mídia**, não texto/step inteiro. Reentradas próximas (típico quando o usuário toca botão e digita) re-disparam o dispatcher e re-enviam texto + áudio.

### B4 — Áudio "atrasado" / fluxo fora de ordem
`media_order = [audio, image, video, text]`, mas só existem áudio (público) + texto. Sleep de 5000ms + `duration_sec=44s` é aplicado antes do próximo item mesmo quando o item foi pulado, então o texto aparece muito depois do áudio.

### B5 — `customers.conversation_step` salvo como `flow:<uuid>` em vez de `step_key`
Valor atual: `flow:dfa0e6d9-9a3e-4750-9be1-6dcfa6e72ad9` (id do flow, não do step). Quebra `bot-stuck-recovery`, auditoria e retomada — e provavelmente é o que permitiu o reentry de B3.

## O plano anterior cobre B2/B3/B4/B5 mas **não cobre B1**

| Bug | Plano anterior | Cobre? |
|-----|---------------|--------|
| B1 placeholders | — | ❌ |
| B2 áudio público | item 1 (bloquear fallback de áudio) + item 2 (HEAD-check) | ✅ |
| B3 duplicação | item 3 (dedupe de step) | ✅ |
| B4 sleep cego | item 5 (sleep só se anterior=sent) | ✅ |
| B5 conversation_step | item 4 (gravar step_key real) | ✅ |

## Plano atualizado (a aplicar após aprovação)

1. **Trocar `applyVars` ad-hoc por `renderVars()` de `_shared/render-vars.ts`** em `bot-flow.ts` (~linhas 1208-1218 do dispatcher principal e ~5017 do caminho legado), passando `{ nome, representante, valor_conta: customer.electricity_bill_value }`. `renderVars` já calcula `economia_range`, `economia_mensal`, `economia_anual`. ⇒ Corrige B1.

2. **Bloquear fallback público de áudio quando o consultor não subiu mídia pessoal no slot.** Em `bot-flow.ts` ~1191, após `publicRows`, filtrar `kind==="audio"`. ⇒ Corrige B2.

3. **HEAD-check em URLs públicas antes de `sendAudio/sendMedia`** e auto-desativar (`active=false`) registros que retornarem 4xx/5xx — limpa o `84aee314…` se já estiver órfão no MinIO. ⇒ Reforça B2.

4. **Dedupe por step inteiro** (`canDispatchStepOnce(customer_id, step_key, window=10s)`), estendendo `media-dedupe.ts`. ⇒ Corrige B3.

5. **Persistir `conversation_step` com o `step_key` real**, nunca `flow:<uuid>`. Auditar todos os `update({ conversation_step })` do `bot-flow.ts`. ⇒ Corrige B5.

6. **Sleep proporcional só se item anterior foi `sent=true`**; pular sleep se item anterior foi descartado. ⇒ Corrige B4.

## Validação pós-fix
- Reset do telefone `11971254913` → `Oi` → `2`.
- Esperado em `d_resultado`: **texto único** com "Sua conta hoje: R$ 250,00" e "Economia estimada: R$ 35,00 – R$ 60,00 por mês" (renderizados), **sem áudio**, sem duplicação.
- `customers.conversation_step = 'd_resultado'` (não `flow:…`).
- `outbound_message_log`: exatamente 1 linha por step.

## Risco
Baixo. Todas as mudanças em `bot-flow.ts` + `media-dedupe.ts` + `render-vars.ts` (sem alterar schema, sem alterar RLS, sem mexer em RPCs admin).
