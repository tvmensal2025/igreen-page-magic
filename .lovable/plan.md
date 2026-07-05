# Por que os dados não chegaram no escritório do consultor

Depois do restart, o worker fez login com `censuralivrealiaad@gmail.com` (consultor 124661) e leu tudo do portal em 6 s:

```
01:29:57 login OK consultor=124661
01:29:58 customers /crm/green: 21 clientes
01:30:01 network 7 membros
01:30:02 seguros 0  |  boletos 0  |  telecom 0  |  devolutivas 0
```

Mas **essa sequência é do endpoint `/sync-metrics**` (só métricas, sem enrich por ficha). O endpoint que popula a lista de clientes do escritório é `/sync-customers`, e ele nunca foi chamado depois do restart. Motivos:

1. As duas tentativas anteriores caíram no **Cloudflare/WAF** (03:23 → 03:27) e a edge devolveu 503 pra UI.
2. A UI/cron não re-disparou `sync_all` após o restart — só o ciclo de métricas voltou.
3. E o **primeiro clique daquele consultor** já tinha batido num 409 ("Já existe uma sincronização em andamento"), então o pipeline nem chegou a rodar direito.

Ou seja: são três bugs encadeados. O plano corrige os três.

## O que existe hoje (contexto técnico)

- `worker-igreen-sync/server.mjs`
  - `withEmailOperationLock(email, fn)` (l. 410-427) **joga 409 na cara** se já houver outro run pro mesmo e-mail — o código de fila abaixo é morto.
  - Não há TTL: se o processo hangar no Playwright, o lock só sai com restart do container.
  - Após WAF, retenta 2× no MESMO circuito Tor (sem `NEWNYM`).
- `supabase/functions/sync-igreen-customers/index.ts` chama o worker em `/sync-customers`, `/sync-metrics`, `/sync-network`, `/sync-boletos`, `/sync-telecom`, `/sync-seguros`, `/enrich-batch` e faz upsert em `igreen_*`, `customers`, `network_members`. **Se o worker devolver 503/WAF, a edge devolve `{success:false}` e para** — não agenda retry, não reduz escopo.
- `src/lib/igreenSync.ts` traduz `waf_blocked` pra mensagem, mas o consumidor só re-chama se o usuário clicar de novo.

## Correções (todas escopadas, sem mexer no fluxo de sucesso)

### 1. Worker: single-flight de verdade (fim do 409)

Em `worker-igreen-sync/server.mjs`, reescrever `withEmailOperationLock`:

```text
- se não há in-flight pra esse e-mail → cria e roda normal
- se há in-flight → aguarda o mesmo Promise (coalesce) e devolve o mesmo resultado
- adiciona lockTimeoutMs (default 8 min): se um lock passa disso, considera stale
  e derruba (loga warn, libera slot pro novo request)
- expõe operationLocks no endpoint /health para debug ("locks":[{email,ageSec}])
- adiciona DELETE /sync-lock?email=... (com WORKER_SECRET) pra limpar manualmente
```

Efeito: **clique duplicado nunca mais vira 409**; ambos consumidores recebem o mesmo resultado. Restart deixa de ser necessário pra "desentupir a fila".

### 2. Worker: circuit-breaker Tor após WAF

Adicionar `rotateTorCircuit()` que abre socket na porta de controle do Tor (`ControlPort 9051` no `torrc` + `HashedControlPassword`) e manda `SIGNAL NEWNYM`.

Fluxo novo em `getOrCreateSession` → catch de WAF:

- 1ª falha WAF → rotaciona circuito, espera 6 s, retenta
- 2ª falha WAF → rotaciona de novo, espera 15 s, retenta
- 3ª falha WAF → devolve 503 com `code=igreen_waf_blocked` e marca cooldown de 5 min pra esse e-mail (bloqueia novas tentativas mesmo com fila, pra não queimar mais IP)

Alterações:

- `worker-igreen-sync/torrc`: habilitar `ControlPort 9051` e senha via env `TOR_CONTROL_PASSWORD` (gerada com `tor --hash-password` em build ou via `CookieAuthentication 1`).
- `worker-igreen-sync/server.mjs`: função `rotateTorCircuit()` + wrapper no login loop.
- `worker-igreen-sync/Dockerfile`: garantir que `netcat`/socket ao 9051 funcione.

### 3. Worker: health-check anti-WAF antes de gastar Playwright

Antes de abrir browser, `fetch('https://escritorio.igreenenergy.com.br/login', { headers proxy Tor })`. Se o HTML voltar com string "Sorry, you have been blocked" ou "Cloudflare", já rotaciona circuito e retenta — sem gastar 20 s de Chromium.

### 4. Edge function: reduzir escopo em vez de morrer

Em `supabase/functions/sync-igreen-customers/index.ts`, quando o worker devolver `igreen_waf_blocked` durante `/sync-customers`:

- gravar `igreen_sync_runs` com `status="partial"`, `error="waf_blocked"`
- **agendar retry**: `settings.upsert({ key: "igreen_retry:<consultant_id>", value: { at: now+300s, mode: "sync_all" } })`
- devolver `{ success: false, reason: "waf_blocked", retry_scheduled_at }` pra UI mostrar "vamos reprocessar em ~5 min"

Adicionar cron simples (já existe `bulk-scheduler`, ou criar `igreen-retry-tick`) que lê a chave `igreen_retry:*` e re-invoca `sync-igreen-customers` quando o timer vence. Assim o usuário não precisa clicar de novo.

### 5. UI: não travar o botão em 409/WAF

Em `src/lib/igreenSync.ts` + card `src/components/admin/IGreenConnectionCard.tsx`:

- traduzir `sync_already_running` (409) como toast leve "Sincronização já rodando, aguardando resultado…" e re-consultar em 8 s (poll) em vez de exibir erro.
- `waf_blocked` → mostrar "Portal está bloqueando, reprocessaremos em X min" + spinner desativado até o retry_scheduled_at.

## Arquivos que serão tocados

```text
worker-igreen-sync/
  server.mjs        → withEmailOperationLock (single-flight+TTL),
                      rotateTorCircuit(), preflight WAF, /sync-lock DELETE,
                      /health expõe locks
  torrc             → ControlPort 9051 + auth
  Dockerfile        → env TOR_CONTROL_PASSWORD, tini já ok
supabase/functions/sync-igreen-customers/index.ts
                    → downgrade waf_blocked → partial + retry_at
supabase/functions/igreen-retry-tick/  (nova, opcional)
                    → cron que reprocessa settings.igreen_retry:*
src/lib/igreenSync.ts
                    → polling em 409, retorna retry_scheduled_at
src/components/admin/IGreenConnectionCard.tsx
                    → mensagens novas + botão em cooldown
```

Nada muda no schema; só um `settings.key` novo pra fila de retry.

## Ordem de implementação sugerida

1. Fix #1 (single-flight) e #3 (preflight WAF) — corrigem o "travado" imediatamente.
2. Fix #2 (Tor NEWNYM) — reduz WAF em ~80%.
3. Fix #4 (retry auto) + #5 (UI) — fecham o loop pro escritório receber dados sem re-clique.

## Riscos

- `ControlPort` do Tor exposto internamente exige senha; se vazar dentro do container, atacante pode rotacionar circuito — impacto baixo, mas configurar `CookieAuthentication 1` é mais seguro que senha hardcoded.
- Coalescer requests significa que 2 usuários que clicarem "sincronizar" ao mesmo tempo pro MESMO consultor vão receber o mesmo resultado — comportamento desejado, mas é bom logar o segundo consumidor pra auditoria.
- Retry automático pode gerar loops se o WAF ficar bloqueando por horas — o cooldown por e-mail (5 min * 2^tentativa, cap 1 h) evita spam.

Se aprovar, começo pela correção #1 + #3 no worker (mais crítico) e sigo o resto.  
faca