## Objetivo

Replicar a config de Easypanel do `portal-worker-2` exatamente como estava na screenshot, **trocando apenas o nome do repo** `igreen-official-portal` → `igreen-page-magic`. Resolver o erro "Cannot access repository or branch main doesn't exist" sem mexer em mais nada (mesma aba Git/SSH, mesmo branch, mesmo build path).

## Diagnóstico do erro

Easypanel usa a aba **Git** com URL SSH (`git@github.com:...`). Pra acessar um repo privado via SSH, o GitHub precisa ter a **Deploy Key pública** do Easypanel cadastrada — uma por repo. Quando o repo era `igreen-official-portal` a chave já estava lá; o `igreen-page-magic` é repo novo e ainda não tem essa chave, então `git fetch` falha com "Cannot access repository".

Branch `main` provavelmente existe — a mensagem genérica do Easypanel cobre os 2 casos (sem acesso OU sem branch). Sem acesso, ele nem consegue listar branches.

## Ação (no painel, sem código)

### 1. Pegar a Deploy Key do Easypanel

No Easypanel, no serviço `portal-worker-2`:
1. Aba **Fonte → Git**
2. Procurar bloco **SSH Key** ou **Deploy Key** (geralmente abaixo do campo "URL do Repositório" ou em **Configurações → SSH**)
3. **Copiar a chave pública** (começa com `ssh-ed25519` ou `ssh-rsa`)

Se não achar no serviço, é por projeto: `Easypanel → Settings → Git → SSH Public Key`.

### 2. Cadastrar a chave no novo repo

1. Abrir: `https://github.com/tvmensal2025/igreen-page-magic/settings/keys/new`
2. **Title**: `easypanel-portal-worker-2`
3. **Key**: colar a chave pública copiada
4. **Allow write access**: deixar **desmarcado** (Easypanel só faz pull)
5. **Add key**

### 3. Confirmar a config no Easypanel (igual à screenshot)

```
Aba: Git
URL do Repositório: git@github.com:tvmensal2025/igreen-page-magic.git
Ramo:               main
Caminho de Build:   /worker-portal-2
```

→ **Salvar** → **Implantar** (Rebuild).

### 4. Repetir pros outros 2 workers

Mesma Deploy Key serve pro mesmo repo. Então cadastrar **uma vez só** no GitHub já vale pros 3:

| Serviço | Build path |
|---|---|
| `portal-worker-2` | `/worker-portal-2` |
| `worker-igreen` (sync) | `/worker-igreen-sync` |
| `compress-worker` | `/compress-worker` |

Para cada um: aba **Git** → mesma URL SSH → `main` → build path da tabela → **Salvar** → **Implantar**.

### 5. `portal-worker` (Portal 1)

**NÃO MEXER.** Continua apontando pra `git@github.com:tvmensal2025/igreen-official-portal.git` (ou o repo anterior), build path `/worker-portal`. Pasta `worker-portal/` não existe em `igreen-page-magic` — trocar quebraria.

## Validação

Após "Implantar", em **Implantações** verificar:
- Log mostra `Cloning git@github.com:tvmensal2025/igreen-page-magic.git` sem erro de auth
- Build path encontra `Dockerfile` em `/worker-portal-2`
- Container sobe e `GET /health` retorna 200

## Plano B — se Deploy Key não funcionar

Se o Easypanel não expõe SSH key por serviço, alternativa é trocar pra **HTTPS com token**:
- URL: `https://oauth2:<GITHUB_PAT>@github.com/tvmensal2025/igreen-page-magic.git`
- Criar PAT em `https://github.com/settings/tokens` com escopo `repo`
- Mesma branch/build path

Ou usar a **aba Github** (App) em vez de Git: clicar **Github** → autorizar app → escolher repo → salvar. Mais simples se tiver o app já instalado.

## Fora de escopo

- Código, secrets, edge functions, migrations
- `portal-worker` (Portal 1)
- Renomear repo, mover arquivos entre repos

## Entrega

Instruções passo-a-passo no chat (sem mudança de código). Documentação atualizada anteriormente já reflete `igreen-page-magic` — fica como está.
