## Diagnóstico

O teste manual na VPS confirma que o repositório `tvmensal2025/igreen-official-portal@main` está **acessível e íntegro** (160 MB baixados com sucesso). Logo, o erro `curl: (23) ... passed 1370` do Easypanel **não é** problema de rede, disco, Dockerfile ou repositório — é **configuração errada do app `worker-igreen` no próprio Easypanel** (owner/repo/branch divergente, ou GitHub App sem permissão nesse repo específico).

## Plano de correção (sem alterar código)

### 1. Confirmar o que está gravado no app `worker-igreen`
Na VPS:
```bash
cat /etc/easypanel/projects/igreen/worker-igreen/config.json | grep -E '"(owner|repo|ref|path|source)"'
```
Comparar com o que deveria estar:
- owner: `tvmensal2025`
- repo: `igreen-official-portal`
- ref: `main`
- path: `worker-igreen-sync`
- source: `github` (não `image`)

### 2. Corrigir a Source no painel do Easypanel
App `worker-igreen` → **Source**:
- Tipo: **Github** (não Docker Image)
- Proprietário: `tvmensal2025`
- Repositório: `igreen-official-portal`
- Ramo: `main`
- Caminho de Build: `worker-igreen-sync`

Salvar.

### 3. Reautorizar a GitHub App (se o passo 1 mostrar tudo certo)
Settings → Integrations → GitHub → **Reauthorize** e marcar acesso ao repo `igreen-official-portal`. Sem isso, o GitHub responde 404 mesmo com config correta → vira `~1.3 KB` → `tar: Unexpected EOF`.

### 4. Limpar o cache quebrado e fazer deploy
```bash
rm -rf /etc/easypanel/projects/igreen/worker-igreen/code
mkdir -p /etc/easypanel/projects/igreen/worker-igreen/code
```
No painel → **Deploy** (não Start). Acompanhar logs até ver `Successfully tagged easypanel/igreen/worker-igreen:latest`.

### 5. Validar
```bash
docker images | grep worker-igreen
curl -s https://igreen-sync.d9v83a.easypanel.host/health
```
Esperado: `{ "ok": true, "sessions": 0, "uptime_s": ... }`.

### 6. Atualização de documentação (após sucesso)
Adicionar ao `worker-igreen-sync/README.md` uma seção **"Validação de repositório OK em 2026-06-06"** registrando que `curl -L ... archive/refs/heads/main.tar.gz` retorna 160 MB, para futuras AIs/devs não perderem tempo re-diagnosticando rede ou Dockerfile.

## Nada que NÃO será feito
- Nenhuma mudança em `Dockerfile`, `server.mjs`, `package.json` do worker.
- Nenhum toque em `worker-portal/` ou `worker-portal-2/`.
- Nenhuma mudança no frontend ou edge functions.
