# REQ 5 · Tarefa 5.1 — Provisionamento do segredo `SERVICE_SHARED_SECRET`

> **Status:** PREPARADO — não auto-aplicável. Exige **aprovação humana explícita** e
> execução por um operador com acesso ao projeto Supabase. Nenhum valor real de
> segredo é (ou deve ser) commitado em código-fonte.

## Objetivo

Provisionar o segredo de ambiente `SERVICE_SHARED_SECRET` nas Edge Functions do
projeto. Esse segredo é o valor esperado no header `x-service-secret` usado pela
guarda IDOR (`_shared/caller-auth.ts`, tarefa 5.3) para classificar uma chamada
como `mode: "service"`.

Ele precisa existir **antes** de:

- **Tarefa 5.2** — `evolution-webhook` passa a enviar `x-service-secret` na chamada
  interna ao `ai-agent-router`.
- **Tarefa 5.6** — aplicar a guarda em `ai-agent-router`.

Se a guarda em `ai-agent-router` (5.6) for aplicada antes do segredo existir, a
chamada interna `evolution-webhook → ai-agent-router` deixa de ser reconhecida como
`mode: "service"` e passa a falhar (401). Por isso a ordem é: **5.1 (este passo) →
5.2 → 5.6**.

## Identidade do segredo (confirmada)

| Item | Valor | Onde está confirmado |
|------|-------|----------------------|
| Nome da variável | `SERVICE_SHARED_SECRET` | `design.md` (Components/Interfaces, Rollout) e `tasks.md` 5.1/5.3 |
| Header HTTP | `x-service-secret` | `design.md` (`resolveCaller`) e `tasks.md` 5.2/5.3 |
| Leitura no código | `Deno.env.get("SERVICE_SHARED_SECRET")` | padrão já usado no repo (ex.: `evolution-webhook/index.ts` lê `EVOLUTION_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` via `Deno.env.get`) |
| Comparação | tempo constante (timing-safe) no `resolveCaller` | `design.md` Property 5 / Error Handling |
| Projeto Supabase | `zlzasfhcxcznaprrragl` | `supabase/config.toml` (`project_id`) e `.github/workflows/deploy-edge-functions.yml` (`SUPABASE_PROJECT_REF`) |

**Consistência com o spec arquivado:** os mesmos nomes (`SERVICE_SHARED_SECRET`,
`x-service-secret`, `_shared/caller-auth.ts`) aparecem em
`.kiro/specs/security-hardening-lgpd/design.md` e `tasks.md` (8.2). Provisionar
uma única vez atende aos dois specs — não criar variantes de nome.

## Funções que consomem o segredo

Todas rodam com `service_role` e `verify_jwt = false` (ver `supabase/config.toml`).
A guarda (`resolveCaller` + `assertOwnership`) será aplicada em:

- `capture-extract` (tarefa 5.4)
- `upload-documents-minio` (tarefa 5.5)
- `ai-agent-router` (tarefa 5.6)
- `ai-sales-agent` (tarefa 5.7)
- `facebook-capi` (tarefa 5.8)

Emissor do header na chamada interna: `evolution-webhook` (tarefa 5.2).

> Secrets de Edge Functions no Supabase são **globais ao projeto** (não por função),
> então um único `supabase secrets set` disponibiliza `SERVICE_SHARED_SECRET` para
> todas as funções acima via `Deno.env.get(...)`.

## Como gerar o valor do segredo

Gerar um token de alta entropia (≥256 bits). Exemplos de geração local (escolha um):

```bash
# hex de 32 bytes (256 bits) — recomendado: URL/header-safe, sem caracteres especiais
openssl rand -hex 32

# alternativa base64url (sem +, /, =)
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

**Valor de exemplo (PLACEHOLDER — NÃO USAR EM PRODUÇÃO, NÃO É SEGREDO REAL):**

```
SERVICE_SHARED_SECRET=PLACEHOLDER_a1b2c3d4e5f6_substituir_por_openssl_rand_hex_32
```

> O placeholder acima existe apenas para ilustrar o formato. Gere um valor novo no
> momento do provisionamento e **nunca** cole o valor real neste arquivo, em
> commits, PRs, issues ou logs.

## Procedimento de provisionamento (a executar por um humano após aprovação)

### Opção A — Supabase CLI (recomendado)

```bash
# 1. Gerar o valor (não ecoar em logs compartilhados)
SECRET="$(openssl rand -hex 32)"

# 2. Provisionar como secret do projeto (global a todas as edge functions)
supabase secrets set SERVICE_SHARED_SECRET="$SECRET" \
  --project-ref zlzasfhcxcznaprrragl

# 3. Conferir que existe (a CLI mostra o NOME e um digest, nunca o valor)
supabase secrets list --project-ref zlzasfhcxcznaprrragl | grep SERVICE_SHARED_SECRET

# 4. Limpar a variável da sessão do shell
unset SECRET
```

Requer `SUPABASE_ACCESS_TOKEN` no ambiente (mesmo token usado pelo workflow
`deploy-edge-functions.yml`).

### Opção B — Dashboard Supabase

1. Acessar:
   `https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/settings/functions`
2. Seção **Edge Functions → Secrets** (Manage secrets).
3. **Add new secret** → Name: `SERVICE_SHARED_SECRET` → Value: (colar o valor gerado).
4. Salvar.

### Opção C — Painel Lovable

`Workspace Settings → Project Settings → Secrets` → adicionar `SERVICE_SHARED_SECRET`
(conforme nota no topo de `supabase/functions/.env.example`).

### Após provisionar

- Redeploy das funções que leem o segredo para garantir que o novo env é injetado
  (o runtime injeta secrets no boot da função). Via workflow manual
  `Deploy Edge Functions` (`workflow_dispatch`) com `function_name=all`, ou:

  ```bash
  supabase functions deploy --project-ref zlzasfhcxcznaprrragl
  ```

  Observação: o redeploy efetivo das 5 funções + `evolution-webhook` acontece
  naturalmente quando as tarefas 5.2–5.8 forem aplicadas; este passo só garante
  que o segredo já está disponível antes da guarda 5.6.

## Como o código vai ler o segredo (sem literal)

No helper `_shared/caller-auth.ts` (tarefa 5.3) e na chamada interna do
`evolution-webhook` (tarefa 5.2), sempre via `Deno.env`:

```ts
// leitura — nunca hardcodar o valor
const SERVICE_SHARED_SECRET = Deno.env.get("SERVICE_SHARED_SECRET") || "";

// resolveCaller (5.3): comparação em tempo constante contra o header
//   header recebido: req.headers.get("x-service-secret")
//   comparar com SERVICE_SHARED_SECRET usando timingSafeEqual

// evolution-webhook → ai-agent-router (5.2): envio do header
//   headers: { ..., "x-service-secret": SERVICE_SHARED_SECRET }
```

## Regras de higiene (REQ 5.8) — obrigatórias

- **Nunca** commitar o valor real em código-fonte, migrações, testes, PRs ou docs.
- **Nunca** logar o valor (`console.log`) — nem parcialmente. A comparação é
  timing-safe; logar o segredo anula a proteção.
- O `.env.example` (`supabase/functions/.env.example`) documenta **apenas o nome**
  da variável, sem valor — convenção já adotada para os demais segredos.
- Em caso de vazamento suspeito, **rotacionar**: gerar novo valor, `supabase secrets
  set` novamente e redeploy. Como o segredo é simétrico (mesmo valor no emissor e no
  validador), a rotação é atômica num único `set` global + redeploy.

## Checklist de pré-rollout (REQ 6 — processo)

- [ ] Aprovação humana explícita obtida (não auto-aplicar).
- [ ] Valor gerado com `openssl rand` (≥256 bits), fora de qualquer arquivo versionado.
- [ ] `supabase secrets set SERVICE_SHARED_SECRET=...` executado no projeto
      `zlzasfhcxcznaprrragl`.
- [ ] `supabase secrets list` confirma a presença do nome (sem expor valor).
- [ ] Segredo provisionado **antes** de aplicar a guarda 5.6 em `ai-agent-router`.
- [ ] Nenhum literal de segredo em código/log (validado pelo smoke estático 5.12).

## Rollback / desprovisionamento

```bash
supabase secrets unset SERVICE_SHARED_SECRET --project-ref zlzasfhcxcznaprrragl
```

> Só desprovisionar **após** reverter as guardas 5.2–5.8 (redeploy do artefato
> anterior das funções). Remover o segredo enquanto a guarda em `ai-agent-router`
> ainda estiver ativa quebraria a chamada interna `evolution-webhook → ai-agent-router`.
