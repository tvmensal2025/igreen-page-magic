## Novo erro: `No such image: easypanel/igreen/worker-igreen:latest`

Esse erro é **diferente** do anterior (`curl: (23)` / `Unexpected EOF`).

Agora o GitHub Archive foi baixado e extraído. O problema é que o Easypanel está tentando **rodar** o container, mas a **imagem Docker não existe** localmente.

```text
No such image: easypanel/igreen/worker-igreen:latest
```

Isso significa: o **build não terminou com sucesso**, ou nunca rodou, ou rodou mas não taggeou a imagem com esse nome. O Easypanel pulou direto para a etapa de "start" usando uma imagem que ainda não foi construída.

## Causa mais provável

1. O build do Dockerfile falhou silenciosamente e o Easypanel mesmo assim tentou subir.
2. O `Build Path` está apontando para uma pasta sem `Dockerfile` válido — então não há nada para construir, mas o Easypanel tenta iniciar a imagem mesmo assim.
3. O usuário clicou em **Deploy/Start** antes de **Build**, ou o build foi cancelado.
4. Existe um app antigo `worker-igreen` em estado inconsistente apontando para uma imagem que nunca foi criada.

## O que precisa ser verificado no Easypanel

No app `worker-igreen`, conferir:

### 1. Source

```text
Type: Github (NÃO "Docker Image")
Owner: tvmensal25
Repository: portal-oficial-igreen
Branch: main
Build Path: worker-igreen-sync
```

Confirmar que `Build Path` é exatamente `worker-igreen-sync` (sem `/`, sem `/Dockerfile`).

Se o Source estiver como **Docker Image** em vez de **Github**, o Easypanel não vai buildar — ele vai só tentar `docker pull` numa imagem que não existe. Esse é provavelmente o problema.

### 2. Build

Ir na aba **Deployments** / **Build Logs** do app e verificar:

- Houve build recente?
- O build terminou com `Successfully tagged ...` ou com erro?
- Se nunca rodou um build com sucesso, a imagem `easypanel/igreen/worker-igreen:latest` simplesmente não existe no Docker da VPS.

### 3. Verificar imagens existentes na VPS

Via SSH:

```bash
docker images | grep worker-igreen
docker images | grep easypanel/igreen
```

Se não aparecer nada, confirma que o build nunca produziu a imagem.

## Ações recomendadas

### Ação 1 — Forçar rebuild

No Easypanel, no app `worker-igreen`:

1. Garantir que Source = **Github** com os campos acima.
2. Clicar em **Deploy** (não em **Start**).
3. Acompanhar **Build Logs** até o final.
4. Só vai funcionar quando aparecer algo como `Successfully tagged easypanel/igreen/worker-igreen:latest`.

### Ação 2 — Recriar o app

Se o app está em estado quebrado, o caminho mais limpo é:

1. Deletar o app `worker-igreen` no Easypanel.
2. Criar de novo:

```text
Projeto: igreen
Nome: worker-igreen
Source: Github
Owner: tvmensal25
Repository: portal-oficial-igreen
Branch: main
Build Path: worker-igreen-sync
Port: 3102
```

3. Adicionar env vars:

```text
PORT=3102
NODE_ENV=production
PLAYWRIGHT_HEADLESS=true
WORKER_TOKEN=<segredo>
```

4. Clicar em **Deploy** e aguardar o build completo.

### Ação 3 — Limpar resíduos na VPS

Via SSH, se necessário:

```bash
docker ps -a | grep worker-igreen
docker rm -f $(docker ps -aq --filter "name=worker-igreen") 2>/dev/null
docker images | grep worker-igreen
docker rmi -f $(docker images -q --filter "reference=easypanel/igreen/worker-igreen") 2>/dev/null
rm -rf /etc/easypanel/projects/igreen/worker-igreen/code
```

Depois redeploy no Easypanel.

## Resumo

- O erro mudou. Agora não é mais download do GitHub — é **imagem Docker inexistente**.
- Causa principal: build nunca rodou com sucesso, ou o app está configurado como Docker Image em vez de Github.
- Verificar Source, rodar Deploy, ler os Build Logs até o final.
- Se continuar quebrado, deletar e recriar o app no Easypanel.
- Nada precisa mudar no código do `worker-igreen-sync/` nesta etapa.

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>