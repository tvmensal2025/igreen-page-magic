---
inclusion: fileMatch
fileMatchPattern: "src/components/admin/parceiros/**|supabase/functions/_shared/qr-phrase.ts|supabase/functions/_shared/keyword-matcher.ts|supabase/functions/qr-redirect/**|supabase/functions/whapi-webhook/**|supabase/functions/evolution-webhook/**|supabase/functions/_shared/notify-consultant.ts"
name: parceiros-referral
description: Cadastro de parceiro indicador, keyword, short_code, link /r/{licenca}/{code}, matching no webhook e notificação. Carrega quando mexer em parceiros, QR ou matching de keyword.
---

# Parceiros indicadores — keyword, short_code e matching

Guia canônico da tabela `public.referral_partners` e do fluxo "lead escaneia QR → webhook atribui parceiro → notifyPartnerNewLead".

Referências que ficam vivas:
- Auditoria de rodízio (intersecção): `docs/auditoria-completa/10b-rodizio.md`
- Rodízio de parceiro por campanha Meta: `#rodizio-parceiros-campanha`
- Regra "campanha = UUID, keyword nunca atribui campanha": `.cursor/rules/campanha-uuid-nao-texto.mdc`

---

## 1. Modelo de dados

`public.referral_partners` (fonte de verdade: `src/integrations/supabase/types.ts`)

| Coluna | Papel |
|---|---|
| `id` (uuid) | PK |
| `consultant_id` (uuid) | Dono. RLS `consultants_own_partners` = `auth.uid()` |
| `nome` | Rótulo exibido |
| `keywords` (`text[]`) | Palavras/frases que fazem match no webhook |
| `cli` (NOT NULL) | **ID iGreen do consultor DONO/abonador**, nunca do parceiro (ver `mem/features/partner-id-rules.md`) |
| `partner_igreen_id` | ID iGreen próprio do parceiro (quando existir); usado para somar clientes/metricas sem trocar o dono |
| `notification_phone` | Número BR normalizado (`55DDDNNNNNNNNN`) que recebe aviso de lead novo |
| `qr_phrase` | Frase custom do link WA (fallback = `buildDefaultQrPhrase`) |
| `short_code` | 6+ dígitos únicos por `consultant_id` (gerado por trigger) — usado no link `/r/{licenca}/{code}` e no marcador `#R{code}` da frase |
| `protocol_seq` | Sequência para protocolos `2026-####` |
| `rodizio_metrics_enabled` | Se entra no broadcast horário |
| `is_active` | Soft delete |

RLS: `consultants_own_partners` (owner) + `service_role_all` (webhooks/edge). Nenhuma leitura pública direta — endpoints públicos (`qr-redirect`, webhooks) usam `service_role`.

---

## 2. Fluxo end-to-end

```
Consultor → PartnerForm → useReferralPartners.create
                        → INSERT referral_partners (trigger gera short_code)
                        → PartnerQrCode monta link /r/{licenca}/{short_code}
                             + preview via resolveQrMessage(...)

Lead escaneia QR → edge qr-redirect
    resolve telefone via `resolveConsultantConnectedWaPhone`
      (superadmin → Whapi settings; consultor → Evolution só se status saudável)
    resolve parceiro (ordem: ?p id → short_code (c) → keyword legado (k))
    monta wa.me?text= com resolveQrMessage() (Deno)
        → frase inclui KEYWORD + marcador "#R{short_code}"

Lead manda WA → whapi-webhook / evolution-webhook (inbound)
    IF campanha Meta + pool rodízio ativo → NÃO faz keyword-match
        (blockKeywordForMetaLead; RPC rodízio atribui parceiro)
        Se RPC falhar → needs_manual_review
    ELSE sem campanha/parceiro/keyword → lead do consultor dono (sem revisão)
    ELSE (janela de detecção: < 3 msgs inbound):
        1) extractShortCodeMarker(text)   ← prioridade 1 (determinístico)
        2) matchKeyword(text, partners)   ← prioridade 2 (token exato, SEM fuzzy)

    Match → UPDATE customers SET referral_partner_id, referral_keyword_matched,
            referral_detected_at
          (só se update OK → set in-memory + notifyPartnerNewLead)
          + INSERT campaign_match_log
          + notifyPartnerNewLead(partner.notification_phone, lead)
```

---

## 3. Arquivos-chave

| Área | Arquivo |
|---|---|
| Form/UI | `src/components/admin/parceiros/PartnerForm.tsx`, `ParceirosTab.tsx`, `PartnerDashboard.tsx`, `PartnerQrCode.tsx`, `PartnerKpiRow.tsx` |
| Banners do consultor (hub) | `BannersHub.tsx` (Lista + Resultados), `BannersDashboard.tsx` (gráficos `qr_scan`), `ConsultantBannerDownloadModal.tsx` |
| Spots / QR vivo | tabela `consultant_banner_spots` + `consultants.banner_default_phrase` / `banner_keywords` |
| Hook CRUD | `src/components/admin/parceiros/hooks/useReferralPartners.ts` |
| Analytics | `src/components/admin/parceiros/hooks/usePartnerAnalytics.ts` |
| qrPhrase (front) | `src/components/admin/parceiros/qrPhrase.ts` — `resolveQrMessage`, `buildDefaultQrPhrase`, `GENERIC_KEYWORD_BLOCKLIST` |
| qrPhrase (Deno espelho) | `supabase/functions/_shared/qr-phrase.ts` — mesma lógica + `extractShortCodeMarker` |
| Rota `/r/{licenca}/{code}` | edge `qr-redirect` (HTTP 302 → `wa.me`). Telefone = `resolveConsultantConnectedWaPhone` (não usar `connected_phone` de `needs_reconnect`). Preview UI: `src/lib/consultantWaPhone.ts`. |
| Telefone WA (edge) | `_shared/consultant-wa-phone.ts` + `attendance-channel-env.ts` (superadmin → Whapi) |
| Matcher | `supabase/functions/_shared/keyword-matcher.ts` — `normalizeText`, `hasExactTokenSequence`, `matchKeyword` |
| Webhook Whapi (inbound) | `supabase/functions/whapi-webhook/index.ts` (bloco keyword ≈ L1553–1658) |
| Webhook Evolution | `supabase/functions/evolution-webhook/index.ts` (mesmo bloco, paridade) |
| Aviso ao parceiro | `supabase/functions/_shared/notify-consultant.ts` → `notifyPartnerNewLead` |
| Serviço lista (wizard rodízio) | `src/services/referralPartners.ts` |
| Regra de ID iGreen | `mem/features/partner-id-rules.md` |
| Testes | `src/components/admin/parceiros/__tests__/qrPhrase.test.ts`, `qrPhraseParity.test.ts`, `supabase/functions/_shared/keyword-matcher_test.ts` |

---

## 4. Regras invioláveis

- **Nunca** reintroduzir fuzzy/Levenshtein no `matchKeyword`. Só match por sequência de tokens exata (após normalize NFD/lower/sem pontuação). Motivo real: "Nilza" atribuía leads da parceira "Nilma" — comentário no topo de `keyword-matcher.ts`.
- **Nunca** deixar keyword genérica (`energia`, `luz`, `desconto`, `oi`, `promoção`, …) virar identificador. Validar sempre com `GENERIC_KEYWORD_BLOCKLIST`.
- **Front e Deno DEVEM ficar idênticos.** Se editar `qrPhrase.ts`, editar `_shared/qr-phrase.ts` no mesmo commit. `qrPhraseParity.test.ts` trava divergência.
- **`short_code` tem prioridade sobre keyword** no matcher — é o marcador determinístico que sobrevive a texto natural do lead.
- **Marcador `#R{code}` prevalece sobre o limite de 90 chars** da frase (`QR_PHRASE_MAX`). Nunca cortar o marcador para caber.
- **Lead de campanha Meta com rodízio ativo NÃO cai em keyword-match.** A RPC de rodízio atribui o parceiro. Se a RPC falhar (`rodizio_rpc_error` / conflito de bind / ad_id mismatch) → `needs_manual_review`.
- **Sem campanha com parceiros (nem keyword/`#R`):** lead fica **direto com o consultor dono** — **não** entra em fila de revisão (`no_campaign_ctwa_phrase`, `strong_meta_unmapped`, `meta_lead_no_campaign_or_pool`, `rodizio_pool_empty`). Ver `OWNER_ONLY_NO_REVIEW_REASONS` em `_shared/rodizio-cas.ts`.
- **`cli` nunca é do parceiro.** Sempre o ID iGreen do consultor dono/abonador. Métrica soma dois IDs (dono + `partner_igreen_id`) sem trocar o dono.
- **`notifyPartnerNewLead` não notifica lead `is_sandbox`.** Manter esse guard.
- **Só notificar parceiro depois do UPDATE de `referral_partner_id` sem erro** (Whapi e Evolution). Nunca setar só em memória e avisar.
- **QR / wa.me usa chip vivo:** `resolveConsultantConnectedWaPhone` — Evolution só com status `connected|online|open`; superadmin Whapi usa `settings.whapi_connected_phone`. Nunca o `connected_phone` mais recente sem filtrar status.
- Toda inserção/leitura pública passa por `service_role` na edge — não expor `referral_partners` via RLS anon.
- **Banners do consultor nunca hard-delete:** arquivar = `consultant_banner_spots.is_active = false`. Criar local novo só adiciona. Geral (`/{ini}/{igreen_id}`) é eterno. Telemetria: `page_events.event_type=qr_scan` com `event_target=banner_root` ou `banner_spot:{code}` (legado: `panfleto` = Geral).

---

## 4b. Banners do consultor (QR vivo)

- UI: Parceiros → **Central de Banners** → `BannersHub` (abas **Meus | Parceiros | Ranking**).
- Meus: Geral + `consultant_banner_spots` + `BannersDashboard` + tabela Nome|leituras|leads.
- Parceiros: `PartnerBannersPanel` + tabela `referral_partner_banner_spots` (nome obrigatório, arquivar, CSV, link `/p/{portal_token}`).
- Ranking: `BannersRanking` unifica seus + parceiros.
- Página do parceiro: `PartnerBannerPortalPage` (`/p/{portal_token}`) + RPC `get_partner_banner_portal`.
  - Visual dark premium (`src/components/parceiros-portal/*`): hero, KPIs, **pizzas A/B/C**, banners.
  - **KPIs canônicos (não reabrir):**
    - `stats.leads` = **todos** `customers` com `referral_partner_id` (Meta rodízio + QR/`#R`/keyword).
    - `stats.leituras` = só `page_events.qr_scan` com `event_target` `partner:{short}` (+ spots). **Meta CTWA não conta leitura.**
    - `stats.fechamentos` = `pos_venda_stage = 'Aprovado'`.
  - **Telefone no rodapé do flyer:** chip vivo via RPC — Whapi (`settings.whapi_connected_phone` se superadmin) **ou** Evolution/`whatsapp_instances` com status `connected|online|open`; fallback `consultants.phone`. Nunca `notification_phone`. Admin UI usa o mesmo critério em `resolveConsultantWaPhoneForUi` (`isWhapi` + instância saudável).
  - Clique na linha do banner → `PartnerPortalDownloadModal` (só baixar A4/Banner PNG·PDF; sem editar frase).
  - Preview/impressão compartilham `FLYER_TEMPLATES` + `FlyerStaticPreview` (`src/components/admin/flyerTemplates.ts`) — PartnerQrCode / LiveModal / PortalDownload / ConsultantBanner.
  - RPC devolve `consultant.{name,igreen_id,phone}` + `cycle_leads` **só elegíveis** (filtros SQL ≈ `isCycleLeadEligible` + exige stage ou fila do dia) com nome, `phone_whatsapp`, stage, fila (`queue_queue`/`queue_step`), pós-venda.
  - Classificação: `src/lib/partnerPortalCycle.ts` (fila diária prioriza; sem stage/fila → fora da pizza).
  - Clique na fatia: nome + telefone (`tel:`) + **aviso da etapa** (+ próximo toque).
  - Meta `noindex,nofollow` com cleanup no unmount. Aviso “Link privado — não compartilhe”.
- Limiar `banner_alert_threshold` no parceiro (0=off). Cron `partner-banner-alerts-cron` (15 min) conta leads/24h; se >= limiar, avisa consultor (e parceiro se tiver `notification_phone`). Dedup `banner_alert_last_at`.
- `notifyPartnerNewLead` **pula** lead com `do_not_contact` (salvo `force`).
- Telemetria `qr-redirect`: `banner_root` / `banner_spot:{code}` / `partner:{short}` / `partner:{short}:{spot}`. Insert de `qr_scan` é **await** (não fire-and-forget). Canal WA do redirect = Whapi **ou** Evolution via `resolveConsultantConnectedWaPhone`.
- Keywords espelho em `consultants.banner_keywords` e `referral_partners.keywords` — sync **une** (nunca remove histórico ao arquivar).

---

## 5. Riscos abertos (documentar antes de "consertar")

- **DNC/opt-out:** `notifyPartnerNewLead` checa `customers.do_not_contact` e não notifica (exceto `force`). Manter esse gate.
- Colunas `partner_igreen_id` e `notification_phone` não têm `ADD COLUMN` textual localizável em `supabase/migrations/`; `types.ts` é a fonte de verdade real. Antes de renomear/dropar, confirmar no schema remoto.
- `PartnerQrCode.tsx` deve usar sempre `short_code` no path; nunca embutir keyword crua na URL (a keyword vai só no `?text=` codificado).

---

## 6. Onde tocar para uma tarefa comum

| Tarefa | Onde |
|---|---|
| Bloquear nova keyword genérica | `qrPhrase.ts` → `GENERIC_KEYWORD_BLOCKLIST` (front) — o Deno usa a mesma normalização |
| Mudar frase padrão do QR | `buildDefaultQrPhrase` nos DOIS arquivos |
| Ajustar prioridade do match | `whapi-webhook/index.ts` e `evolution-webhook/index.ts` no MESMO PR (paridade) |
| Adicionar canal de aviso ao parceiro | `notifyPartnerNewLead` em `_shared/notify-consultant.ts` |
| Migrar keyword antiga p/ short_code | rodar backfill via edge + atualizar QR salvos |
