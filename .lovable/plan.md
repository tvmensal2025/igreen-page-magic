## Objetivo
Permitir que um único turno do bot (resposta a UMA mensagem do lead) envie 2-4 itens consecutivos (áudio + vídeo + texto-com-botões) sem ser bloqueado por `min_interval_not_elapsed`, **sem afetar** as outras proteções anti-ban (cap diário, recovery mode, fatal_lock, warmup).

## Causa raiz (já diagnosticada)
No passo "Como funciona" do Evolution:
- 13:01:54 áudio enviado → registra `last_send_at`
- 13:01:56 vídeo tentado → `min_interval_not_elapsed` (faltam 6s) → BLOQUEADO
- 13:01:58 retry vídeo → bloqueado novamente → `video_failed`
- texto+botões também não sai (mesmo motivo)

O `min_interval` foi desenhado para evitar disparos em massa (campanha), não para fragmentar uma resposta multi-mídia legítima.

## Mudança (1 arquivo)

`supabase/functions/_shared/sender-guard.ts`

Adicionar uma janela de "burst" local à closure do wrapper:

````text
wrapSenderWithGuard(rawSender, opts)
  └── closure: burstUntilTs = 0
  └── wrapSendFn(...):
       1. quota = checkSendQuota(...)
       2. SE !quota.allowed:
            - SE reason === "min_interval_not_elapsed" E Date.now() < burstUntilTs:
                 → bypass: prossegue para enviar (loga "burst-bypass")
            - SENÃO (cap diário, recovery, fatal, warmup, etc.):
                 → bloqueia normalmente (return false)
       3. envia via fn(...args)
       4. SE result === true:
            - registerSend(...)
            - burstUntilTs = Date.now() + BURST_TTL_MS (20s)
````

Constantes:
- `BURST_TTL_MS = 20_000` — janela de 20s suficiente para 4 mídias do mesmo turno; depois disso volta a respeitar `min_interval`.

## Por que isso é seguro
1. **Escopo per-invocation**: o wrapper é criado uma vez por chamada do `evolution-webhook` (`const sender = wrapSenderWithGuard(...)` em index.ts:344). A closure `burstUntilTs` vive só durante essa invocação → a janela de 20s naturalmente cobre só o turno atual.
2. **Outras proteções intactas**: `daily_cap_reached`, `recovery_mode`, `fatal_disconnect_pending_confirmation`, `warmup_exceeded` continuam bloqueando — só `min_interval_not_elapsed` é flexibilizado e somente dentro da janela.
3. **`registerSend` continua sendo chamado**: o contador diário não é afetado; só pulamos a checagem de intervalo mínimo.
4. **Próximo turno do mesmo lead**: vem como nova invocação do webhook → wrapper novo → `burstUntilTs=0` → primeira mensagem do próximo turno respeita `min_interval` normalmente.
5. **Whapi não é afetado** (não usa esse guard).

## O que NÃO muda
- Schema do banco (nenhuma migration).
- `check_send_quota` RPC.
- `min_interval` por warmup day (mantém 8s/5s/4s/3s já configurados).
- Whapi webhook.
- Frontend, Flow Builder, conteúdo dos passos.
- Demais edge functions que usam `checkSendQuota` (reactivation, bulk, scheduled) — elas chamam direto a função, não usam o wrapper, então continuam com anti-ban estrito (correto para campanhas).

## Validação
1. Lead novo manda "oi" → recebe boas-vindas.
2. Lead clica "Como funciona" / responde "2".
3. Esperado nos logs:
   - `audio` enviado
   - `video` enviado (com 1 log `[sender-guard] burst-bypass kind=media`)
   - `text` enviado (com `burst-bypass kind=text`) contendo "Hoje já somos…" + 1️⃣2️⃣3️⃣
4. Conferir `conversations`: 3 outbound do mesmo `conversation_step=d_como_funciona`, sem `video_failed`.

## Risco
Baixíssimo. O burst só relaxa `min_interval`, não permite mais envios totais (cap diário mantém). Pior caso: uma rajada de 4 mensagens chega ao lead em ~2-3s em vez de espaçada em 8s — exatamente o comportamento que o consultor configurou no Flow Builder.