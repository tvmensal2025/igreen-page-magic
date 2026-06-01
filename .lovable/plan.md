## Fix: reemitir botões após resposta do Gemini no `d_duvidas`

### Problema
Em `supabase/functions/whapi-webhook/handlers/bot-flow.ts:1147-1206`, o handler do passo de dúvidas envia o texto do Gemini e retorna — sem reemitir os botões do passo. O CTA "toque numa das opções acima" fica órfão, e o lead trava.

### Mudança
Logo após o `sendText(remoteJid, answerText)` (linha 1165) e o `insert` em `conversations`, enviar uma **segunda mensagem interativa** com:

- Texto curto: pergunta do `stepRow.message_text` resumida (ou padrão: "O que você prefere fazer agora?")
- Botões lidos de `stepRow.captures` (`_buttons`) — mesma lógica que já existe na linha 1211-1221 mais abaixo.

Skip a reemissão quando:
- `orch.shouldHandoff === true` (lead vai pra humano, não faz sentido botão)
- o passo não tem `_buttons` configurados
- `ai_followups_count >= 3` (anti-loop — deixa o handoff acontecer)

### Como mandar os botões
Já existe helper no projeto. Vou usar o mesmo caminho que o dispatch normal usa mais abaixo no arquivo (a função `sendInteractive` / `sendButtons` que já é importada no topo de `bot-flow.ts`). Sem inventar novo helper.

### Arquivo alterado
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts` — bloco de ~15 linhas inserido entre o `insert` (linha 1172) e o `if (orch.shouldHandoff)` (linha 1174).

### Fora de escopo
- Não mexer no orquestrador, no Gemini, na normalização, nem em outros steps.
- Não alterar leads antigos.
- Não tocar no segundo ponto de chamada do orquestrador (linha 1985) — esse já retorna o reply pra outro caminho que reemite o step naturalmente.
