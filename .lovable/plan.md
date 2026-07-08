
# Diagnóstico do erro "Failed to fetch" ao publicar

## O que aconteceu de verdade

A campanha **FOI criada com sucesso** na Meta e no banco. Os logs da edge function confirmam:

```
[fb-create] rodízio: pool 677bbfd7-ce58-4218-b823-149197c40bad criada com 3 membros para campanha 9b2324ee-f2c9-47de-b16b-e4efd26c43fb
[fb-create] initial WA message: Olá! Quero saber mais...
```

Ou seja: seus dados foram salvos — nome, 5 endereços com raio, 3 fotos (square/vertical/story), headline, texto, mensagem inicial e os 3 parceiros do rodízio (`f47c58f6…`, `7632bba1…`, `52df8e31…`). Tudo persistido.

O que o navegador viu foi **timeout de rede** (`Failed to fetch`), não erro de negócio.

## Por que o navegador viu "Failed to fetch"

Depois de criar a campanha nova, a função entra num loop `realign spend_cap` sobre 5 campanhas antigas (`facebook-create-campaign/index.ts` linhas 1264–1287). Cada uma:

1. Faz `fbFetch POST /{fb_campaign_id}` (com **3 retries internos** em caso de erro Meta).
2. Em várias, a Meta responde erro permanente:
   - `subcode 1885058` — "Limite de gastos da campanha não pode ser inferior a R$X porque há cobranças pendentes" (4 campanhas).
   - `subcode 2446474` — "Spend cap não pode ser adicionado quando a campanha tem lifetime budget" (1 campanha).
3. Como o helper `fbFetch` faz 3 tentativas para cada uma, o loop leva ~15–20s **depois** que a nova campanha já está pronta. O browser desiste antes da resposta chegar.

Confirmação nos logs: 20+ chamadas `[fbFetch] .../120243179955610645`, `.../120245841877940645`, etc., todas depois da linha `pool criada`.

## O que corrigir

### 1. Rodar o realign em background (`EdgeRuntime.waitUntil`)

Envolver o bloco `for (const ec of realignTargets)` (linhas 1267–1287) em `EdgeRuntime.waitUntil(...)` e **retornar imediatamente** após a criação/ativação da nova campanha. Assim:

- O browser recebe `{ ok: true, campaign_id, ad_ids, ... }` em <5s.
- O realign continua no worker sem bloquear a UI.
- Erros de realign continuam sendo logados como `warning` (não afetam o usuário).

### 2. Não retentar `fbFetch` em erros permanentes de spend_cap

No handler de `realign`, tratar os subcodes `1885058` e `2446474` como **falha silenciosa não-retentável** (não têm solução automática — dependem de o Meta liberar as pending charges ou de a campanha antiga sair do ar). Registrar como `info`, não `warning`. Isso reduz ruído nos logs e evita 3 chamadas por campanha problemática.

### 3. Confirmar no frontend que o "Failed to fetch" não perde o trabalho

Em `CampaignWizard` (ou equivalente que faz `supabase.functions.invoke("facebook-create-campaign")`), quando o erro for de rede/timeout (`TypeError: Failed to fetch` ou `AbortError`), em vez de mostrar erro genérico, consultar `facebook_campaigns` pelo nome+consultant_id nos últimos 60s. Se encontrar, mostrar "Campanha publicada com sucesso — o servidor demorou para responder mas o Meta confirmou". Evita o usuário tentar republicar e criar duplicata.

## Arquivos afetados

- `supabase/functions/facebook-create-campaign/index.ts` (linhas 1264–1287 → mover para `EdgeRuntime.waitUntil`; adicionar guarda por subcode).
- `src/components/admin/ads/CampaignWizard.tsx` (ou o arquivo que dispara o invoke) — tratar timeout consultando o banco antes de mostrar erro.

## O que NÃO precisa mudar

- Sua campanha `9b2324ee-f2c9-47de-b16b-e4efd26c43fb` já está no ar com tudo salvo. Não precisa republicar.
- Raio de 80 km foi aceito pela Meta (é dentro do limite permitido para `custom_locations`).
- Rodízio com os 3 parceiros já foi criado corretamente na `rodizio_pools`.
- Fallback de criativo (1 ad por imagem) rodou porque o `asset_feed_spec` de imagens múltiplas foi rejeitado — comportamento esperado e já coberto pelo código.

## Ordem de execução

1. Editar `facebook-create-campaign/index.ts` (mover realign para background + guarda de subcode).
2. Editar `CampaignWizard.tsx` (tratamento de timeout + verificação no banco).
3. Deploy da edge function.
4. Testar publicando uma campanha nova pequena — resposta deve chegar em <5s.
