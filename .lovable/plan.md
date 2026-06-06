
# Configurar `igreen-sync-worker` no Easypanel

Como o GitHub App **já tem acesso** ao repo e mesmo assim aparece "Repository not found", o problema está **nos valores do formulário Source → Github**. O Easypanel é muito literal: qualquer barra a mais, owner errado ou ramo inexistente devolve esse erro genérico.

## 1. Valores EXATOS na aba Source → Github

Copie/cole exatamente assim (sem aspas, sem barras extras):

```text
Proprietário (Owner):   tvmensal2025
Repositório (Repository): portal-oficial-igreen
Ramo (Branch):           main
Caminho de Build (Build Path):  /worker-igreen-sync
```

Pontos onde a maioria erra e dá "Repository not found":

- **Owner** é só `tvmensal2025` — NÃO colocar `tvmensal2025/portal-oficial-igreen` ali.
- **Repository** é só `portal-oficial-igreen` — sem `.git`, sem URL completa, sem owner junto.
- **Branch** precisa existir no GitHub. Confirme em `https://github.com/tvmensal2025/portal-oficial-igreen/branches` que existe `main` (e não `master`).
- **Build Path** começa com `/` e é o **diretório**, não um arquivo. Correto: `/worker-igreen-sync`. Errado: `worker-igreen-sync/`, `/worker-igreen-sync/Dockerfile`, `./worker-igreen-sync`.

Depois de preencher, clicar em **Salvar**. Se aparecer "Repository not found" mesmo assim, ir para o passo 2.

## 2. Reautorizar o GitHub App (mesmo já tendo acesso)

Quando o repo foi **renomeado** ou **transferido** depois da instalação do app, o Easypanel guarda o ID antigo e dá "not found" até reautorizar. Resolve assim:

1. Abrir: `https://github.com/settings/installations`
2. Clicar em **Configure** no app **Easypanel**
3. Em **Repository access**, escolher **All repositories** (mais simples) — OU em **Only select repositories** garantir que `portal-oficial-igreen` está marcado, **remover** e **adicionar de novo** (força o refresh).
4. **Save**.
5. Voltar no Easypanel, na mesma tela Source → Github, **recarregar a página** (F5) e salvar de novo.

## 3. Restante da configuração do serviço

Depois que o Source aceitar, completar:

**Aba Build**
- Builder: **Dockerfile** (Easypanel detecta sozinho dentro de `/worker-igreen-sync`)

**Aba Environment**
```text
PORT=3102
NODE_ENV=production
PLAYWRIGHT_HEADLESS=true
WORKER_TOKEN=<gerar um segredo longo aleatório e guardar>
```

**Aba Network / Domains**
- Porta exposta: `3102`
- Domínio: `igreen-sync.d9v83a.easypanel.host`

**Recursos sugeridos:** 1 CPU / 1 GB RAM (Chromium consome memória).

## 4. Conectar no Supabase (depois do deploy verde)

Rodar uma vez no SQL Editor do Supabase, usando o **mesmo** `WORKER_TOKEN` do passo 3:

```sql
INSERT INTO settings (key, value) VALUES
  ('igreen_sync_worker_url',    'https://igreen-sync.d9v83a.easypanel.host'),
  ('igreen_sync_worker_secret', '<mesmo WORKER_TOKEN do Easypanel>')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

## 5. Validação

```bash
curl https://igreen-sync.d9v83a.easypanel.host/health
# esperado: {"ok":true,"sessions":0,"uptime_s":...}
```

Se o health responder, o worker está pronto e a edge function `sync-igreen-customers` já passa a usar ele automaticamente.

---

**O que eu preciso de você antes de prosseguir:** confirme que vai usar os valores do passo 1 exatamente como acima (em especial o **Build Path = `/worker-igreen-sync`** e o **Owner = `tvmensal2025` sozinho**). Se mesmo assim falhar, me manda o print da tela Source com os campos preenchidos que eu te aponto o campo errado.
