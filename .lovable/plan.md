## Diagnóstico — JONATAS (5511971254913, id 705e9655…)

Timeline reconstruído de `conversations` + `bot_step_transitions`:

```
02:21:13  bot pede a conta            (aguardando_conta)
02:21:42  cliente envia PDF da conta
02:22:24  bot mostra resultado + botões
02:23:35  bot pede documento          (aguardando_doc_auto)
02:23:53  cliente envia PDF do doc
02:24:25  confirma dados do doc (1)
02:24:44  confirma titularidade (1)
02:25:03  confirma telefone (Sim)     (ask_phone_confirm → ask_email)
02:25:16  bot pede email
02:35:23  cliente envia "rafael.teste@gmail.com"
          ⚠️ BOT FICA EM SILÊNCIO POR 12 MIN
02:37:15  cliente pergunta "Deu Certo?"
02:37:27  ❌ bot RESETA para welcome e reinicia o cadastro do zero
02:38:33  ❌ bot pede a CONTA novamente (já tinha tudo)
```

Estado do `customers` neste momento já tinha: bill_photo + bill_value 2392,10, document_front+back, cpf, distribuidora CPFL, instalação 25680030, cep, email [rafael.teste@gmail.com](mailto:rafael.teste@gmail.com), bill_data_confirmed_at e doc_data_confirmed_at. Ou seja, **só faltava o portal2 disparar**.

### Causa raiz — dois bugs independentes

1. `**ask_email` engoliu o email de teste sem responder.** O handler (`bot-flow.ts` linha 5198) tem `isPlaceholderEmail()` que deveria responder “esse e-mail parece de teste, me manda o seu de verdade”. Aqui ele não respondeu — o cliente ficou 12 min sem retorno. Precisa confirmar se a função realmente classifica `*.teste@*` como placeholder e se o branch chegou a executar (pode ter caído em outro caminho, p.ex. rota conversacional / Camila assumindo o turno em `ask_email`).
2. **Re-welcome reiniciou o fluxo apagando o progresso.** Quando o cliente disse "Deu Certo?" às 02:37, alguma regra (re-welcome do whapi-style, step-mismatch-cure de `evolution-webhook/index.ts` linha 1775, ou normalização de `novo_lead`/`welcome`) zerou `conversation_step` para `welcome`. O fluxo começou de novo do `d_welcome` e às 02:38 pediu a *foto da conta* — apesar de `electricity_bill_photo_url`, `document_*_url`, `cpf`, `email`, `cep`, `numero_instalacao` já estarem todos preenchidos. **Nenhum guard "se já capturei, pula" existe na entrada do fluxo.**

## Plano

### 1. Guard de retomada no início do roteador (corrige reset → re-pedir conta)

Em `supabase/functions/evolution-webhook/index.ts`, logo após o bloco de `RESUMABLE_STATUSES` (≈linha 689) e antes do fluxo principal, inserir um guard idempotente:

```
Se conversation_step ∈ {welcome, menu_inicial, '', null, d_welcome, primeiro step do fluxo}
   E o customer já tem:
        electricity_bill_photo_url + bill_data_confirmed_at
        document_front_url + document_back_url + doc_data_confirmed_at
        cpf + email + numero_instalacao
   E status NÃO está em {registered_igreen, awaiting_signature, …finalizados}
→ pula para o próximo passo pendente:
     – se faltam só endereço/CEP → ask_cep / ask_number / ask_complement
     – senão → enfileira portal2 (status='pending_portal2', conversation_step='cadastro_em_analise')
   e responde algo como: "Voltando ao seu cadastro — já tenho tudo aqui, estou finalizando 👍"
```

Esse guard executa antes de qualquer engine (cadastro, conversational, flow custom), então re-welcome, step-mismatch-cure ou qualquer normalização que zere o step deixa de causar regressão.

### 2. Espelhar o guard no `whapi-webhook` (paridade)

Mesma checagem em `supabase/functions/whapi-webhook/index.ts`. Reusa um helper compartilhado novo: `_shared/bot/resume-or-skip.ts` exportando `shouldResumeAfterReset(customer)` + `pickNextPendingStep(customer)`. Sem isso, leads do Whapi superadmin caem no mesmo bug.

### 3. Destravar o caso `ask_email` silencioso

Investigar e corrigir o silêncio do handler de email para `*.teste@*`. Plano de ação:

- Adicionar log explícito antes de cada `return reply` em `case "ask_email"` (placeholder, invalid, consultor, sucesso) para futuras evidências.
- Garantir que o roteamento NÃO entrega `ask_email` à Camila/AI quando o cliente respondeu texto curto que parece e-mail (`@` presente) — forçar pipeline determinístico, igual já é feito para `aguardando_conta`/mídia.
- Caso `isPlaceholderEmail()` esteja muito restritivo, manter a mensagem mas registrar `conversations` outbound mesmo em rate-limit (hoje a resposta pode sumir se a quota anti-ban bloquear sem fallback).

### 4. Data fix do JONATAS (depois do guard estar no ar)

Reverter o estrago: como ele já tem conta+doc+CPF+endereço+instalação, marcar `conversation_step='ask_email'` (porque o email atual é placeholder de teste) e responder uma mensagem pedindo um e-mail real. Não reenviar pedido de conta. Mensagem única, sem reset.

Se você confirmar que `rafael.teste@gmail.com` é teste seu e o lead JONATAS *é* só teste, basta marcar como `registered_igreen` igual aos outros 4 — sem disparar portal2 nem enviar nada.

### 5. Fora de escopo nesta rodada

- Mudar a regra de re-welcome em si (manter `≥4h saudação / ≥24h` como hoje). Só impedir que ela cause regressão via guard do item 1.
- Mexer em ai-agent, conversational-state-machine, flow-engine v3.
- Tocar nos 4 leads já marcados como `registered_igreen` ontem.

## Detalhes técnicos

- Arquivos: `supabase/functions/evolution-webhook/index.ts` (guard), `supabase/functions/whapi-webhook/index.ts` (espelho), novo `supabase/functions/_shared/bot/resume-or-skip.ts`, `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (logs + gate de roteamento no `ask_email`).
- Nenhuma migration nem mudança de schema. Colunas usadas no guard já existem (`electricity_bill_photo_url`, `document_front_url`, `document_back_url`, `bill_data_confirmed_at`, `doc_data_confirmed_at`, `cpf`, `email`, `numero_instalacao`, `cep`).
- Sem mudança em `_shared/cerebro/`, engine v3, evolution proxy, worker-portal-2 (já está com o tratamento de duplicidade de ontem), nem cron.

## Perguntas antes de implementar

1. **JONATAS (5511971254913) é teste seu?** Se sim, eu marco como `registered_igreen` igual aos 4 de ontem e *não* envio nada para ele. Se for lead real, peço o email novamente (uma única mensagem). Sim 
2. Aplico os itens 1+2+3 juntos (guard + paridade whapi + fix do ask_email silencioso) ou prefere por etapas? Aplique todos juntos. Mas análise todo o cosigo para não far problemas r quebrar 