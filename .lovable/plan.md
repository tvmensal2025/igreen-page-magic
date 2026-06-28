# Fechar o buraco do whapi: leads de anúncio caindo no Rafael sem aviso nem rodízio

## Diagnóstico (2 leads idênticos)

Marilza (5519992527139) e o novo lead (5519998743654) chegaram pelo whapi com a mesma frase: **`"Olá! Posso ter mais informações sobre isso?"`** — abertura padrão do CTWA do Meta quando o anúncio NÃO propaga `ctwa_clid` no payload. As 3 estratégias atuais de atribuição falham:

| Estratégia | O que faz | Por que falhou |
|---|---|---|
| 1. `ctwa_referral` | Lê `referral.ctwa_clid` do payload | Whapi entregou sem `referral` |
| 2. `initial_message_match` | Jaccard ≥ 0.60 com `facebook_campaigns.initial_message` | "Olá! Posso ter mais informações sobre isso?" × "Olá! Quero saber mais sobre a redução na conta de luz." ≈ 0.30 |
| 3. `regex_fallback` (ADS_REGEX) | Detecta texto de anúncio | Bate, mas só seta `lead_source='meta_ads'`, NÃO resolve `source_campaign_id` → rodízio nunca roda |

Além disso, `attributeLeadSource` **só é chamado no `evolution-webhook`**, não no `whapi-webhook` — por isso o lead novo nem ficou marcado como `meta_ads`.

Resultado: lead fica em Rafael (superadmin), nenhum aviso ao parceiro, nenhum aviso ao Rafael, cadastro vai para o consultor errado.

## O que vai mudar

### 1. Plugar `attributeLeadSource` no whapi-webhook

Em `whapi-webhook/index.ts` (logo antes do bloco de partner-match, ~L724), chamar `attributeLeadSource(supabase, superAdminConsultantId, customer.id, messageText, rawMessage, isAudio, isFile)` se `!customer.source_campaign_id && !customer.lead_source`. Depois recarregar `customer.source_campaign_id` para uso no rodízio.

### 2. Afrouxar o `initial_message_match` (Jaccard 0.60 → 0.40 + bigrama)

Em `_shared/lead-attribution.ts`:
- Adicionar similaridade de bigramas de caracteres (Dice) junto com Jaccard de palavras; aceitar se `max(jaccard, dice) ≥ 0.40`.
- Logar score + campanha vencedora sempre (hoje só loga no acerto).
- Continua threshold conservador o suficiente pra não falsa-atribuir leads orgânicos.

### 3. Lista de frases-âncora do Meta CTWA

Em `_shared/lead-attribution.ts`, nova constante `META_CTWA_OPENING_PHRASES` com as 4–5 frases genéricas que o Meta envia quando o `ctwa_clid` não passa:
- "Olá! Posso ter mais informações sobre isso?"
- "Quero saber mais"
- "Tenho interesse, gostaria de mais informações"
- "Olá, vi o anúncio"
- "Olá! Tenho interesse"

Se a mensagem bater (normalizada, substring), trata como **sinal forte de Meta** (igual `ctwa_referral`): marca `lead_source='meta_ads'` e segue para a resolução de campanha (estratégia 2 com threshold relaxado, e fallback do item 4).

### 4. Fallback "pool única ativa" do superadmin

No `whapi-webhook/index.ts` (e espelhado no `evolution-webhook/index.ts`), após `lead-attribution`, se:
- `lead_source === 'meta_ads'` (acabou de ser detectado), **E**
- `!source_campaign_id` (não conseguiu resolver campanha), **E**
- o superadmin tem **exatamente 1** pool ativa (`rodizio_pools.is_active=true`),

então:
- Setar `source_campaign_id = pool.campaign_id`.
- Chamar `rodizio_next` + `decideRodizioAssignment` normalmente.
- Persistir `referral_partner_id` + `notifyPartnerNewLead`.
- Logar `campaign_match_log` com `method='fallback_single_active_pool'`.

Protegido por flag `app_settings.fallback_single_pool_enabled` (default `true`).

### 5. Aviso ao superadmin (Rafael) em casos suspeitos

Novo helper `_shared/notify-superadmin-fallback.ts`:
- Envia 1 mensagem ao `consultants.notification_phone` do superadmin quando:
  - `method='fallback_single_active_pool'`, ou
  - `lead_source='meta_ads'` mas `source_campaign_id` continuou null mesmo após o fallback, ou
  - regex_fallback bateu sem nenhuma pool ativa.
- Texto: `⚠️ Lead whapi sem campanha clara: {nome ou "(sem nome)"} {telefone}. Motivo: {method}. Atribuído a: {parceiro ou "Rafael (fallback)"}`.
- Dedup por `customer_id` em `outbound_message_log` (`kind='superadmin_fallback_alert'`) — nunca avisa 2× o mesmo lead.
- Chamado no whapi-webhook e no evolution-webhook após o bloco de rodízio.

### 6. Data fix dos 2 leads atuais

Para `a4049f4b…` (Marilza) e `978a8f01…` (lead novo):
- `UPDATE customers SET source_campaign_id='ccef6919-c7ca-48f8-9d6b-a98fe9799b45', lead_source='meta_ads', source_ctwa_clid=NULL`.
- Rodar `rodizio_next` da pool `6baa2324…` 2 vezes (uma por lead) para sortear os parceiros (Nilma e Luiz).
- `UPDATE customers SET referral_partner_id=<partnerId>, referral_detected_at=now()` em cada lead.
- Disparar `notifyPartnerNewLead` 1 vez por lead (best-effort).
- Inserir 2 linhas em `campaign_match_log` com `method='manual_backfill'`.

## Detalhes técnicos

**Arquivos editados:**
- `supabase/functions/whapi-webhook/index.ts` — chama `attributeLeadSource`, adiciona fallback single-pool, chama notify-superadmin.
- `supabase/functions/evolution-webhook/index.ts` — adiciona fallback single-pool + notify-superadmin (paridade).
- `supabase/functions/_shared/lead-attribution.ts` — Dice + bigramas, `META_CTWA_OPENING_PHRASES`, threshold 0.40, logs melhores.
- `supabase/functions/_shared/notify-superadmin-fallback.ts` (novo).

**Sem migrations.** Tudo usa tabelas existentes (`app_settings`, `outbound_message_log`, `campaign_match_log`).

**Sem mudança de bot flow.** Os 2 leads atuais continuam exatamente onde estão (Marilza em `aguardando_conta`, lead novo em `d_como_funciona`); só ganham `referral_partner_id` e os parceiros recebem o aviso que faltou.

**Verificação pós-deploy:**
1. `SELECT id, referral_partner_id, source_campaign_id, lead_source FROM customers WHERE id IN ('a4049f4b…','978a8f01…')` → todos preenchidos.
2. Logs do whapi-webhook mostram `[lead-attribution] method=meta_ctwa_phrase` no próximo lead com a frase do Meta.
3. Próximo lead com `"Olá! Posso ter mais informações sobre isso?"` cai automaticamente no rodízio Nilma/Luiz e dispara aviso ao parceiro + ao Rafael.
