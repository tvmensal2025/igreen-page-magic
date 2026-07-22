# Configuração MCP (Cursor + Kiro)

Este projeto usa MCP para o agente acessar **Supabase**, **GitHub** e
**Playwright** sem colocar tokens no repositório.

## Setup rápido

```bash
bash scripts/setup-mcp.sh
```

Depois, no Cursor: **Settings → Tools & MCP → Authorize** o servidor `supabase`
e ative os três servidores.

---

## Servidores configurados

| Servidor | Propósito neste projeto | Auth |
|---|---|---|
| **supabase** | SQL, migrations, edge functions, logs, advisors | OAuth (hosted) |
| **github** | PRs, Actions, deploy workflow, issues | `gh auth token` |
| **playwright** | Browser E2E, debug de landing/admin | npx (sem auth) |

**Project ref Supabase:** `zlzasfhcxcznaprrragl`  
**URL:** `https://zlzasfhcxcznaprrragl.supabase.co`

---

## Arquivos

| Arquivo | Commitado? | Descrição |
|---|---|---|
| `.cursor/mcp.json.example` | ✅ | Template versionado |
| `.cursor/mcp.json` | ❌ | Config local (copiada pelo setup) |
| `.env.mcp.local.example` | ✅ | Template PAT Supabase (fallback) |
| `.env.mcp.local` | ❌ | PAT real (só se OAuth falhar) |
| `.env.local` | ❌ | Frontend Vite (`VITE_SUPABASE_*`) |
| `scripts/mcp-github.sh` | ✅ | Wrapper GitHub sem PAT no JSON |
| `scripts/mcp-supabase-pat.sh` | ✅ | Fallback Supabase via PAT |

---

## Supabase MCP (OAuth hosted — recomendado)

O `.cursor/mcp.json` local usa a URL hosted (sem PAT no arquivo):

```json
"supabase": {
  "url": "https://mcp.supabase.com/mcp?project_ref=zlzasfhcxcznaprrragl"
}
```

**Gere o arquivo com caminhos absolutos** (obrigatório no Linux):

```bash
bash scripts/write-mcp-json.sh
```

> **Bug Cursor Linux:** `${workspaceFolder}` em `args` **não é expandido** — o MCP tenta abrir literalmente `${workspaceFolder}/scripts/...` e falha. Por isso usamos caminhos absolutos via `write-mcp-json.sh`.

### Autorizar

1. `bash scripts/write-mcp-json.sh`
2. `Ctrl+Shift+P` → **Developer: Reload Window**
3. **Settings → Tools & MCP**
4. Em `supabase` → **Needs authentication** / **Authorize**
5. ~29 tools habilitadas = OK

### Fallback PAT (se OAuth falhar)

1. PAT em https://supabase.com/dashboard/account/tokens (`sbp_...`, **não** service_role `eyJ...`)
2. `.env.mcp.local` → `sbp_952f45ff730ebad1e066f727b61cfd47b9fb5d25`
3. Troque supabase no mcp.json por:

```json
"supabase": {
  "command": "/caminho/absoluto/scripts/mcp-supabase.sh"
}
```

---

## GitHub MCP

Usa o token do `gh` CLI — **não** grava PAT no `mcp.json`.

```bash
gh auth login   # se ainda não estiver logado
gh auth status  # deve mostrar tvmensal2025
```

Tools úteis: listar PRs, disparar workflow `deploy-edge-functions.yml`,
ler checks de CI.

> O `gh workflow run` pode dar 404 com token fine-grained; para deploy use o
> curl documentado em `.kiro/steering/deploy.md`.

---

## Playwright MCP

Browser headless para testar landing pages, admin e fluxos visuais.

```json
"playwright": {
  "command": "npx",
  "args": ["-y", "@playwright/mcp@latest", "--headless"]
}
```

**Troubleshooting Cursor 2.x:** se tools aparecem mas não executam, remova o
MCP built-in `cursor-ide-browser` do projeto ou habilite auto-run para tools
(Playwright pode ficar preso no sandbox).

---

## Frontend local (Vite)

O setup cria `.env.local` com as chaves públicas já usadas em
`src/integrations/supabase/client.ts`:

```env
VITE_SUPABASE_URL=https://zlzasfhcxcznaprrragl.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Rode `npm run dev` → http://localhost:8080

---

## Kiro (opcional)

O Kiro lê `.kiro/settings/mcp.json` (gitignored). Copie o mesmo conteúdo de
`.cursor/mcp.json.example` para lá se usar o Kiro IDE.

**Nunca commite** tokens em `mcp.json` — ver `.kiro/steering/deploy.md`.

---

## Comandos de teste (no chat do Cursor)

```
Liste as tabelas public usando MCP Supabase
```

```
Quantas edge functions estão deployadas? Use MCP Supabase list_edge_functions
```

```
Abra o status do último workflow deploy-edge-functions no GitHub
```

```
Navegue para http://localhost:8080 com Playwright e descreva a tela
```

---

## Segurança

- MCP Supabase opera com **suas permissões de desenvolvedor** — não exponha a
  clientes finais.
- Prefira `read_only=true` ou branch de dev para explorar schema.
- Revogue PATs antigos se vazarem (histórico: token no `.kiro/settings/mcp.json`).
- `service_role` **nunca** vai no frontend nem no MCP do browser.

---

## MCPs adicionais recomendados (2026)

Análise baseada na stack real do iGreen Official Portal: React/Vite + 130+ Edge
Functions Deno + Supabase + Stripe (wallet) + Sentry + MinIO + Meta Ads +
4 workers Docker + Playwright.

### Status atual (instalados nesta sessão)

Estes seis servidores já estão no `.cursor/mcp.json` ativo:

| Servidor | Estado | Observação |
|---|---|---|
| `supabase` | ✅ Ativo | SQL, migrations, edge functions, logs, advisors |
| `github` | ✅ Ativo | PRs, Actions, CI (token via `gh`) |
| `playwright` | ✅ Ativo | Browser E2E headless |
| `context7` | ✅ Ativo | Docs atualizadas (sem auth) |
| `postgres` | ⚠️ Falta `DATABASE_URI` | Diagnóstico de performance — read-only; preencha `.env.mcp.local` |
| `analyzer` | ✅ Ativo | Ruff + Vulture (Python) via `uvx` |
| `TestSprite` | ⚠️ Falta `TESTSPRITE_API_KEY` | Análise + testes automatizados na cloud |

> Reload Window depois de editar o `.env.mcp.local` pra o `postgres` / `TestSprite` subir.

### TestSprite MCP

Análise de código + geração/execução de testes na cloud do TestSprite.

1. Crie conta e gere a API key: https://www.testsprite.com/dashboard/settings/apikey
2. Em `.env.mcp.local` (gitignored):

```env
TESTSPRITE_API_KEY=sua-key-aqui
```

3. Regenere e recarregue:

```bash
bash scripts/write-mcp-json.sh
# Ctrl+Shift+P → Developer: Reload Window
```

4. No chat: *"Help me test this project with TestSprite"* ou *"analise este projeto com TestSprite"*

**Nota:** o wrapper `scripts/mcp-testsprite.sh` usa Node 22 via nvm (o pacote exige `>=22`).

**Figma:** o MCP `figma` vem do plugin Figma instalado no Cursor (não fica no
`mcp.json` do projeto) — já está disponível, é só usar.

### Resumo por prioridade

| Prioridade | MCP | Por quê neste projeto | Instalar? |
|---|---|---|---|
| **P0** | supabase, github, playwright | Já configurados — base do dev | ✅ Sim |
| **P1** | **Context7** | Docs atualizadas Supabase, React, Deno, Stripe, Playwright | ✅ Instalado |
| **P1** | **Postgres (crystaldba)** | EXPLAIN, índices não usados, queries lentas, vacuum/locks | ✅ Instalado (read-only) |
| **P1** | **Analyzer (Ruff+Vulture)** | Lint e dead-code dos scripts Python (`scripts/`, `.kiro/specs/`) | ✅ Instalado |
| **P1** | **Sentry** | `@sentry/react` no front + `SENTRY_DSN` nas edges | ✅ Se DSN ativo |
| **P2** | **Stripe** | `wallet-stripe-webhook`, `wallet-create-topup` | ✅ Com restricted key |
| **P2** | **GitHub (Docker)** | Substituir npm deprecado `@modelcontextprotocol/server-github` | ⚠️ Migrar quando quebrar |
| **P3** | **Docker MCP Gateway** | 4 workers (`worker-portal`, `compress-worker`, etc.) | Opcional |
| **P3** | **Fetch / Brave Search** | Pesquisa pontual (APIs Meta, Evolution) | Opcional |
| **—** | MinIO / S3 MCP | Sem servidor maduro; storage via Supabase MCP (limitado) | ❌ Não |
| **—** | Meta/Facebook Ads | 20+ edges, mas **sem MCP oficial** | ❌ Não |
| **—** | Gemini / OpenAI MCP | Chaves só em edge env; sem ganho vs código local | ❌ Não |
| **—** | Segundo browser | `cursor-ide-browser` (built-in) conflita com Playwright | ❌ Um só |

---

### P1 — Context7 (documentação atualizada)

**Valor:** O projeto mistura React 18, Deno edge functions, Supabase RLS,
Playwright workers e Stripe. Context7 injeta docs oficiais na hora — reduz
alucinação em APIs que mudaram (ex.: Supabase v2, Deno 2.x).

**Instalação** — adicione ao `.cursor/mcp.json` (após `write-mcp-json.sh`):

```json
"context7": {
  "command": "npx",
  "args": ["-y", "@upstash/context7-mcp"]
}
```

Sem auth. Opcional: API key em https://context7.com para rate limit maior:

```json
"context7": {
  "command": "npx",
  "args": ["-y", "@upstash/context7-mcp"],
  "env": {
    "CONTEXT7_API_KEY": "ctx7sk_..."
  }
}
```

**Teste no chat:** `Use Context7: documentação atual do Supabase Realtime subscribe`

---

### P1 — Postgres (crystaldba/postgres-mcp)

**Valor:** Complementa o MCP Supabase com o que ele não faz bem — diagnóstico de
performance: `EXPLAIN` com simulação de índices hipotéticos, índices não usados,
queries lentas (`pg_stat_statements`), bloat de tabelas, saúde de vacuum e locks.
Responde "por que está lento?" numa chamada.

> ⚠️ **Não** use o `@modelcontextprotocol/server-postgres` (reference da
> Anthropic): foi arquivado em 2025 com uma falha de SQL injection sem correção.
> Usamos o `crystaldba/postgres-mcp`, mantido e com modo read-only.

**Segurança:** roda em modo `restricted` (transações read-only + limite de tempo)
por padrão — seguro para apontar pra produção. O wrapper `scripts/mcp-postgres.sh`
lê a `DATABASE_URI` do `.env.mcp.local` (gitignored), nunca do JSON.

**Pré-requisito:** `uv`/`uvx` instalado (já presente nesta máquina).

**Setup:**

1. Pegue a connection string no painel: **Database settings → Connection string →
   URI** (use o pooler, troque `<senha>` pela senha do banco).
2. Adicione ao `.env.mcp.local`:

```env
DATABASE_URI=postgresql://postgres.zlzasfhcxcznaprrragl:<senha>@aws-1-us-east-1.pooler.supabase.com:5432/postgres
# POSTGRES_MCP_ACCESS_MODE=restricted   # read-only (padrão); use unrestricted só em dev
```

3. Reload Window.

Config no `mcp.json` (já aplicada):

```json
"postgres": {
  "command": "/caminho/absoluto/scripts/mcp-postgres.sh"
}
```

**Teste:** `Use o MCP postgres: liste índices não usados e as 5 queries mais lentas`

---

### P1 — Analyzer (Ruff + Vulture)

**Valor:** Lint e detecção de dead-code nos scripts Python do projeto
(`scripts/audit-*.py`, `.kiro/specs/**/*.py`). Ruff é o linter/formatador rápido;
Vulture acha código morto. Útil pra manter os scripts de auditoria/diagnóstico
limpos sem alternar pro terminal.

**Pacote:** `mcp-server-analyzer` via `uvx` — sem auth, sem credencial.

**Pré-requisito:** `uv`/`uvx` instalado (já presente nesta máquina).

Config no `mcp.json` (já aplicada):

```json
"analyzer": {
  "command": "/caminho/absoluto/scripts/mcp-analyzer.sh"
}
```

**Teste:** `Use o analyzer: rode ruff em scripts/audit-conversao.py e aponte dead-code`

---

### P1 — Sentry (debug produção)

**Valor:** Erros no portal (`src/main.tsx`) e edges com `SENTRY_DSN`. O MCP
permite buscar issues, stack traces e releases sem sair do Cursor.

**Pré-requisito:** Projeto Sentry criado e `SENTRY_DSN` / org configurados.

**Instalação** — OAuth hosted (recomendado):

```json
"sentry": {
  "url": "https://mcp.sentry.dev/mcp"
}
```

1. Adicione ao `mcp.json`
2. Reload Window
3. **Settings → Tools & MCP → Authorize** em `sentry`

Alternativa self-hosted: `npx -y @sentry/mcp-server` com `SENTRY_AUTH_TOKEN`
(restricted: `project:read`, `event:read`).

**Teste:** `Liste os 5 issues não resolvidos mais recentes no Sentry deste projeto`

---

### P2 — Stripe (wallet consultores)

**Valor:** Investigar webhooks de recarga, customers, payment intents das edges
`wallet-stripe-webhook` e `wallet-create-topup`.

**Segurança:** use **Restricted API Key** (Dashboard → Developers → API keys →
Create restricted key). Permissões mínimas: `Charges: Read`, `Customers: Read`,
`PaymentIntents: Read`, `Events: Read`. **Nunca** `sk_live_...` completa.

**Instalação:**

```json
"stripe": {
  "command": "npx",
  "args": ["-y", "@stripe/mcp", "--tools=customers.read,charges.read,paymentIntents.read,events.read"],
  "env": {
    "STRIPE_SECRET_KEY": "rk_test_..."
  }
}
```

Coloque a key em `.env.mcp.local` (gitignored):

```env
STRIPE_RESTRICTED_KEY=rk_test_...
```

E referencie via script wrapper (mesmo padrão do GitHub) para não commitar a key
no JSON — ou use `env` no mcp.json local apenas.

**Teste:** `Busque os últimos 10 payment intents failed via MCP Stripe`

---

### P2 — GitHub via Docker (migração futura)

O pacote npm `@modelcontextprotocol/server-github` usado pelo wrapper atual foi
**descontinuado em abril/2025**. Enquanto funcionar, mantenha `mcp-github.sh`.
Quando falhar, migre para a imagem oficial (Docker 29+ já instalado nesta máquina):

```json
"github": {
  "command": "docker",
  "args": [
    "run", "-i", "--rm",
    "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
    "ghcr.io/github/github-mcp-server"
  ],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."
  }
}
```

Ou hosted remoto (se disponível na sua conta GitHub): ver
[github/github-mcp-server](https://github.com/github/github-mcp-server).

---

### P3 — Docker MCP Gateway (workers)

**Valor:** Inspecionar/reiniciar containers dos workers Playwright sem terminal.

**Pré-requisito:** Docker Desktop ou engine + plugin `docker mcp`.

```bash
docker mcp profile create --name igreen-dev \
  --server catalog://docker-mcp-catalog/docker \
  --connect cursor
```

No `mcp.json`:

```json
"docker": {
  "command": "docker",
  "args": ["mcp", "gateway", "run"]
}
```

Só vale se você roda workers localmente com frequência; para deploy remoto o
GitHub Actions + Supabase MCP já cobrem o fluxo.

---

### P3 — Pesquisa web (Fetch / Brave)

Útil para Evolution API, Meta Graph API changelog, etc. **Não** substitui
Context7 para docs oficiais.

```json
"fetch": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-fetch"]
}
```

Brave Search (requer API key em brave.com/search/api):

```json
"brave-search": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-brave-search"],
  "env": {
    "BRAVE_API_KEY": "BSA..."
  }
}
```

---

### Exemplo: mcp.json completo (P0 + P1 + P2)

Gere a base com caminhos absolutos, depois mescle os blocos opcionais:

```bash
bash scripts/write-mcp-json.sh
# Edite .cursor/mcp.json e adicione context7, sentry, stripe
```

Estrutura alvo:

```json
{
  "mcpServers": {
    "supabase": {
      "url": "https://mcp.supabase.com/mcp?project_ref=zlzasfhcxcznaprrragl"
    },
    "github": {
      "command": "/caminho/absoluto/scripts/mcp-github.sh"
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest", "--headless"]
    },
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    },
    "sentry": {
      "url": "https://mcp.sentry.dev/mcp"
    },
    "stripe": {
      "command": "npx",
      "args": ["-y", "@stripe/mcp", "--tools=customers.read,charges.read,paymentIntents.read,events.read"],
      "env": {
        "STRIPE_SECRET_KEY": "rk_test_COLOQUE_AQUI"
      }
    }
  }
}
```

**Ordem de ativação sugerida:**

1. Corrigir P0 (OAuth Supabase + reload + toggles)
2. Adicionar **Context7** (zero friction)
3. **Sentry** se monitoramento já está em produção
4. **Stripe** quando debugar wallet/recargas
5. Docker / Fetch só se sentir falta no dia a dia

**Conflito browser:** mantenha **Playwright MCP** para E2E do projeto; desative
`cursor-ide-browser` no projeto se tools ficarem presas no sandbox.
