## Diagnóstico — por que o painel de Captação está vazio

**Estado atual no banco (`captured_leads`):**
- 1012 leads, todos com `channel = research` e `status = new` (vieram só da pesquisa OSM/B2B).
- **Zero** leads de WhatsApp / CTWA / Meta Ads, embora nos últimos 30 dias tenham entrado **614 customers** (587 via Evolution, 18 Whapi, 9 sem canal).

**Causas raiz:**

1. **Os webhooks de inbound não escrevem em `captured_leads`.** Só `meta-leadads-webhook`, `tiktok-leadgen-webhook`, `lead-intake`, `lead-research` e o backfill chamam `ingestLead`. O `evolution-webhook` e o `whapi-webhook` criam linha em `customers`, mas nunca espelham para `captured_leads`. Por isso todo lead que vem do WhatsApp (tráfego CTWA, link direto, anúncio) fica invisível no painel.
2. **`ctwa_clid` não está sendo capturado.** Tabela `ctwa_clid_mapping` está vazia e zero `customers` (em 30 dias) têm `ctwa_clid` preenchido. A âncora CTWA do Meta não está sendo persistida no inbound, então mesmo o backfill perde o sinal.
3. **`captacao-backfill-ctwa` é restritivo demais.** O filtro `looksLikeAd()` só aceita registros com `ctwa_clid` ou `lead_source` casando regex meta/face/insta/ads. Hoje 562 customers têm `lead_source = null` + `customer_origin = igreen_sync` e 43 são `whatsapp_lead` sem marcação — todos descartados pelo backfill. Apenas os 9 com `lead_source = "meta_ads"` seriam ingeridos.
4. **Painel não tem fonte alternativa.** O `CapturedLeadsPanel` consulta exclusivamente `captured_leads`. Sem ponte, nada aparece.

---

## Plano de melhoria

### 1. Ponte automática WhatsApp → captação (fix definitivo)
Criar helper compartilhado `supabase/functions/_shared/captation/mirror-customer.ts` que, dado um `customer_id` recém-criado/atualizado, chama `ingestLead` com:
- `channel`: `ctwa` se houver `ctwa_clid`/`source_ad_id`/`source_campaign_id` ou `lead_source` contém `meta/ads`; `manual` para os demais inbounds de WhatsApp.
- `consultantId`, `fullName`, `phone`, `email`, `city` do `customers`.
- `rawPayload` com `customer_id`, `origin_channel`, `customer_origin`, `lead_source`.

Chamar esse mirror em:
- `evolution-webhook` (após criar/atualizar customer no primeiro contato).
- `whapi-webhook` (mesmo gancho).
- `lead-intake` já cobre o caminho manual; manter.

Garante idempotência via `dedup_key` existente em `ingestLead`.

### 2. Captura de `ctwa_clid` no inbound
No parser do `evolution-webhook` e `whapi-webhook`, ler `contextInfo.externalAdReply` / `ctwaClid` da mensagem e gravar em `customers.ctwa_clid` + inserir em `ctwa_clid_mapping (phone, ctwa_clid, ad_id)`. Sem isso, nunca conseguiremos atribuir lead a campanha Meta.

### 3. Backfill mais inclusivo (para popular o histórico já existente)
Em `captacao-backfill-ctwa/index.ts`:
- Adicionar parâmetro `includeWhatsappLeads` (default `true`).
- Expandir filtro: aceitar qualquer customer com `consultant_id` + (`phone_whatsapp` ou `email`) e `customer_origin IN ('whatsapp_lead','meta_ads','ctwa')` **ou** `origin_channel IN ('evolution','whapi')`.
- Mapear `channel`: `ctwa` se sinal de ad presente; caso contrário `manual`.
- Aumentar limite (paginação por `id`) para cobrir os 614 customers.
- Renomear botão na UI para "**Sincronizar leads do WhatsApp**".

### 4. Melhorias de UX no `CapturedLeadsPanel`
- Mostrar um banner "X leads do WhatsApp ainda não sincronizados" quando `customers` recentes > `captured_leads` recentes (consulta count rápido), com botão direto pro backfill.
- Adicionar coluna/badge "Origem real" quando vier de customer (mostrar `origin_channel`).
- Filtro extra "Apenas tráfego (CTWA/Meta)" e "Apenas WhatsApp direto".

### 5. Verificação
- Após deploy, rodar `captacao-backfill-ctwa` com `dryRun=true` e validar que `candidates` ≈ 600.
- Rodar real e conferir contagem em `captured_leads GROUP BY channel`.
- Disparar um teste de CTWA real e confirmar que aparece **sem** rodar backfill (ponte funcionando).

---

## Detalhes técnicos / arquivos afetados

```text
supabase/functions/_shared/captation/mirror-customer.ts   (novo)
supabase/functions/evolution-webhook/index.ts             (chamar mirror + parser CTWA)
supabase/functions/whapi-webhook/index.ts                 (idem)
supabase/functions/captacao-backfill-ctwa/index.ts        (filtro inclusivo + paginação)
src/components/captacao/CapturedLeadsPanel.tsx            (banner + filtros + label do botão)
src/services/capturedLeads.ts                             (helper countPendingCustomers)
```

Nenhuma alteração de schema necessária — `captured_leads`, `customers.ctwa_clid` e `ctwa_clid_mapping` já existem.