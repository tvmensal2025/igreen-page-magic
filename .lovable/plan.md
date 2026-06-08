Plano para ajustar o login do `igreen-sync-worker`:

1. Criar uma rotina dedicada de confirmação do reCAPTCHA após injetar o token do 2captcha.
   - Verificar se o widget aparenta estar marcado usando sinais do DOM/iframe/textarea.
   - Se ainda parecer “não marcado”, tentar clicar imediatamente no checkbox/iframe do reCAPTCHA antes de clicar em “Entrar”.
   - Aguardar alguns segundos curtos após esse clique para o widget atualizar.

2. Alterar o fluxo de login antes do botão “Entrar”.
   - Hoje o worker injeta o token e já vai para `clicando "Entrar"`.
   - O novo fluxo será: resolver 2captcha → injetar token → confirmar/acionar checkbox se necessário → tirar snapshot → clicar “Entrar”.
   - Adicionar logs claros como:
     - `[captcha] token injetado; verificando checkbox`
     - `[captcha] widget ainda não marcado; clicando checkbox antes de Entrar`
     - `[captcha] widget aparenta estar marcado; seguindo para Entrar`

3. Manter o fallback v13 existente.
   - Se mesmo após confirmar/clicar no captcha o botão “Entrar” não gerar `/v1/login`, manter o fallback `context.request.post` com `recaptchaToken`.
   - Continuar distinguindo HTML/Cloudflare 403 de erro real de credencial.

4. Atualizar versão e documentação.
   - Subir o worker para `v14` no `server.mjs`, `Dockerfile`, `README.md` e `package.json`.
   - Documentar que a v14 tenta acionar/confirmar o reCAPTCHA antes de clicar em “Entrar”.

5. Validar localmente sem rodar deploy.
   - Rodar apenas checagem de sintaxe com `node --check worker-igreen-sync/server.mjs`.
   - Após rebuild/redeploy no Easypanel, validar:
     - `/health` com `mode: tor+playwright+2captcha-v14`
     - `/last-debug` contendo os novos logs de verificação/clique do captcha antes de `clicando "Entrar"`.

Observação: `.lovable/` está no `.gitignore`, então este plano não será versionado e pode se perder no próximo snapshot. Se quiser planos persistentes no repositório, depois posso remover essa entrada do `.gitignore`.