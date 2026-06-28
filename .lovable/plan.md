## Contexto

Os leads "presos" no portal2 (EDSON, SILVIA SOUSA, EVANDRO, Lucinéia) **não são bug do fluxo** — são testes seus reaproveitando o mesmo CPF/celular/código de instalação. A API da iGreen barra corretamente com `duplicatePhone` / `duplicateDocument` / "Cliente já cadastrado: mesmo consultor". O fluxo conversacional + Evolution (fix da linha 2132) está OK.

O que você quer agora: **marcar esses leads como finalizados** no nosso lado, já que o bloqueio foi só porque o cadastro real já existe na iGreen. O OTP e o link de assinatura não chegaram só por causa da duplicidade — não é falha de produto.

## Plano

### 1. Marcar os 4 leads de teste como finalizados (data fix, sem código)

Para cada um (EDSON 5511…1765, SILVIA SOUSA 5514…9266, EVANDRO, Lucinéia 24/06), via `supabase--insert`:

```sql
UPDATE customers
SET status = 'registered_igreen',
    conversation_step = 'cadastro_em_analise',
    portal2_status = 'completed_duplicate',
    portal2_error = NULL,
    error_message = NULL
WHERE id IN ('<id1>','<id2>','<id3>','<id4>');
```

Confirmo os IDs exatos com `supabase--read_query` antes de aplicar. Não envio mensagem de WhatsApp pra eles (são testes seus).

### 2. Regra nova no portal2: tratar "já cadastrado mesmo consultor" como sucesso

Hoje, quando `/customers/check-exists` ou o POST retorna "Cliente já cadastrado: mesmo consultor", o worker grava `needs_human` e trava. Para leads reais, o comportamento correto é:

- Marcar `status = registered_igreen`, `portal2_status = already_registered`.
- NÃO abrir ticket humano.
- NÃO reenviar OTP nem link.
- Mensagem opcional ao lead: "Vimos que você já tem cadastro ativo na iGreen com este consultor. Tudo certo, nada a fazer."

Mexer apenas em `worker-portal-2/` (branch de `duplicateDocument` / "mesmo consultor") + 1 ponto no `worker-callback` para mapear o novo `action: "already_registered"` em update de status. Sem tocar em fluxo conversacional, sem tocar no engine, sem tocar no fix da linha 2132.

### 3. Não mexer nesta rodada

- Fluxo D / Evolution / botões — está OK, fix já validado.
- whapi-webhook linha 2296 — deixo pra outra conversa (defesa em profundidade, não urgente).
- Follow-up automático para OTP não validado (Lucinéia) — fica fora; o caso dela vira "finalizado" com a regra nova.
- "duplicate_phone" do EVANDRO no celular: o `formatPhone` já está correto conforme `PORTAL2_FLUXO_CANONICO.md`; é duplicidade real porque você testou com o mesmo número. Mesma regra do item 2 resolve.

## Detalhes técnicos

- Arquivo a editar: `worker-portal-2/` (provavelmente `src/customer.js` ou equivalente onde está o tratamento de `error.customer.duplicateDocument` e da mensagem "Cliente já cadastrado: mesmo consultor") + `supabase/functions/worker-callback/index.ts` para aceitar `action: "already_registered"`.
- Nenhuma migração de schema. `portal2_status` já existe como coluna texto livre.
- Nenhuma mudança em `bot-flow.ts`, `evolution-webhook`, `whapi-webhook`, `_shared/cerebro/`.

## Pergunta antes de implementar

Os 4 leads de teste eu marco como `registered_igreen` (vão sumir da fila de "presos" e contam como finalizados no funil) — **confirma?** E a regra nova do worker (item 2) eu aplico junto, ou só o data fix dos 4 agora?  Nao envie nada para eles.

&nbsp;

Pode analisar todos os passos tem que ser enviado 

&nbsp;