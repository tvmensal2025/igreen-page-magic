# Como conseguir e configurar os secrets da captação

> Guia passo a passo para "ligar" os conectores de captação (Meta Lead Ads,
> TikTok Lead Generation e, opcionalmente, Google Places). A pesquisa B2B por
> OpenStreetMap (`lead-research`) **já funciona sem configurar nada**.

Cada secret é uma "senha" que as funções usam para falar com o Facebook/TikTok
com segurança. Sem elas, os webhooks respondem mas não gravam lead (proteção
proposital).

---

## Onde colocar os secrets (vale para TODOS)

Os secrets ficam no **Supabase**, na área de Edge Functions:

1. Acesse o painel do projeto:
   **https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/settings/functions**
2. Procure a seção **Edge Functions → Secrets** (ou "Function Secrets").
3. Clique em **Add new secret**, preencha **Name** (nome do secret) e **Value**
   (o valor) e salve.
4. Repita para cada secret abaixo.

> Dica: depois de adicionar/alterar um secret, as functions já passam a
> enxergar o novo valor (não precisa redeploy).

Resumo dos secrets que vamos preencher:

| Secret | Para quê | Obrigatório? |
|---|---|---|
| `META_VERIFY_TOKEN` | Handshake do webhook do Meta | Sim (Meta) |
| `FACEBOOK_APP_SECRET` | Validar assinatura do Meta | Sim (Meta) |
| `PAGE_ACCESS_TOKEN` | Ler os dados do lead no Meta | Sim (Meta) |
| `META_LEADADS_FALLBACK_CONSULTANT` | Dono padrão do lead Meta | Recomendado |
| `TIKTOK_WEBHOOK_SECRET` | Validar o webhook do TikTok | Sim (TikTok) |
| `TIKTOK_LEADGEN_FALLBACK_CONSULTANT` | Dono padrão do lead TikTok | Recomendado |
| `GOOGLE_PLACES_API_KEY` | Pesquisa B2B premium (opcional) | Não |

---

# PARTE 1 — Meta Lead Ads (Facebook + Instagram)

Tudo do Meta sai do **Meta for Developers**. Você precisa de um App e de uma
Página do Facebook.

### Passo 1.1 — Criar (ou abrir) o App no Meta for Developers
- Link: **https://developers.facebook.com/apps/**
- Se já tem o app que vocês usam para os anúncios (o projeto já integra Meta
  Ads), use o mesmo. Senão, clique **Criar app** → tipo **Negócios (Business)**.
- Guarde o **App ID** (não é secret, mas é útil).

### Passo 1.2 — Pegar o `FACEBOOK_APP_SECRET`
- No painel do app: menu lateral **Configurações → Básico**
  (**Settings → Basic**).
- Link direto (troque `SEU_APP_ID`):
  **https://developers.facebook.com/apps/SEU_APP_ID/settings/basic/**
- Procure **Chave Secreta do App** (**App Secret**) → clique **Mostrar** →
  copie.
- No Supabase, crie o secret:
  - Name: `FACEBOOK_APP_SECRET`
  - Value: (a chave copiada)

> Observação: o projeto já pode ter esse valor configurado (a integração de
> anúncios usa ele). Se já existir, não precisa recriar.

### Passo 1.3 — Inventar o `META_VERIFY_TOKEN`
Esse você **cria do nada** — é uma senha qualquer que você define e repete nos
dois lados (Supabase e Meta). Use algo difícil de adivinhar.
- Exemplo de valor: `igreen-leadads-2026-Xk9p` (crie o seu).
- No Supabase, crie o secret:
  - Name: `META_VERIFY_TOKEN`
  - Value: `igreen-leadads-2026-Xk9p` (o que você escolheu — guarde, vai usar no
    passo 1.6)

### Passo 1.4 — Pegar o `PAGE_ACCESS_TOKEN` (token da Página)
Esse token deixa a função LER os dados do lead. O jeito mais simples:
- Abra o **Explorador da Graph API**:
  **https://developers.facebook.com/tools/explorer/**
- No topo direito: selecione o seu **App**.
- Em **User or Page**, escolha **Get Page Access Token** e selecione a **Página**
  oficial da iGreen.
- Marque as permissões: **`leads_retrieval`**, **`pages_show_list`**,
  **`pages_read_engagement`**, **`pages_manage_metadata`**.
- Clique **Generate Access Token** e copie o token gerado.
- **Importante:** o token do explorador é curto (expira). Para um token que não
  expira (token de página de longa duração), siga:
  **https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/**
  (resumo: troque o token curto por um de 60 dias e depois gere o token de
  página, que passa a ser de longa duração).
- No Supabase, crie o secret:
  - Name: `PAGE_ACCESS_TOKEN`
  - Value: (o token de página)

### Passo 1.5 — Descobrir o `META_LEADADS_FALLBACK_CONSULTANT`
Esse é o **UUID do consultor** que vira dono do lead quando a função não
consegue identificar a campanha. É o `id` na tabela `consultants`.
- No painel do Supabase, vá em **Table Editor → consultants** e copie o `id` do
  consultor desejado (formato `xxxxxxxx-xxxx-...`).
  Link: **https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/editor**
- No Supabase (Secrets), crie:
  - Name: `META_LEADADS_FALLBACK_CONSULTANT`
  - Value: (o UUID copiado)

> Quando os anúncios já tiverem campanha cadastrada no sistema, a função
> identifica o dono certo automaticamente; o fallback é só a rede de segurança.

### Passo 1.6 — Apontar o webhook do Meta para a nossa função
Agora liga o Meta na nossa função `meta-leadads-webhook`.
- No app, menu lateral: **Produtos → adicione "Webhooks"** (se não estiver lá,
  clique em **+ Adicionar produto** e escolha **Webhooks**).
- Em Webhooks, escolha o objeto **Page** (Página).
- **Callback URL** (cole exatamente):
  ```
  https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/meta-leadads-webhook
  ```
- **Verify Token**: o MESMO valor que você pôs em `META_VERIFY_TOKEN`
  (passo 1.3).
- Clique **Verificar e salvar**. Se o token bater, o Meta confirma na hora.
- Depois, em **Campos do webhook** (Subscriptions), assine o campo
  **`leadgen`**.
- Por fim, na sua Página, garanta que o app está inscrito para receber leads
  (botão **Subscribe** ao lado da Página, na mesma tela de Webhooks).

### Passo 1.7 — Testar
- Use a ferramenta oficial de teste de Lead Ads:
  **https://developers.facebook.com/tools/lead-ads-testing/**
- Selecione a Página e o formulário, clique em **Create lead** (criar lead de
  teste).
- Confira no Supabase (Table Editor → `captured_leads`) se o lead apareceu com
  `channel = meta_leadads`.

---

# PARTE 2 — TikTok Lead Generation

Tudo sai do **TikTok for Business / TikTok for Developers**.

### Passo 2.1 — Acessar o TikTok for Developers
- Link: **https://developers.tiktok.com/**
- Faça login com a conta **TikTok for Business** da iGreen.
- Crie/ką abra um **App** em **Manage apps**:
  **https://developers.tiktok.com/apps/**
- Ative o produto **Lead Generation / Marketing API** para o app.

### Passo 2.2 — Inventar o `TIKTOK_WEBHOOK_SECRET`
Igual ao Meta verify token: você **cria** uma senha qualquer e usa nos dois
lados.
- Exemplo: `igreen-tiktok-2026-Qz3m` (crie o seu).
- No Supabase (Secrets), crie:
  - Name: `TIKTOK_WEBHOOK_SECRET`
  - Value: (o que você escolheu)

> A nossa função espera receber esse valor no header `x-tiktok-secret`. Na hora
> de configurar o webhook/integração no TikTok (ou num conector intermediário
> como Zapier/Make), inclua esse header com esse valor.

### Passo 2.3 — Descobrir o `TIKTOK_LEADGEN_FALLBACK_CONSULTANT`
Mesma ideia do Meta: o **UUID do consultor** dono dos leads do TikTok.
- Copie o `id` em **Table Editor → consultants** (pode ser o mesmo consultor do
  Meta).
- No Supabase (Secrets), crie:
  - Name: `TIKTOK_LEADGEN_FALLBACK_CONSULTANT`
  - Value: (o UUID)

### Passo 2.4 — Apontar o webhook do TikTok
- A URL da nossa função é:
  ```
  https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/tiktok-leadgen-webhook
  ```
- No painel do app (TikTok for Developers), configure o **Webhook / callback
  URL** com essa URL e inclua o header `x-tiktok-secret` com o valor do
  `TIKTOK_WEBHOOK_SECRET`.
- Docs de Lead Generation do TikTok:
  **https://business-api.tiktok.com/portal/docs?id=1738864915188737**

> Nota: o TikTok costuma exigir aprovação do app para Lead Generation. Se a
> entrega direta de webhook for limitada na sua conta, uma alternativa rápida é
> ligar o TikTok a um **Make/Zapier** que chama a nossa URL com o header — o
> resultado no `captured_leads` é o mesmo.

### Passo 2.5 — Testar
- Gere um lead de teste pela campanha/forma do TikTok (ou dispare um POST de
  teste para a URL com o header).
- Confira em `captured_leads` se apareceu com `channel = tiktok_leadgen`.

---

# PARTE 3 — Google Places (OPCIONAL — pesquisa B2B premium)

Só se você quiser que a pesquisa de empresas use o Google (mais completa que o
OpenStreetMap, que já funciona de graça). É **pago por uso** (tem cota grátis
mensal).

### Passo 3.1 — Criar a chave no Google Cloud
- Console: **https://console.cloud.google.com/**
- Crie/selecione um projeto.
- Ative a **Places API**:
  **https://console.cloud.google.com/apis/library/places-backend.googleapis.com**
- Vá em **APIs e serviços → Credenciais**:
  **https://console.cloud.google.com/apis/credentials**
- Clique **Criar credenciais → Chave de API** e copie a chave.
- Recomendado: em **Restringir chave**, limite à **Places API** (segurança).
- Preços: **https://mapsplatform.google.com/pricing/**

### Passo 3.2 — Configurar no Supabase
- No Supabase (Secrets), crie:
  - Name: `GOOGLE_PLACES_API_KEY`
  - Value: (a chave)

> Hoje a `lead-research` usa OpenStreetMap por padrão. Quando essa chave estiver
> configurada, dá pra evoluir a função para usar o Google. (Essa parte ainda
> precisa de uma pequena alteração no código — me avise quando quiser ativar.)

---

## Checklist final

- [ ] `FACEBOOK_APP_SECRET` no Supabase
- [ ] `META_VERIFY_TOKEN` no Supabase (mesmo valor usado no webhook do Meta)
- [ ] `PAGE_ACCESS_TOKEN` no Supabase (token de página de longa duração)
- [ ] `META_LEADADS_FALLBACK_CONSULTANT` no Supabase (UUID do consultor)
- [ ] Webhook do Meta apontando para `.../meta-leadads-webhook` + campo `leadgen`
- [ ] Lead de teste do Meta apareceu em `captured_leads`
- [ ] `TIKTOK_WEBHOOK_SECRET` no Supabase
- [ ] `TIKTOK_LEADGEN_FALLBACK_CONSULTANT` no Supabase (UUID)
- [ ] Webhook do TikTok apontando para `.../tiktok-leadgen-webhook` + header
- [ ] (Opcional) `GOOGLE_PLACES_API_KEY` no Supabase

---

## Dúvidas comuns

- **"O webhook do Meta deu erro de verificação."** → O `META_VERIFY_TOKEN` no
  Supabase tem que ser **idêntico** ao Verify Token digitado no painel do Meta.
  Confira espaços extras.
- **"O lead não aparece."** → Verifique: (1) o campo `leadgen` está assinado no
  webhook; (2) o `PAGE_ACCESS_TOKEN` tem a permissão `leads_retrieval`; (3) o
  `META_LEADADS_FALLBACK_CONSULTANT` está preenchido com um UUID válido.
- **"Onde vejo os leads?"** → No Supabase, Table Editor → `captured_leads`.
  Quando a UI do consultor estiver pronta, eles aparecem direto no painel.
