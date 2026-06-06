## Confirmação do propósito do worker

O `worker-igreen-sync` é, e continua sendo:

```text
Worker Playwright que LÊ dados de clientes e rede do
portal iGreen (escritorio.igreenenergy.com.br),
chamado pela edge function sync-igreen-customers.
```

Não tem nada de Facebook. Endpoints existentes:

```text
GET  /health
POST /sync-customers   → JSON cru de /customer-map
POST /sync-network     → JSON cru de /network-map
```

Conectado em `https://api-voffice.igreenenergy.com.br/v1`. Isso está correto no `server.mjs` atual e não precisa mudar.

## O erro real que está bloqueando o deploy

O erro recebido do Easypanel é:

```text
curl: (23) Failure writing output to destination, passed 1370 returned 0
gzip: stdin: unexpected end of file
tar: Unexpected EOF in archive
```

Isso acontece **antes do Dockerfile rodar**. O Easypanel baixa só ~1.3 KB do GitHub e tenta descompactar como `.tar.gz`. 1.3 KB nunca é um repositório real — quase sempre é uma resposta de erro do GitHub (404, página de login, permissão negada) sendo tratada como tar.

Ou seja: continuar mexendo no Dockerfile ou no `server.mjs` **não vai resolver**.

## Achado importante na auditoria

A documentação atual do `worker-igreen-sync/README.md` manda configurar o Easypanel apontando para:

```text
Owner: tvmensal25
Repository: portal-oficial-igreen
```

Mas todo o histórico do projeto, e o próprio commit que o Lovable está empurrando agora, usam:

```text
Owner: tvmensal2025
Repository: viana-replica-vault
```

Se o Easypanel estiver configurado em `tvmensal25/portal-oficial-igreen` e esse repo não existir / não tiver permissão / não tiver a pasta `worker-igreen-sync`, o GitHub responde algo curtinho, o curl grava só ~1.3 KB e o tar quebra — exatamente o erro atual.

## Plano de correção

### 1. Confirmar o repositório GitHub correto

Você precisa me dizer qual destes dois é o repositório vivo onde o código do Lovable aterrissa:

```text
A) tvmensal2025/viana-replica-vault       (histórico do projeto)
B) tvmensal25/portal-oficial-igreen       (README atual)
C) outro                                  (qual?)
```

Sem essa confirmação, qualquer mudança de doc/config seria chute.

### 2. Validar manualmente o archive na VPS

Antes de mexer no Easypanel, rodar via SSH (substituindo pelo repo confirmado):

```bash
curl -L -o /tmp/igreen.tar.gz \
  https://github.com/<owner>/<repo>/archive/refs/heads/main.tar.gz
ls -lh /tmp/igreen.tar.gz
file /tmp/igreen.tar.gz
tar -tzf /tmp/igreen.tar.gz | grep worker-igreen-sync/Dockerfile
```

Esperado:

```text
arquivo com tamanho real (centenas de KB ou mais)
file: gzip compressed data
tar lista worker-igreen-sync/Dockerfile
```

Se vier 1.3 KB, abrir o conteúdo com `cat /tmp/igreen.tar.gz` mostra exatamente qual a resposta do GitHub (404, login, etc).

### 3. Corrigir o app `worker-igreen` no Easypanel

Após confirmar o repo correto, ajustar o app:

```text
Source: Github          (não Docker Image)
Owner: <owner correto>
Repository: <repo correto>
Branch: main
Build Path: worker-igreen-sync
Port: 3102
```

Variáveis:

```text
PORT=3102
NODE_ENV=production
PLAYWRIGHT_HEADLESS=true
WORKER_TOKEN=<segredo longo, mesmo valor do IGREEN_SYNC_WORKER_SECRET no Supabase>
```

Limpar cache de código quebrado:

```bash
rm -rf /etc/easypanel/projects/igreen/worker-igreen/code
```

Clicar em **Deploy** e acompanhar os logs até aparecer `Successfully tagged easypanel/igreen/worker-igreen:latest`.

### 4. Quando você aprovar, atualizo no código

Assim que o deploy funcionar, eu devo (em build mode):

```text
- Corrigir worker-igreen-sync/README.md com o owner/repo verdadeiros
- Atualizar a seção de erro "curl: (23)" para explicar que
  "passed 1370" indica archive HTML/404/permissão, não disco cheio
- Remover do .lovable/plan.md a configuração antiga suspeita
- Manter server.mjs e Dockerfile como estão (já estão corretos)
```

## O que NÃO vou tocar

```text
- worker-portal-2  (não tem relação com esse erro)
- worker-portal    (não tem relação com esse erro)
- supabase/functions/sync-igreen-customers (já está correto,
  só consome /sync-customers do worker quando ele estiver no ar)
```

## Pergunta para destravar

Confirma qual é o repositório GitHub real onde esse projeto está sincronizando? Sem isso eu não consigo apontar o Easypanel para o lugar certo.  
[https://github.com/tvmensal2025/igreen-official-portal](https://github.com/tvmensal2025/igreen-official-portal)