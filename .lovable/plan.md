# Auditoria CTWA vs documentação oficial Meta (Marketing API v21.0)

Objetivo: mapear cada requisito da doc Meta para CTWA (Click-to-WhatsApp) e destravar o `WHATSAPP_BUSINESS_REQUIRED / waba_numbers:[]` que voltou agora — sem "chutar" mais nada.

> Antes de qualquer código: `.lovable/` está no seu `.gitignore`, então este plano não é comitado. Quer que eu remova a linha do gitignore pra ele persistir?

---

## 1. Diagnóstico do erro atual

Log: `"error":"A Página ... não tem WhatsApp Business (WABA) vinculado", "code":"WHATSAPP_BUSINESS_REQUIRED", "waba_numbers":[]`.

Isso vem de `resolve-waba-phone.ts` no branch `no_waba` + **sem número salvo** em `consultant_ad_settings.whatsapp_destination_number` para o consultor. Ou seja, aconteceram **duas falhas simultâneas**:

1. A Graph API não devolveu WABA para a Página da plataforma via nenhum dos 3 caminhos (`whatsapp_business_account`, `connected_whatsapp_business_account`, `me/businesses → owned/client_whatsapp_business_accounts`).
2. O consultor **não tem** `whatsapp_destination_number` salvo, então o fallback "usa o número salvo e deixa a Meta validar" também não dispara.

## 2. Mapeamento oficial Meta CTWA v21 → nosso código

| Requisito Meta (doc oficial) | Onde na doc | Estado atual no código | Ação |
|---|---|---|---|
| Objective `OUTCOME_ENGAGEMENT` + `destination_type=WHATSAPP` | Marketing API › Ads › Click to WhatsApp | OK (linhas 399, 513 create-campaign) | manter |
| `optimization_goal=CONVERSATIONS`, `billing_event=IMPRESSIONS` | idem | OK | manter |
| `promoted_object = { page_id, whatsapp_phone_number }` — dígitos E.164 sem `+` | idem | OK | manter |
| Número precisa ser **phone da WABA vinculada à Página** OU **número clássico do WhatsApp Business App conectado à Página** (fluxo legado) | WhatsApp Business Platform › Cloud API › Phone numbers **e** Pages API › `page_backed_whatsapp_business_account` | Só cobrimos WABA Cloud API (`whatsapp_business_account`, `connected_whatsapp_business_account`) | **Adicionar** `page_backed_whatsapp_business_account` (PBWA) — é o campo que aparece quando a Página usa o WhatsApp Business App comum, não Cloud API. É a causa mais provável do `no_waba`. |
| Descoberta de WABA por Business Manager | Business Management API › `owned/client_whatsapp_business_accounts` | OK (cascata) | manter |
| Age min ≤ 25 e age max ≥ 65 quando `advantage_audience=1` | subcodes 1870188/1870189 | OK (clamp) | manter |
| Sem `targeting_relaxation` (removido v20+) | subcode 1487079 | OK (já removido) | manter |
| `tracking_specs` com `onsite_conversion.messaging_first_reply` + `offsite_conversion` c/ pixel | Marketing API › Tracking specs | OK | manter |
| AdSet janela ≥ 24 h | subcode 1487793 | OK (start+1min, end+days+1h) | manter |
| Sem `spend_cap` com `lifetime_budget` | subcode 2446474 | OK | manter |
| Placements: omitir → Advantage+ Placements | Doc CTWA recomendada | OK | manter |
| `messenger` incompatível com `destination_type=WHATSAPP` | Doc placements | OK (não incluído) | manter |
| `whatsapp_phone_number` deve ser dígitos puros (sem `+`, sem espaço) | Referência Marketing API | OK (`replace(/\D/g,"")`) | manter |
| Retry `waWith9/waWithout9` (chute BR) | não existe na doc — proibido | OK (removido) | manter |

## 3. Correções propostas (sem chute)

### 3.1 Ampliar descoberta de WABA — cobrir PBWA (causa raiz do `no_waba` atual)

Em `supabase/functions/_shared/resolve-waba-phone.ts::discoverWabaId` e `facebook-detect-waba/index.ts`, tentar em cascata TODOS os campos oficiais que a Meta expõe hoje:

1. `GET /{page_id}?fields=whatsapp_business_account` (Cloud API)
2. `GET /{page_id}?fields=connected_whatsapp_business_account` (legado)
3. `GET /{page_id}?fields=page_backed_whatsapp_business_account` (**novo — WhatsApp Business App conectado à Página, sem Cloud API**)
4. `GET /me/businesses` → para cada business: `owned_whatsapp_business_accounts` + `client_whatsapp_business_accounts`
5. Novo: `GET /{business_id}/owned_pages` cruzar com `pageId` para confirmar posse antes de assumir a WABA daquele business.

Se qualquer um retornar id, usa e para.

### 3.2 Tornar erro `no_waba` acionável (não só bloquear)

Quando nenhum caminho encontrar WABA **e** o consultor não tiver número salvo, devolver:

```
code: "WHATSAPP_BUSINESS_REQUIRED"
error: "Página <page_id> não expõe WABA via Graph. Verifique em Meta Business Suite → Configurações → Contas do WhatsApp se a Página está vinculada, OU configure manualmente o número em Anúncios → Configurações."
next_steps: [
  "1) Meta Business Suite → Configurações → Contas do WhatsApp → vincular Página",
  "2) OU salvar número + phone_number_id em Anúncios → Configurações do consultor",
  "3) Rodar /functions/v1/facebook-detect-waba para re-verificar"
]
detected_paths_tried: [...]  // debug
```

Isso substitui a mensagem genérica atual.

### 3.3 Aceitar override manual quando Graph não expõe

Hoje o resolver EXIGE Graph OU número salvo. Se o consultor salvar manualmente `whatsapp_phone_number_id` + `whatsapp_destination_number` em `consultant_ad_settings` (via UI de Configurações de Anúncios), o resolver já usa como `saved_fallback` — isso já existe, mas o `no_waba` atual bate antes disso pois `savedDigits` está vazio. Confirmar na UI (`ConsultantAdSettings`) que o campo permite salvar o número manualmente e que o botão "Salvar" está gravando `whatsapp_destination_number` + `whatsapp_phone_number_id`.

### 3.4 Preflight espelhando 1:1 o create

Em `facebook-preflight-check/index.ts`, chamar `resolveWabaPhone` (mesma função) e devolver ao front `waba_status: ok|no_waba|no_numbers|no_match|saved_fallback` com a mesma `hint` — hoje o preflight só olha `whatsapp_destination_number`, o que mascara `no_waba` até o publish.

### 3.5 Validar `promoted_object` antes de submeter

Após montar `promotedObject`, fazer um `POST /{ad_account_id}/reachestimate?destination_type=WHATSAPP&promoted_object=...&targeting_spec=...` (já existe em `facebook-validate-account`) como pré-check. Se retornar erro 1487246/2446885, aborta antes de criar campanha e devolve mensagem clara — evita campanha órfã PAUSED no Ads Manager.

## 4. Detalhes técnicos (para dev)

Arquivos a editar:

- `supabase/functions/_shared/resolve-waba-phone.ts`
  - `discoverWabaId`: adicionar `page_backed_whatsapp_business_account`; retornar `{ id, source }` para logar de onde veio.
  - Novo retorno `detected_paths_tried: string[]`.
- `supabase/functions/facebook-detect-waba/index.ts`
  - Mesma cascata ampliada; retornar `detected_paths_tried`.
- `supabase/functions/facebook-create-campaign/index.ts`
  - Antes do `POST /campaigns`, chamar `reachestimate` com `promoted_object` real e abortar se Meta rejeitar; propagar `detected_paths_tried` no erro `WHATSAPP_BUSINESS_REQUIRED`.
- `supabase/functions/facebook-preflight-check/index.ts`
  - Usar `resolveWabaPhone`; expor `waba_status`, `waba_numbers`, `chosen_phone`.
- `src/hooks/useCtwaPreflight.ts` + `src/components/admin/ads/SmartPublishButton.tsx`
  - Renderizar `next_steps` e `detected_paths_tried` no toast/painel de erro.

Nada em `facebook-validate-account`, `facebook-cbo-to-abo`, `ad-initial-message`, `whapi-webhook`, `evolution-webhook` precisa mexer — já usam a mesma fonte da verdade.

## 5. Validação

1. Rodar `facebook-detect-waba` para o consultor atual; ver qual dos 4 caminhos devolveu WABA (ou nenhum).
2. Se nenhum: front mostra os `next_steps` e o consultor pode salvar número manualmente OU vincular a Página.
3. Publicar campanha: `reachestimate` valida antes; se OK, cria campaign → adset → ad sem tocar em `targeting_relaxation` nem retries de `waWith9`.
4. Confirmar em `edge_function_logs` que só existe UMA tentativa de POST `/adsets` por publish e que o `phone_number_id` logado bate com o resolvido.

## 6. Fora de escopo

- Não altero UI de tutorial nem outros edge functions.
- Não mexo em `evolution-webhook` / `whapi-webhook` (attribuição CTWA já funciona por `promoted_object.whatsapp_phone_number`).
- Não altero secrets nem token de plataforma.
