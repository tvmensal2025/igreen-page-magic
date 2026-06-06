# Plano de correção — Easypanel falha ao baixar o GitHub Archive

## Diagnóstico principal

O erro atual não é mais “Repository not found”. Agora o Easypanel conseguiu iniciar o download do repositório, mas falhou ao escrever/extrair o arquivo baixado:

```text
curl: (23) Failure writing output to destination
passed 1370 returned 0

gzip: stdin: unexpected end of file
tar: Unexpected EOF in archive
```

Isso acontece antes do Dockerfile rodar. Portanto, o problema está no host/Easypanel durante o download ou gravação do archive do GitHub.

## Causa mais provável

A causa mais forte é falta de espaço, permissão ou diretório quebrado em:

```text
/etc/easypanel/projects/igreen/worker-igreen/code
```

O `curl` recebeu dados do GitHub, tentou escrever no destino, mas o sistema retornou `0` bytes escritos. Em seguida o `tar` tentou abrir um arquivo incompleto, por isso apareceu `Unexpected EOF in archive`.

## Verificações na VPS

Rodar estes comandos via SSH na VPS:

```bash
df -h
```

Confirmar se `/`, `/etc` ou o disco principal está 100% cheio.

```bash
df -i
```

Confirmar se os inodes acabaram.

```bash
ls -ld /etc/easypanel/projects/igreen/worker-igreen/code
```

Confirmar se o diretório existe e se o Easypanel consegue escrever nele.

## Limpeza segura recomendada

Se o disco estiver cheio ou quase cheio, limpar caches e builds antigos:

```bash
docker system df
```

Depois:

```bash
docker builder prune -af
```

Se ainda precisar liberar mais espaço:

```bash
docker image prune -af
```

E, com cuidado:

```bash
docker container prune -f
```

Evitar apagar volumes com `docker volume prune` sem verificar, porque pode remover dados persistentes.

## Reset do diretório de código do app

Se houver espaço livre e o erro continuar, remover somente o cache/código baixado desse app para o Easypanel baixar novamente:

```bash
rm -rf /etc/easypanel/projects/igreen/worker-igreen/code
```

Depois voltar no Easypanel e clicar novamente em deploy.

## Conferir configuração correta no Easypanel

Manter estes valores:

```text
App: worker-igreen
Source: GitHub
Repository: tvmensal25/portal-oficial-igreen
Branch: main
Build Path: worker-igreen-sync
Port: 3102
```

Importante: o Build Path deve ser apenas a pasta, sem barra inicial e sem Dockerfile:

```text
worker-igreen-sync
```

Não usar:

```text
/worker-igreen-sync
/worker-igreen-sync/Dockerfile
worker-igreen-sync/Dockerfile
```

## Se ainda falhar depois disso

1. Reautorizar o GitHub App do Easypanel para `tvmensal25/portal-oficial-igreen`.
2. Tentar deploy novamente.
3. Se o erro continuar exatamente igual, atualizar/reiniciar o Easypanel, porque a falha está no mecanismo de download/extract do próprio Easypanel.

## Resultado esperado

Depois de liberar espaço ou resetar o diretório `code`, o log deve passar da etapa:

```text
Download Github Archive Started
```

E só então entrar no build Docker do `worker-igreen-sync`.