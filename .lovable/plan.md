## Problema

Hoje o QR do panfleto codifica esta URL:

```
https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/qr-redirect?l={licenca}&msg=...
```

É feia (domínio Supabase exposto), longa e, se a edge function falhar, não abre o WhatsApp. O usuário quer:

1. Link curto no domínio próprio (`igreen.cloud`).
2. Não pode quebrar — sempre abre o WhatsApp.
3. Continuar funcionando o `?msg=` (frase personalizada do panfleto).

Boa notícia: já existe a rota `/r/:licenca/:code?` (`src/App.tsx:129`) servida pelo `PartnerRedirectPage`, que resolve telefone+frase via `qr-redirect?json=1` e faz `window.location.replace("https://wa.me/...")`. Basta apontar o QR pra ela e propagar `?msg=`.

---

## Mudanças

### 1. `src/components/admin/PanfletoModal.tsx`

- Remover `SUPABASE_URL` do `redirectUrl`.
- Novo `redirectUrl`:
  ```ts
  const base = `https://igreen.cloud/r/${encodeURIComponent(licenca)}`;
  const msg = phrase.trim();
  return msg ? `${base}?msg=${encodeURIComponent(msg.slice(0, QR_MESSAGE_MAX))}` : base;
  ```
- Resultado no QR: `https://igreen.cloud/r/joaoconsultor` (ou `…?msg=Oi%20vi%20seu%20panfleto`). Curto, bonito, no domínio oficial.
- Zero mudança na arte do A4/banner. Só muda o conteúdo que o `<QRCodeCanvas value=…>` recebe.

### 2. `src/pages/PartnerRedirectPage.tsx`

- Ler `msg` de `useSearchParams()` e repassar para `qr-redirect?json=1&l=…&c=…&msg=…`.
- Fallback de segurança: se o fetch JSON falhar **ou** demorar mais de 2s, em vez de cair no fallback atual (que joga pro Supabase de novo), montar `wa.me` direto usando o que tiver:
  - Se já tivermos `phone` resolvido em fetch anterior cacheado, usar.
  - Senão, fazer `window.location.replace(\`[https://wa.me/?text=\${encodeURIComponent](https://wa.me/?text=\${encodeURIComponent)(msg ?? DEFAULT_MESSAGE)})` — abre o WhatsApp com a mensagem mas sem destinatário (usuário escolhe). Melhor que tela branca.
- Esconder a tela de "escolha WhatsApp/Business" — a UX desejada é "abre direto", e o código já faz `window.location.replace` antes da tela aparecer. Manter como fallback invisível só se `failed=true`.

### 3. `supabase/functions/qr-redirect/index.ts`

- Nenhuma mudança. Já aceita `?msg=` e `?json=1`.
- O endpoint Supabase continua existindo como API interna chamada pelo `PartnerRedirectPage` — o usuário final nunca vê essa URL.

### 4. Compatibilidade

- QRs antigos já impressos continuam funcionando: a edge function permanece no ar com o mesmo contrato.
- Novos QRs gerados a partir de agora usam `igreen.cloud/r/...`.

---

## Arquivos tocados

- `src/components/admin/PanfletoModal.tsx` — trocar `redirectUrl` para `igreen.cloud/r/{licenca}[?msg=…]`.
- `src/pages/PartnerRedirectPage.tsx` — propagar `msg`, encurtar timeout, melhorar fallback, abrir direto (sem tela de escolha de app).
- `docs/auditoria/abelolympio-2026-06-26.md` — atualizar seção 5.7 explicando o novo formato curto e que o domínio oficial passou a ser o público do QR.

**Sem migration. Sem mudança na arte do A4/Banner. Sem mudança em RLS.**

## Riscos

- Se `igreen.cloud` cair (DNS/hosting), o QR para de funcionar. Hoje o QR depende do Supabase — risco apenas troca de fornecedor pelo domínio próprio, que é o que o usuário pediu.
- O `wa.me` sem número (fallback de último caso) abre o WhatsApp na home com a mensagem no clipboard de "Nova conversa". Não é ideal, mas evita tela quebrada. Se preferir, esse fallback pode ser removido e a tela de erro mantida — me avise.  
  
nunca pode abrir o home e sim o whhtsapp