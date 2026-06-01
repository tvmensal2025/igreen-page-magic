## Diagnóstico do fluxo do 5511971254913 (BRUNO MANOEL DOS SANTOS)

### Timeline real (tabela `conversations` + `bot_step_transitions`)

```text
12:18:15  inbound  "✅ Sim, é meu"              → ask_phone_confirm OK → ask_email
12:18:20  outbound ask_email                    "📧 Qual o seu melhor e-mail?"
12:18:37  inbound  "Rafael.ids@icloud.com. br"  (email do consultor + espaço)
12:18:44  outbound ask_email                    "⚠️ Email do consultor não pode..."
12:18:55  inbound  "Tvmensal153@gmail.com"      (email válido do lead)
12:19:06  inbound  "✅ Finalizar"               (botão btn_finalizar)
12:19:09  outbound flow:d_pedir_email           "Falta pouco, BRUNO! Me passa seu e-mail..."
12:19:11  transition ask_email → aguardando_humano (reason: dados_incompletos_pos_loop)
12:19:12  outbound aguardando_humano            "Vou te encaminhar para um consultor..."
```

### Estado final do customer

| Campo | Valor gravado | Esperado |
|---|---|---|
| `email` | `rafael.ids@icloud.com` ❌ (consultor) | `tvmensal153@gmail.com` |
| `address_complement` | `Rafael.ids@icloud.com. br` ❌ (resto do email) | vazio / "Apto X" |
| `rescue_attempts` | 1 | 0 |
| `bot_paused_reason` | `dados_incompletos_pos_loop` | nenhum |
| `conversation_step` | `aguardando_humano` | `finalizando` ou `ask_complement` |

### O que aconteceu (3 bugs encadeados)

**Bug 1 — Validação de email aceita string com espaço interno**
`isValidEmailFormat("Rafael.ids@icloud.com. br")` provavelmente passou (o regex tolera o ". br" final ou o sanitize fez `split(" ")[0]`), e o `isSameContact` reconheceu o email do consultor. Antes de o consultor-check rejeitar, **algum caminho upstream gravou `email = rafael.ids@icloud.com` e o "lixo" `". br"` foi parar em `address_complement`** (provavelmente o resolver de captura caiu no próximo step `ask_complement` e usou o segundo token). Isso contaminou o cadastro.

**Bug 2 — `getNextMissingStep` não detecta email do consultor**
Após o segundo turno (com `Tvmensal153@gmail.com`), o campo `email` já valia `rafael.ids@icloud.com`. O `getNextMissingStep` em `_shared/conversation-helpers.ts` só rejeita emails que batem `@lead.igreen$|@teste|^teste@|^noreply@|^sem_email`. Email do consultor **não** está na lista → considera "email ok" e tenta seguir. Mas o lead continuou em `ask_email` (porque o handler do step exigia novo email do próprio lead). Resultado: bot ficou rodando o handler `ask_email` mesmo com email "preenchido", e o segundo email válido digitado foi descartado em algum ponto da pipeline (provavelmente pelo `whatsapp_message_buffer` que coalesceu com o `"✅ Finalizar"` posterior).

**Bug 3 — `ANTI-LOOP` escala para humano em vez de avançar**
Quando o lead clicou `btn_finalizar` (12:19:06), o engine v3 / fluxo custom (`flow:d_pedir_email`) reentrou, marcou `conversation_step=finalizando`, chamou `validateCustomerForPortal()` que falhou (email do consultor + complemento inválido), `rescue_attempts` já estava em 1, então o bloco **ANTI-LOOP** (`bot-flow.ts` linhas 4919-4941) entrou em `dados_incompletos_pos_loop` e fez handoff. Em vez de pedir o complemento (passo que NUNCA foi perguntado) e reabrir o ciclo, o bot desistiu.

### Por que apareceu o `flow:d_pedir_email` no meio

O step legado `ask_email` e o step do fluxo custom `d_pedir_email` (engine v3) **disputam o mesmo lead** porque o `conversation_step` ainda era `ask_email` (string legada) mas o engine v3 também renderizou o passo `d_pedir_email` antes de finalizar. Foi por isso que o lead viu a pergunta de email *duas vezes* (uma legada, uma v3) e depois o handoff.

---

## Plano de correção

### Fix 1 — sanitização e validação rígida de email (handlers `ask_email` em evolution + whapi)

Arquivo: `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (case `ask_email` ~linha 4341) e `supabase/functions/whapi-webhook/handlers/bot-flow.ts` equivalente.

- Antes de qualquer validação, fazer:
  ```ts
  const txt = (messageText || "")
    .trim()
    .split(/\s+/)[0]      // ".com. br" → ".com." (corta o tail)
    .replace(/[,;]+$/, "")
    .toLowerCase();
  ```
- Se após sanitização ainda tiver espaço/caractere inválido → rejeitar com mensagem clara, NÃO gravar nada.
- Garantir que `updates.email` só é atribuído depois de TODAS as validações (formato + placeholder + consultor).

### Fix 2 — `getNextMissingStep` rejeita email do consultor

Arquivo: `supabase/functions/_shared/conversation-helpers.ts` (~linha 65-73).

- Passar `consultor_email` como argumento opcional para `getNextMissingStep(customer, opts?)`.
- Se `customer.email === opts?.consultorEmail` (case-insensitive, ignorando whitespace), retornar `"ask_email"`.
- Atualizar os 2 chamadores (`whapi-webhook/handlers/bot-flow.ts` e `evolution-webhook/handlers/bot-flow.ts`) para passar `{ consultorEmail }` carregado uma vez.

### Fix 3 — limpar email/complemento contaminados do lead 11971254913

Migration única que:
- Limpa `email` e `address_complement` deste customer (e qualquer outro onde `email = consultor.igreen_portal_email`).
- Reseta `bot_paused = false`, `bot_paused_reason = NULL`, `rescue_attempts = 0`, `conversation_step = 'ask_email'`.
- Insere mensagem outbound pedindo o email novamente, para o lead retomar.

### Fix 4 — ANTI-LOOP só escala quando NÃO houver passo restante para perguntar

Arquivo: `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (~linha 4919) e gêmeo em whapi.

Antes de cair no `dados_incompletos_pos_loop`:
- Recomputar `nextMissing = getNextMissingStep(merged, { consultorEmail })`.
- Se `nextMissing !== "ask_finalizar"`, **redirecionar para `nextMissing`** (mesmo com `rescue_attempts >= 1`) e zerar `rescue_attempts` para 0 quando o lead avançar de fato (já há detecção via `from_step != to_step`).
- Só fazer handoff quando o lead ficar 3+ turnos consecutivos no MESMO step sem extrair nenhum dado novo.

### Fix 5 — bloquear duplicidade engine-v3 × legacy no ask_email

O outbound `flow:d_pedir_email` foi disparado pelo engine v3 *depois* de o legacy já estar no `ask_email`. Adicionar guard no engine v3 (ou no resolver de step) que, se `customer.conversation_step` começar com `ask_` (rota legada), o engine v3 não emite o passo equivalente — deixa o legacy responder.

Arquivo provável: `supabase/functions/_shared/flow-router.ts` ou `supabase/functions/_shared/pipeline-cadastro/registry.ts`. Investigar e adicionar o guard no ponto onde `d_pedir_email` é resolvido para envio.

### Validação

- Teste unitário em `supabase/functions/_shared/conversation-helpers.ts` cobrindo:
  - email do consultor → retorna `ask_email`
  - email com tail "@gmail.com. br" → rejeitado
  - complemento null com demais campos OK → retorna `ask_complement`
- Após deploy, reabrir conversa do 11971254913, verificar que ele recebe a pergunta de email, depois a de complemento, depois o botão Finalizar.
- Conferir nos logs (`bot_step_transitions`) que não há mais salto direto `ask_email → aguardando_humano`.

### Arquivos tocados

- `supabase/functions/_shared/conversation-helpers.ts`
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts`
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts`
- `supabase/functions/_shared/flow-router.ts` (guard engine-v3)
- `supabase/migrations/<timestamp>_fix_lead_11971254913_and_consultor_email.sql`
- (opcional) novo teste em `supabase/functions/_shared/__tests__/`
