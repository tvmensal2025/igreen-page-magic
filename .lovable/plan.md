## Objetivo
Rodar o mapeamento completo do iGreen **100% dentro do sandbox Lovable** (sem PowerShell, sem playwright local), contornando o timeout de 150s das edge functions por meio de uma **fila persistente + worker enxuto + cron**. Cada execução processa poucas rotas, então nunca estoura o limite e a varredura continua sozinha até acabar.

## Por que a abordagem anterior falhou
- `recon-igreen-endpoints` fazia tudo em um único invoke → 150s → timeout do Supabase.
- Cloudflare **não** bloqueou (os logs mostraram `nm_month` respondendo normalmente); o problema foi só duração.
- Playwright local exigia PowerShell + Node na máquina do usuário → não é o que ele quer.

## Arquitetura proposta

```text
 ┌─────────────────────┐    enqueue     ┌──────────────────────┐
 │ recon-igreen-seed   │──────────────▶ │ igreen_recon_queue   │
 │ (1x, popula fila)   │                │ (pending/done/error) │
 └─────────────────────┘                └──────────┬───────────┘
                                                   │ claim 1 job
                                                   ▼
 ┌────────────────────────────────────────────────────────────┐
 │ recon-igreen-worker  (roda a cada 30s via pg_cron)         │
 │  1. SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1              │
 │  2. login com credenciais salvas (rafael.ids@icloud.com)   │
 │  3. fetch endpoint / navega rota                           │
 │  4. captura JSON, headers, screenshot (se rota UI)         │
 │  5. Gemini 3 Flash → resumo + campos + endpoints novos     │
 │  6. grava em igreen_recon_routes + storage                 │
 │  7. UPDATE queue SET status='done'                         │
 └────────────────────────────────────────────────────────────┘
                                                   │
                                                   ▼
 ┌────────────────────────┐   consulta   ┌────────────────────┐
 │ /admin/recon (UI)      │◀───────────  │ igreen_recon_routes│
 │ progresso ao vivo      │              │ + storage bucket    │
 └────────────────────────┘              └────────────────────┘
```

## Passos de implementação

**1. Fila de jobs (migração SQL)**
- `igreen_recon_queue`: `id, kind (endpoint|route), target (url/path), params jsonb, status (pending|running|done|error), attempts, last_error, claimed_at, done_at`.
- `igreen_recon_credentials`: 1 linha com sessão persistida (cookie iGreen do rafael.ids@icloud.com) para o worker reutilizar sem re-login a cada job.
- GRANTs + RLS (só `service_role` acessa).

**2. Seed function `recon-igreen-seed`**
- Popula a fila com **todos** os endpoints já descobertos (`nm_month`, `nm_year`, `perfil`, `saldo`, `extrato`, `indicados`, `pontos`, `faturas`, `contratos`, `documentos`, `notificações`, etc.) e **todas** as rotas UI do painel (dashboard, financeiro, indicações, ajuda, configurações…).
- Para endpoints paginados/mensais, cria 1 job por período (ex.: 24 meses × endpoint).
- Idempotente: `ON CONFLICT DO NOTHING` por `(kind, target, params_hash)`.

**3. Worker `recon-igreen-worker`**
- Processa **3 jobs por invocação** (folga confortável dentro de 150s).
- Reusa cookie salvo; se expirou, refaz login com credenciais em secret (`IGREEN_USER`, `IGREEN_PASS`).
- Para cada job:
  - Chama a API iGreen com fetch nativo (mais rápido que browser).
  - Salva resposta bruta em `igreen_recon_routes.raw_response`.
  - Extrai campos → chama Gemini 3 Flash com prompt "mapeie campos, tipos, e sugira colunas Postgres".
  - Grava `ai_summary`, `ai_fields`, `new_endpoints`, `suggested_columns`.
- Atualiza status na fila; erros retêm até 3 tentativas.

**4. Automação `pg_cron`**
- Job a cada 30s: `SELECT net.http_post('…/recon-igreen-worker', …)` enquanto houver `pending`.
- Auto-para quando fila zera.

**5. UI em `/admin/recon`** (opcional mas útil)
- Card com progresso: `X de Y jobs concluídos`, taxa/min, últimas rotas mapeadas com preview.
- Botão "Iniciar mapeamento" → chama `recon-igreen-seed`.
- Botão "Reprocessar erros".
- Tabela com `ai_summary` + link para screenshot no bucket.

**6. Análise consolidada final**
- Após fila zerada, function `recon-igreen-report`:
  - Lê todas as `new_endpoints` e `suggested_columns`.
  - Gera **um único arquivo `docs/IGREEN_API_MAP.md`** com: endpoint, método, parâmetros, sample response, tabelas Postgres sugeridas (com tipos e FKs).
  - Grava também `igreen_recon_summary` (view materializada) para consulta rápida.

## Detalhes técnicos

**Secrets necessários (já existem `LOVABLE_API_KEY`; falta confirmar):**
- `IGREEN_USER` = `rafael.ids@icloud.com`
- `IGREEN_PASS` = senha (usar `add_secret` — usuário digita no form)
- `IGREEN_BASE_URL` (se não for o domínio padrão)

**Storage:**
- Bucket `igreen-recon` (private) para screenshots opcionais (só rotas UI).

**Tabelas novas:**
- `igreen_recon_queue` (fila)
- `igreen_recon_credentials` (sessão)
- `igreen_recon_routes` (já existe — só adicionar colunas `raw_response jsonb`, `suggested_columns jsonb`, `job_id uuid`)
- `igreen_endpoint_discovery` (já existe)
- view `igreen_recon_summary`

**Rate limit / gentileza:**
- Delay 500ms entre chamadas dentro do worker.
- Máx 3 workers concorrentes (lock via `FOR UPDATE SKIP LOCKED`).

## O que o usuário precisa fazer
1. Aprovar este plano.
2. Quando eu pedir, colar a **senha do iGreen** no form seguro (uma vez).
3. Abrir `/admin/recon` e clicar **Iniciar mapeamento**. O cron toca sozinho — dá para fechar a aba.

## Entregáveis finais
- Base de dados completa com toda API iGreen mapeada (endpoints, campos, sample data).
- `docs/IGREEN_API_MAP.md` gerado automaticamente.
- Sugestão de schema Postgres pronto para o próximo passo (sync real dos dados).
