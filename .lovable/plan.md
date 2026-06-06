# Plano — Migrar sync iGreen para Worker Playwright em VPS

## Contexto
O teste agora mostrou exatamente o problema que tentamos contornar: `POST /v1/login` da API iGreen devolveu **401 "Unauthorized action"** mesmo com email/senha corretos (provavelmente Cloudflare/captcha bloqueando login via fetch). A solução pelo bookmarklet foi um paliativo. A solução robusta é o que você já tem para o cadastro de leads: um **worker Playwright rodando na sua VPS** que loga no portal como um navegador real.

O projeto já tem essa arquitetura para **escrita** no portal (`_shared/portal-worker.ts` → dispatcher HTTP que fala com workers externos em URLs como `http://igreen_portal-worker-2:3101`). Vamos seguir o mesmo padrão para **leitura** (sync de clientes e rede) e remover toda a abordagem do bookmarklet, que ficaria duplicada.

## O que será REMOVIDO (abordagem bookmarklet desta sessão)

Arquivos:
- `src/pages/AdminIgreen.tsx`
- `src/pages/IgreenConnect.tsx`
- `supabase/functions/igreen-token-receive/index.ts`
- Rotas `/admin/igreen` e `/igreen-connect` em `src/App.tsx`
- Bloco `[functions.igreen-token-receive] verify_jwt = false` em `supabase/config.toml`

Schema (via migration):
- Colunas em `consultants`: `igreen_access_token`, `igreen_token_updated_at`, `igreen_token_expires_at`, `igreen_token_expired`, `igreen_connect_code`
- Trigger `trg_ensure_igreen_connect_code` + função `ensure_igreen_connect_code`
- Mantém: `igreen_consultor_id` (cache útil para o worker), `igreen_portal_email`, `igreen_portal_password` (continuam sendo as credenciais que o worker usa)

## O que será MANTIDO (reutilizável)

`supabase/functions/sync-igreen-customers/index.ts`:
- Helpers `buildRecord()`, `mapStatus()`, `normalizePhone()`, `safeStr/Num()`, `cleanDevolutiva()`
- Toda a lógica de upsert em `customers` com proteção de `mid-conversation`
- Sync de rede com upsert em `network_members` e remoção de obsoletos
- Modo `cron` que itera sobre todos consultores aprovados

`supabase/functions/_shared/portal-worker.ts` — **não tocar**, é a pipeline de escrita (cadastro de leads) e é totalmente independente.

## O que será CONSTRUÍDO

### 1. Worker Playwright externo (na sua VPS, fora do repo Lovable)

Especificação técnica, que entrego em um documento `docs/igreen-sync-worker.md` no repo (Node + Playwright, você sobe na VPS via Docker no mesmo padrão dos workers já existentes):

```
POST /sync-customers
  body: { portal_email, portal_password, since?: ISO_date }
  resposta: {
    ok: true,
    consultor_id: "...",
    customers: [ { ...campos crus do portal... } ]
  }

POST /sync-network
  body: { portal_email, portal_password }
  resposta: { ok: true, members: [...] }

GET /health → { ok: true, sessions: N }
```

Comportamento esperado do worker:
- Mantém um **pool de sessões Playwright** (1 por email), reaproveita o cookie entre chamadas (TTL 30 min) para não logar a cada request — evita rate-limit e captcha
- Login real no `https://escritorio.igreenenergy.com.br` com browser headless, salva cookies
- Depois do login, chama as APIs `/customer-map` e `/network-map` **usando os cookies da sessão** (mesma origem, sem CORS/Cloudflare bloqueando)
- Retorna JSON cru — todo o parsing/mapeamento continua sendo feito pelo `sync-igreen-customers` no Supabase

### 2. Refator do `sync-igreen-customers`

Remove Strategy 1 (token) e Strategy 2 (login direto). Substitui por uma única chamada:

```
POST $IGREEN_SYNC_WORKER_URL/sync-customers
  body: { portal_email, portal_password }
```

Se worker offline ou login falhou, devolve erro claro pro frontend (mesma estrutura que hoje, só muda a fonte).

### 3. Configuração

Nova env/secret: `IGREEN_SYNC_WORKER_URL` (apontando para a sua VPS, ex.: `http://igreen-sync-worker:3102` ou URL pública). Lida via `Deno.env.get()` com fallback opcional em `settings.igreen_sync_worker_url` (mesmo padrão do portal-worker).

### 4. Frontend (já está quase pronto)

Todos os call-sites (`DashboardTab`, `NetworkPanel`, `CustomerManager`) já foram simplificados na sessão passada para **não passar senha** — chamam só com `consultant_id`. Nada mais a mudar lá. Só remover a página `/admin/igreen` do menu admin (se estiver linkada).

## Ordem de execução proposta

1. **Migration** removendo as 5 colunas + trigger + função do bookmarklet. (Reversível via backup do schema atual.)
2. **Deletar arquivos** das páginas/rotas/edge function do bookmarklet + limpar `App.tsx` e `config.toml`.
3. **Refatorar** `sync-igreen-customers/index.ts` para chamar o worker (Strategy única).
4. **Criar `docs/igreen-sync-worker.md`** com a spec completa do worker (endpoints, schemas de request/response, exemplo de Dockerfile, variáveis de ambiente, comportamento de sessão). Você usa esse doc para implementar o worker na VPS.
5. **Adicionar** `IGREEN_SYNC_WORKER_URL` como secret no Lovable Cloud (após você subir o worker e ter a URL).
6. **Testar** end-to-end: clicar "Sincronizar" no admin → ver clientes voltando.

## Detalhes técnicos
- O worker NÃO precisa de acesso ao Supabase — só faz login no portal e devolve JSON. Toda escrita no banco continua sendo do edge function.
- Credenciais (`igreen_portal_email`/`igreen_portal_password`) continuam armazenadas no `consultants` com o REVOKE de SELECT que aplicamos antes — só o edge function (service_role) lê e passa pro worker via HTTPS.
- Recomendação: rodar o worker atrás de HTTPS + um header secreto (`X-Worker-Token`) verificado nas duas pontas, mesmo padrão dos workers de cadastro.
- Sem mexer em nada de Facebook, WhatsApp, ou cadastro de leads — escopo cirúrgico.

## Não está no escopo
- Implementar o código do worker Playwright em si (você sobe na VPS; eu entrego só a spec).
- Mexer no `portal-worker.ts` ou em qualquer fluxo de cadastro de leads.
- Mexer em qualquer integração Facebook.
