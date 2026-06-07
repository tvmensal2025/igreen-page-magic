# Corrigir login do worker iGreen quando o botão não dispara `/v1/login`

## Diagnóstico
Pelos logs, o fluxo v10 abriu o login, preencheu e resolveu o captcha, mas depois de clicar **Entrar** ficou 60s esperando e terminou com:

```text
Nenhuma response /v1/login capturada
```

Isso significa que o botão/formulário da página não disparou a chamada de login. A IA dizer “captcha não marcado” não é necessariamente erro visual; o backend valida o token `g-recaptcha-response`/`recaptchaToken`, não o checkbox marcado.

## Plano

### 1. Adicionar fallback no `worker-igreen-sync/server.mjs`
Depois do clique em **Entrar**:
- manter a tentativa atual de capturar `/v1/login`;
- se não capturar nada em até ~10–15s, fazer um `fetch` dentro do próprio navegador para:

```text
POST https://api-voffice.igreenenergy.com.br/v1/login
```

com body:

```json
{
  "email": "...",
  "password": "...",
  "recaptchaToken": "TOKEN_2CAPTCHA",
  "keepConnected": true
}
```

Isso replica o padrão já existente em `worker-portal/playwright-automation.mjs`, onde há comentário indicando que a API exige `recaptchaToken` desde 2026-06.

### 2. Melhorar logs de diagnóstico
Adicionar linhas como:

```text
[login] clique não gerou /v1/login; tentando fallback POST /login com recaptchaToken
[login] fallback status=...
```

Assim fica claro se o problema é:
- botão não submetendo;
- captcha rejeitado;
- Cloudflare bloqueando;
- credencial inválida.

### 3. Manter OpenAI Vision/v11
Preservar a mudança anterior:
- `OPENAI_API_KEY` para visão;
- `mode: tor+playwright+2captcha-v11` ou subir para `v12` para confirmar novo deploy.

### 4. Atualizar README
Documentar que o worker agora tem fallback API direto quando o form visual não dispara.

## Validação esperada
Depois do rebuild no Easypanel:

- `/health` deve mostrar `mode: "tor+playwright+2captcha-v12"`;
- novo `/last-debug` deve mostrar uma destas saídas:
  - sucesso: `[login] fallback status=200` e depois `[login] OK consultor=...`;
  - bloqueio real: status `403` com HTML Cloudflare;
  - captcha/credencial: status `401` com body da API.
