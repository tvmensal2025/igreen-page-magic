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
    resolve parceiro (ordem: ?p id → short_code (c) → keyword legado (k))
    monta wa.me?text= com resolveQrMessage() (Deno)
        → frase inclui KEYWORD + marcador "#R{short_code}"

Lead manda WA → whapi-webhook / evolution-webhook (inbound)
    IF campanha Meta + pool rodízio ativo → NÃO faz keyword-match
        (blockKeywordForMetaLead; lead vai para needs_manual_review)
    ELSE (janela de detecção: < 3 msgs inbound):
        1) extractShortCodeMarker(text)   ← prioridade 1 (determinístico)
        2) matchKeyword(text, partners)   ← prioridade 2 (token exato, SEM fuzzy)

    Match → UPDATE customers SET referral_partner_id, referral_keyword_matched,
            referral_detected_at
          + INSERT campaign_match_log
          + notifyPartnerNewLead(partner.notification_phone, lead)
```

---

## 3. Arquivos-chave

| Área | Arquivo |
|---|---|
| Form/UI | `src/components/admin/parceiros/PartnerForm.tsx`, `ParceirosTab.tsx`, `PartnerDashboard.tsx`, `PartnerQrCode.tsx`, `PartnerKpiRow.tsx` |
| Hook CRUD | `src/components/admin/parceiros/hooks/useReferralPartners.ts` |
| Analytics | `src/components/admin/parceiros/hooks/usePartnerAnalytics.ts` |
| qrPhrase (front) | `src/components/admin/parceiros/qrPhrase.ts` — `resolveQrMessage`, `buildDefaultQrPhrase`, `GENERIC_KEYWORD_BLOCKLIST` |
| qrPhrase (Deno espelho) | `supabase/functions/_shared/qr-phrase.ts` — mesma lógica + `extractShortCodeMarker` |
| Rota `/r/{licenca}/{code}` | edge `qr-redirect` (HTTP 302 → `wa.me`). QR/link novos apontam direto pra edge; SPA `/r/...` só compatibilidade (bounce imediato). |
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
- **Lead de campanha Meta com rodízio ativo NÃO cai em keyword-match.** Vai para `needs_manual_review` até a RPC de rodízio resolver.
- **`cli` nunca é do parceiro.** Sempre o ID iGreen do consultor dono/abonador. Métrica soma dois IDs (dono + `partner_igreen_id`) sem trocar o dono.
- **`notifyPartnerNewLead` não notifica lead `is_sandbox`.** Manter esse guard.
- Toda inserção/leitura pública passa por `service_role` na edge — não expor `referral_partners` via RLS anon.

---

## 5. Riscos abertos (documentar antes de "consertar")

- **DNC/opt-out do lead não é checado antes de `notifyPartnerNewLead`.** Parceiro pode receber dados de lead que pediu para não ser contatado (mesmo apontamento em `10b-rodizio.md`). Se for corrigir, gate em `notify-consultant.ts` consultando `customers.do_not_contact` + `voice_dnc_list`.
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
