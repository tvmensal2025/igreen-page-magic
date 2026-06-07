## Plano

Os logs mostram que o container em produção ainda está rodando `igreen-sync-worker v10 (tor+playwright+2captcha)`. Esse build antigo para em `Nenhuma response /v1/login capturada` logo após clicar em **Entrar**.

No código atual do projeto, o worker já está em `v12` e já tem o fallback esperado:

```text
[login] clique não gerou /v1/login; tentando fallback POST direto com recaptchaToken
[login] fallback status=...
```

### 1. Alinhar versão nos arquivos de deploy
Atualizar os metadados ainda antigos para evitar confusão e forçar um novo build claro no Easypanel:

- `worker-igreen-sync/Dockerfile`
  - trocar comentários/label de `v10` para `v12`
- `worker-igreen-sync/README.md`
  - trocar título de `v11` para `v12`
  - documentar o fallback POST quando o clique não dispara `/v1/login`

### 2. Manter o código de login v12
Não reverter o fluxo atual. Ele deve continuar assim:

1. abre a página real de login via Playwright + Tor;
2. preenche email/senha;
3. resolve reCAPTCHA com 2captcha;
4. injeta token e tenta clicar em **Entrar**;
5. se nenhuma resposta `/v1/login` aparecer, faz `fetch` direto no browser com:

```json
{
  "email": "...",
  "password": "...",
  "recaptchaToken": "TOKEN_2CAPTCHA",
  "keepConnected": true
}
```

### 3. Validar sintaxe localmente
Rodar apenas validação estática do worker:

```text
node --check worker-igreen-sync/server.mjs
```

### 4. Rebuild/redeploy no Easypanel
Depois de aplicado, fazer rebuild do serviço `igreen-sync-worker` no Easypanel.

Validação esperada em `/health`:

```json
{
  "mode": "tor+playwright+2captcha-v12"
}
```

### 5. Interpretar o próximo `/last-debug`
Após o rebuild, o log correto precisa conter uma destas linhas:

```text
[login] fallback status=200
```

ou, se houver bloqueio real:

```text
[login] fallback status=401
[login] fallback status=403
```

Se ainda aparecer só:

```text
Nenhuma response /v1/login capturada
```

sem a linha de fallback, então o Easypanel ainda não está rodando o build v12.