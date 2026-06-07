## Diagnóstico (lendo os logs)

| Versão | Passou Cloudflare? | Passou reCAPTCHA da API? | Resultado |
|---|---|---|---|
| v7 (Tor + Playwright) | Sim (IP Tor) | Não (não enviava token) | 401 "Unauthorized action" |
| v9 (HTTP direto + 2captcha) | Não (IP easypanel) | Sim (resolveu em 60s) | 403 Cloudflare HTML |

O `<!DOCTYPE html>... Sorry, you have been blocked` é a **página de bloqueio do Cloudflare**, não erro da iGreen. No seu navegador o reCAPTCHA passou sozinho porque seu IP residencial tem score alto; o IP do easypanel é datacenter e o WAF derruba direto.

## Solução: v10 — Tor + Playwright + 2captcha + visão IA

Combinar o melhor dos dois mundos:

1. **Tor SOCKS5** para sair com IP residencial (passa o Cloudflare).
2. **Playwright** abre a página real `/login` → carrega o widget reCAPTCHA → recebe `cf_clearance` cookie.
3. **2captcha** resolve o reCAPTCHA → injetamos o token no `textarea#g-recaptcha-response` da página.
4. **Submit pela própria página** (clique no botão "Entrar") → request sai do contexto do browser (mesmo fingerprint + cookie CF + token captcha) → Cloudflare libera + iGreen aceita.
5. Captura `accessToken` interceptando a response do `/v1/login` via `page.on('response')`.
6. Daí em diante: chamadas `/customer-map` via `page.evaluate(fetch)` para reaproveitar fingerprint+cookies.

### Camada de debug visual com IA (Gemini)

Para nunca mais ficarmos cegos sobre "o que aconteceu":

- A cada passo crítico (`abriu login`, `preencheu senha`, `injetou captcha`, `clicou entrar`, `pós-submit`) o worker tira **screenshot PNG** em memória.
- Envia para **Lovable AI Gateway (Gemini 2.5 Flash vision)** com prompt:
  > "Analise este screenshot de uma página de login. Descreva em 1 frase o que está visível: formulário, mensagem de erro, página de bloqueio Cloudflare, dashboard pós-login, etc."
- Resposta é gravada no `/last-debug` junto com o passo. Exemplo:
  ```
  21:42:11 [step] abriu_login → "Formulário de login iGreen visível, reCAPTCHA v2 não marcado"
  21:42:34 [step] pos_submit  → "Página de bloqueio Cloudflare 'Sorry, you have been blocked'"
  ```
- Adiciona endpoint `GET /last-screenshot` que devolve o PNG do último passo, para você abrir no navegador se precisar.

Usa o `LOVABLE_API_KEY` que já existe — zero config nova.

## Arquivos que vou tocar

- `worker-igreen-sync/Dockerfile` — volta `node:20-bookworm-slim` + Tor + Playwright Chromium.
- `worker-igreen-sync/package.json` — adiciona `playwright-chromium`.
- `worker-igreen-sync/torrc` — recria config Tor.
- `worker-igreen-sync/server.mjs` — reescreve para v10 (mantém endpoints `/health`, `/last-debug`, `/sync-customers`, `/sync-network`; adiciona `/last-screenshot`).
- `worker-igreen-sync/README.md` — atualiza para refletir v10.

## Variáveis de ambiente (no easypanel)

| Nome | Onde estava | Ação |
|---|---|---|
| `WORKER_TOKEN` | já existe | manter |
| `TWOCAPTCHA_API_KEY` | já adicionado | manter |
| `LOVABLE_API_KEY` | **novo** | colar do painel Lovable → debug visual com IA |

## Validação

1. Redeploy do worker → `/health` deve responder `mode: "tor+playwright+2captcha-v10"`.
2. Clique em "Sincronizar" no painel → eu acompanho via `/last-debug` (que agora terá as legendas geradas por IA) e, se travar, via `/last-screenshot` consigo ver exatamente onde parou.
3. Sucesso esperado: lista de clientes vindo da `/customer-map`.

## Custos por sync (após cache de 30min)

- 2captcha: ~US$0,003
- Lovable AI (5 screenshots × ~700 tokens visão): grátis no Gemini 2.5 Flash até 2026-10-13
- Total: ~R$0,015 por sincronização

## Risco

Cloudflare pode endurecer ainda mais (ex: exigir `cf-turnstile` em vez de reCAPTCHA). Se isso acontecer, plano B é proxy residencial pago (BrightData ~US$15/GB).
