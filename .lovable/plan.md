## Objetivo

Oficializar `tvmensal2025/igreen-page-magic` como repo-fonte dos workers que **existem aqui** no Easypanel, atualizar documentação, auditar secrets — **sem quebrar Portal 1**, que continua no repo antigo.

## Descoberta crítica (read-only)


| Worker                       | Pasta no `igreen-page-magic`? | Ação Easypanel                                |
| ---------------------------- | ----------------------------- | --------------------------------------------- |
| `worker-portal-2` (Portal 2) | ✅ existe                      | reapontar                                     |
| `worker-igreen-sync`         | ✅ existe                      | reapontar                                     |
| `compress-worker`            | ✅ existe                      | reapontar                                     |
| `worker-portal` (Portal 1)   | ❌ **NÃO existe**              | **NÃO MEXER** — fica em `viana-replica-vault` |


Nenhum código vivo (Dockerfile, server.mjs, edge functions, package.json, .env, settings) referencia `viana-replica-vault` — só docs históricos. Risco de quebrar produção = nulo na parte de código.

## Escopo

### 1. Documentação — troca de repo (12 arquivos)

**Vivo (1):**

- `worker-portal-2/README.md` — seção "Como subir no Easypanel": `viana-replica-vault` → `igreen-page-magic`, build path `/worker-portal-2`.

**Arquivo histórico (11):** adicionar nota de cabeçalho `> ⚠️ Histórico (até 28/06/2026). Repo migrado para tvmensal2025/igreen-page-magic. Portal 1 permanece em viana-replica-vault.` em vez de reescrever conteúdo:

- `docs/archive/PORTAL_WORKER_CRIADO.md`
- `docs/archive/INICIO_AQUI_PORTAL_WORKER.md`
- `docs/archive/PASSO_A_PASSO_GITHUB.md`
- `docs/archive/RESUMO_CORRECAO_PORTAL_WORKER.md`
- `docs/archive/STATUS_GITHUB_FINAL.md`
- `docs/archive/RESUMO_SESSAO_COMPLETA.md`
- `docs/archive/PLANO_INTEGRACAO_WHAPI.md`
- `docs/archive/ATUALIZACOES_RECEBIDAS.md`
- `docs/archive/ANALISE_REPOSITORIO_COMPLETA.md`
- `ANALISE_COMPLETA_CODIGO.md`
- `docs/archive/CORRIGIR_PORTAL_WORKER.md`

### 2. Passo-a-passo Easypanel (chat, sem código)

Para os **3 workers que vivem aqui**:

```text
Easypanel → <serviço> → Source
  Proprietário: tvmensal2025
  Repositório:  igreen-page-magic
  Ramo:         main
  Build path:   <ver tabela>
→ Salvar → Rebuild (não Restart)
```


| Serviço Easypanel  | Build path            |
| ------------------ | --------------------- |
| portal-worker-2    | `/worker-portal-2`    |
| igreen-sync-worker | `/worker-igreen-sync` |
| compress-worker    | `/compress-worker`    |


**portal-worker (Portal 1):** NÃO tocar. Continua em `viana-replica-vault` → `/worker-portal`.

Validação pós-deploy de cada um:

- `curl https://<host>/health`  → `{"ok":true}`
- Easypanel "Logs" sem erro de build path / git auth

### 3. Auditoria de secrets (read-only)

Consultar `public.settings` e `fetch_secrets` para confirmar (sem alterar nada):


| Chave                                                                     | Onde                  | Esperado          |
| ------------------------------------------------------------------------- | --------------------- | ----------------- |
| `portal_worker_url` / `worker_secret`                                     | `settings`            | Portal 1 —mexer   |
| `portal2_worker_url` / `portal2_worker_secret`                            | `settings`            | Portal 2 — manter |
| `igreen_sync_worker_url` / `igreen_sync_worker_secret`                    | `settings`            | Sync — manter     |
| `PORTAL2_WORKER_URL/SECRET`, `WORKER_SECRET`, `IGREEN_SYNC_WORKER_SECRET` | Edge Function Secrets | Manter            |


Relato em tabela no chat com ✅/⚠️. Mudar valor só com confirmação explícita.

### 4. Webhooks GitHub (instrução pro usuário)

Se o Easypanel tinha webhook de auto-deploy no `viana-replica-vault` para os 3 workers migrados, recriar em:
`https://github.com/tvmensal2025/igreen-page-magic/settings/hooks`

## Fora de escopo (não mexer)

- `worker-portal` **(Portal 1)** —ja ajuste ele
- Conteúdo dos Dockerfiles, server.mjs, fila BullMQ, Redis
- Valores de `WORKER_SECRET`, URLs em produção, anon key
- `supabase/migrations/*` (imutável)
- MinIO, Evolution API, Whapi, edge functions

## Riscos e mitigações

- **Quebrar Portal 1**: mitigado — Portal 1 explicitamente excluído.
- **Easypanel cache**: usar "Rebuild", não "Restart".
- **Branch errada**: confirmar `main` no novo repo antes de salvar Source.
- **Auto-deploy parado**: recriar webhook GitHub após troca.
- **Rollback**: se algum dos 3 quebrar, basta voltar Source para `viana-replica-vault` + mesmo build path; secrets/env não mudam, então rollback é instantâneo.

## Entrega

1. Diff de 12 arquivos de documentação (sem tocar código vivo)
2. Bloco no chat com:
  - Tabela de mapeamento worker → repo → build path (incluindo Portal 1 = NÃO MEXER)
  - Passo-a-passo Easypanel para os 3 serviços
  - Tabela de status dos 8 secrets/settings auditados
  - Lista de webhooks GitHub a recriar