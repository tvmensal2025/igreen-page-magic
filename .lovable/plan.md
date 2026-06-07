## Objetivo
Destravar a sincronização de clientes iGreen integrando o serviço 2captcha ao `worker-igreen-sync`, resolvendo o reCAPTCHA que o endpoint `POST /v1/login` passou a exigir.

## Como vai funcionar

```text
sync-igreen-customers (edge)
        │  POST + x-worker-token
        ▼
worker-igreen-sync  ──①──►  2captcha.com  (resolve reCAPTCHA, ~20s)
        │                       │
        │◄────── gToken ────────┘
        │
        ②  POST /v1/login  { email, password, recaptchaToken }
        ▼
   api-voffice.igreenenergy.com.br  → accessToken
        │
        ③ /customer-map paginado (token Bearer, sem captcha)
```

- Token de login dura ~30min → resolvemos captcha **só 1x a cada 30min por consultor** (pool em memória já existe).
- Custo estimado: ~US$0,003 por sync (1 captcha ≈ R$0,015).

## Passos

1. **Salvar o secret** `TWOCAPTCHA_API_KEY` no Lovable Cloud (vou pedir via `add_secret`; já tenho a chave que você passou).

2. **Descobrir o sitekey do reCAPTCHA** do portal iGreen
   - Faço um `curl` em `https://escritorio.igreenenergy.com.br/login` e extraio o `data-sitekey` do HTML.
   - Verifico o nome do campo que a API espera (`recaptcha`, `recaptchaToken`, `g-recaptcha-response`, etc.) — inspeciono o bundle JS do portal para confirmar.

3. **Implementar `solveRecaptcha()` em `worker-igreen-sync/server.mjs`**
   - `POST https://2captcha.com/in.php` com `key`, `method=userrecaptcha`, `googlekey`, `pageurl`, `json=1` → retorna `request_id`.
   - Poll `GET https://2captcha.com/res.php?key=...&action=get&id=...&json=1` a cada 5s, timeout 120s.
   - Retorna o `gRecaptchaResponse`.
   - Trata erros (`ERROR_ZERO_BALANCE`, `ERROR_CAPTCHA_UNSOLVABLE` etc.) com mensagens claras.

4. **Ajustar `loginAndGetToken()`**
   - Antes do POST `/login`, chama `solveRecaptcha()`.
   - Envia o token no body do login (campo a confirmar no passo 2).
   - Se a API ainda retornar 401, retry 1x com novo captcha (token pode ter "queimado").

5. **Atualizar variáveis de ambiente do worker**
   - Adicionar `TWOCAPTCHA_API_KEY` no `easypanel` (worker-igreen). Te passo o valor para colar.

6. **Atualizar `worker-portal/playwright-automation.mjs`**
   - Aplicar o mesmo `solveRecaptcha` na função `buscarCadastroExistenteIgreen` (mesmo problema).

7. **Validar end-to-end**
   - Redeploy do worker → `/health` ok.
   - Chamo `sync-igreen-customers` via curl → conferir `success: true` com lista de clientes.
   - Se falhar, leio `/last-debug` e os logs da edge.

## Detalhes técnicos

- **Sem mudanças no schema do banco** — só código de worker e secret.
- **Sem mudanças na edge function** `sync-igreen-customers` — ela só repassa `portal_email`/`portal_password`.
- **Sem mudança na UI do admin** — a senha continua sendo salva e usada normalmente.
- **Cache de token 30min** já existe (`SESSION_TTL_MS`), então o gasto com 2captcha é mínimo mesmo com muitos consultores.
- **Fallback**: se 2captcha estiver fora do ar, retorna 502 claro ("captcha service unavailable") em vez de 401 confuso.

## Arquivos que vou tocar

- `worker-igreen-sync/server.mjs` — adiciona `solveRecaptcha()` + chama em `loginAndGetToken()`.
- `worker-igreen-sync/README.md` — atualiza explicação (hoje afirma incorretamente que "não precisa captcha").
- `worker-portal/playwright-automation.mjs` — aplica mesmo fluxo em `buscarCadastroExistenteIgreen`.

## O que você precisa fazer depois que eu implementar

1. Colar `TWOCAPTCHA_API_KEY=63e53153b5b7dfbae1f63ce40c41444e` no easypanel do `worker-igreen`.
2. Redeploy do container.
3. Clicar em "Sincronizar" no painel → eu valido junto.
