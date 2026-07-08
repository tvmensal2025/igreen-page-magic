# Auditoria: por que Elias Fausto funcionou e agora falha

> Observação: `.lovable/` está no `.gitignore`, então este plano pode se perder no próximo snapshot se essa entrada não for removida.

## 1. O que encontrei nos dados reais

### Campanha que funcionou com Elias Fausto

No banco existe a campanha antiga:

- `name`: `iGreen — CPFL Paulista`
- `consultant_id`: `0c2711ad-4836-41e6-afba-edd94f698ae3`
- `created_at`: `2026-05-12`
- `status`: `active`
- `fb_campaign_id`: `120243070299140645`
- `fb_adset_ids`: `[120243070300020645]`
- `fb_ad_ids`: `[120243070309680645, 120243070310640645, 120243070311710645]`
- `cities`: inclui `Elias Fausto`
- `rejection_reason`: vazio

### Configuração atual do mesmo consultor

A configuração atual em `consultant_ad_settings` está assim:

- `consultant_id`: `0c2711ad-4836-41e6-afba-edd94f698ae3`
- `consultant_name`: `Rafael Ferreira`
- telefone do consultor em `consultants.phone`: `553484314317`
- `whatsapp_destination_number`: `5534984314317`
- `whatsapp_phone_number_id`: `null`
- `whatsapp_phone_number_display`: `null`
- `whatsapp_last_verified_at`: `2026-07-08 02:55:57`

### Conta Facebook atual usada para publicar

A conta principal da plataforma está assim:

- `page_id`: `106742552184431`
- `page_name`: `Instituto dos Sonhos`
- `ad_account_id`: `act_317035519061535`
- `ig_account_id`: `17841444624826862`
- `pixel_id`: `708759256921383` no banco, mas o código força `1521037349653769`
- `business_id`: `null`
- `token_expires_at`: `2026-07-19`

### Conexão pessoal antiga do consultor

Também existe `facebook_connections` do consultor:

- `page_id`: `106742552184431`
- `page_name`: `Instituto dos Sonhos`
- `status`: `expired`
- `whatsapp_destination_number`: `5511971254913`
- `whatsapp_phone_number_id`: `null`
- sem `ad_account_id`, sem `pixel_id`, sem `business_id`

## 2. Diferença real entre antes e agora

A campanha de Elias Fausto foi criada em **12/05**, antes das mudanças recentes de publicação CTWA/WABA. Ela está ativa porque o Meta aceitou aquele fluxo na época.

Agora o fluxo atual faz CTWA oficial e exige que o número enviado no `promoted_object.whatsapp_phone_number` seja um número que a Meta reconhece como ligado à WABA/Página usada.

O erro atual diz:

```text
phone_number_id saved:5534984314317
This WhatsApp phone number is not linked to your account
subcode=1487246
page_id=106742552184431
```

Isso prova que estamos publicando com um `phone_number_id` **fake**: `saved:5534984314317`.

Esse id não veio da Meta. Ele foi inventado pelo nosso fallback quando a Graph não encontrou WABA, mas encontrou número salvo:

```ts
id: settings?.whatsapp_phone_number_id || `saved:${savedDigits}`
```

Como `whatsapp_phone_number_id` está `null`, o código cria `saved:5534984314317` e tenta publicar mesmo assim. A Meta rejeita, corretamente, porque `5534984314317` não está vinculado à Página/conta usada.

## 3. Causa raiz

A causa raiz não é cidade, orçamento, criativo nem targeting.

A causa raiz é:

1. A Página atual `106742552184431` não está retornando WABA pela Graph API para o token da plataforma.
2. O consultor tem número salvo (`5534984314317`), mas não tem `phone_number_id` real da Meta.
3. Nosso código permite fallback `saved_fallback` e tenta publicar mesmo sem prova de vínculo WABA.
4. Meta recusa com `1487246` porque esse número não está vinculado à conta/Página usada no anúncio.

## 4. Por que Elias Fausto deu certo

A campanha de Elias Fausto deu certo porque foi criada antes desta validação WABA atual e/ou antes da troca para o fluxo centralizado da conta da plataforma.

Hoje a publicação usa sempre:

- conta da plataforma: `platform_facebook_account`
- Página: `106742552184431`
- conta de anúncios: `act_317035519061535`
- número atual salvo do consultor: `5534984314317`

Mas esse número não tem `phone_number_id` real nem aparece em WABA vinculada à Página via Graph. Então o mesmo Meta que aceitou a campanha antiga agora bloqueia a nova criação.

## 5. Correção necessária no código

### 5.1 Proibir publish com `saved:`

Em `resolve-waba-phone.ts`:

- remover o fallback que gera `id: saved:<digits>` para publicar;
- `saved_fallback` só pode existir para diagnóstico/preflight, nunca para publish;
- se não houver WABA e não houver `phone_number_id` real numérico, retornar `ok:false`.

Regra:

```ts
const hasRealPhoneId = /^\d+$/.test(settings?.whatsapp_phone_number_id || "");
```

Se falso, bloquear.

### 5.2 Validar `phone_number_id` real na Graph

Adicionar no resolver uma validação direta:

```text
GET /{phone_number_id}?fields=id,display_phone_number,verified_name,quality_rating
```

Se a Meta responde 200:

- o id é real;
- o token tem acesso;
- o display/digits vêm da Meta;
- podemos usar como autoritativo.

Se responde erro:

- bloquear antes de criar campanha;
- mostrar que o `phone_number_id` salvo não é válido/acessível.

### 5.3 Diagnosticar a Página e escopos do token

Criar uma função admin `facebook-diagnose-page` para retornar:

- dados da Página `106742552184431`;
- campos WABA testados:
  - `whatsapp_business_account`
  - `connected_whatsapp_business_account`
  - `page_backed_whatsapp_business_account`
- businesses acessíveis pelo token;
- WABAs `owned_whatsapp_business_accounts` e `client_whatsapp_business_accounts`;
- `debug_token` com escopos do token.

Isso vai responder com certeza se falta:

- vínculo da WABA com a Página;
- acesso do token à Business;
- escopo `whatsapp_business_management` / `business_management`;
- ou se o número `5534984314317` simplesmente está em outra WABA.

### 5.4 Preflight deve bloquear antes do botão publicar

Em `facebook-preflight-check`:

- se `resolveWabaPhone` retornar `saved_fallback` ou `phone_number_id` não numérico, marcar `fail`;
- mostrar instrução: salvar `phone_number_id` real ou vincular WABA à Página.

### 5.5 Mensagem final ao usuário

Trocar a mensagem genérica por:

```text
O número 5534984314317 está salvo, mas não tem phone_number_id real da Meta e não aparece em uma WABA vinculada à Página 106742552184431. Copie o phone_number_id no WhatsApp Manager ou vincule a WABA correta à Página antes de publicar.
```

## 6. Ação humana obrigatória no Meta

O código pode impedir erro e diagnosticar, mas a correção final pode exigir ajuste no Meta Business Suite:

1. Abrir Meta Business Suite.
2. Ir em Configurações → Contas do WhatsApp.
3. Confirmar se a Página `106742552184431 / Instituto dos Sonhos` está vinculada à WABA certa.
4. Confirmar se o número `+55 34 98431-4317` está dentro dessa WABA.
5. Copiar o `phone_number_id` numérico real do WhatsApp Manager.
6. Salvar esse id nas configurações de anúncio do consultor.

## 7. Arquivos a alterar após aprovação

- `supabase/functions/_shared/resolve-waba-phone.ts`
- `supabase/functions/facebook-detect-waba/index.ts`
- `supabase/functions/facebook-preflight-check/index.ts`
- `supabase/functions/facebook-create-campaign/index.ts`
- novo: `supabase/functions/facebook-diagnose-page/index.ts`
- componente de configuração de anúncios onde salva WhatsApp/phone_number_id, se já existir campo de WhatsApp

## 8. Validação depois da correção

1. Rodar `facebook-diagnose-page` para `page_id=106742552184431`.
2. Confirmar se Graph encontra WABA ou não.
3. Rodar `facebook-detect-waba`.
4. Confirmar que nunca mais aparece `phone_number_id: saved:*` em publish.
5. Publicar nova campanha: se o Meta bloquear, o erro aparece antes do `POST /campaigns`, sem criar campanha órfã.
