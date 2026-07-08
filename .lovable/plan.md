# Auditoria do sistema de anúncio + o que falta para 100%

## Parte 1 — O que JÁ está 100% (auditado)

### Criação da campanha (`facebook-create-campaign`)

- Preflight completo antes de criar: Ad Account ativa, token válido, WABA + `phone_number_id`, pixel, página, saldo da carteira suficiente (adicionado agora).
- Segmentação: cidades **ou** endereços com raio 1–50 km (`custom_locations` já implementado no wizard — `AddressRadiusPicker.tsx` + `StepRegion.tsx`).
- Criativo: foto (com formato por posicionamento) ou vídeo Reels com legendas SRT em pt-BR.
- Placements auto (Advantage+) ou manual.
- Mensagem inicial CTWA validada (≤160 chars).
- Rodízio: cria `rodizio_pools` + `rodizio_pool_members` (posição 0..n) quando toggle ligado e ≥2 participantes.

### Atribuição do lead (rodízio validado)

- `evolution-webhook` chama `rodizio_next(campaign_id)` → `_shared/rodizio-assignment.ts` (helper puro, testável).
- Requisitos cobertos: participante da vez recebe `referral_partner_id`, `consultant_id` preservado, rodízio tem prioridade sobre keyword, fallback seguro quando pool vazia/inativa.
- `idconsultor`/`indcli` resolvidos via `buildPortal2Payload` a partir do `referral_partner_id`.

### Aprendizado e enriquecimento (crons ativos)

- `facebook-sync-metrics` (diário) → `facebook_metrics_daily`, `ad_creative_performance`, `ad_spend_daily`.
- `facebook-sync-ad-creatives` → `ad-creative-learner` (padrões vencedores por criativo).
- `ad-competitor-scraper` → `ad_competitor_creatives`.
- `facebook-capi` → eventos com dedupe (`event_id`) para o pixel.
- `facebook-campaign-healthcheck` + `facebook-auto-pause` + `facebook-balance-reconcile`.
- `captacao-intel` (SuperAdmin) cruza funil + criativos + concorrentes → `capture_diagnostics`.
- Cache in-memory de 5 min em `resolveWabaPhone`.

### Status por consultor (destravar publicação)


| Consultor                                   | `phone_number_id`    | Publica?                                 |
| ------------------------------------------- | -------------------- | ---------------------------------------- |
| Rafael                                      | ✅ `1235480166311015` | **SIM**                                  |
| 5519994244390, 5511916827893, 5514933005667 | ❌                    | Só após rodar `admin-resync-waba-phones` |


## Parte 2 — O que AINDA NÃO existe (gaps)

Hoje **não há tela de editar a campanha publicada**. `CampaignFormDialog.tsx` (meta-ads) só edita nome/status/orçamento/mensagem — nada de rodízio, cidades ou raio. `CampaignsList.tsx` não expõe botão "Editar segmentação" ou "Trocar rodízio".

Você pediu: depois de salvar como modelo, poder **(a)** trocar/adicionar outro rodízio com outras pessoas, **(b)** manter as cidades, **(c)** adicionar rua+km ou cidade+km.

## Plano de execução

### 1. Dialog "Editar campanha publicada" (novo)

Criar `EditCampaignDialog.tsx` acessível pela `CampaignsList` (botão "Editar") com 2 abas:

**Aba Rodízio**

- Toggle liga/desliga rodízio.
- Se ligado: multi-select ordenado de `referral_partners` (mesmo componente do wizard).
- Salvar substitui a pool: `UPDATE rodizio_pools SET is_active=false WHERE campaign_id=?` → cria pool nova com novos membros (position 0..n).
- Preserva histórico (`lead_count` das pools antigas fica no banco para auditoria).

**Aba Segmentação (cidades + raio)**

- Reusa `AddressRadiusPicker` (já suporta endereço → lat/lng + km) e o seletor de cidades atual.
- Modos combináveis: cidades sozinhas, endereços com raio sozinhos, ou ambos (Meta aceita).
- Ao salvar: chama nova edge `facebook-update-campaign-targeting` que faz `PATCH` no adset via Graph API (`geo_locations.cities` + `geo_locations.custom_locations`), atualiza colunas em `facebook_campaigns` (cities, custom_locations, cities_km).

### 2. Edge function `facebook-update-campaign-targeting` (nova)

- Auth via `authConsultant` (dono da campanha).
- Valida raio 1–50 km, ≤200 cidades (limite Meta).
- Monta payload `targeting` idêntico ao `create-campaign` (reusar helper).
- `PATCH https://graph.facebook.com/v21.0/{adset_id}` com `targeting`.
- Se Meta rejeitar, retorna erro traduzido (mesmo padrão do `create-campaign`).
- Grava snapshot em `facebook_campaigns` (colunas já existem).

### 3. Edge function `facebook-update-campaign-rodizio` (nova)

- Auth do dono.
- Desativa pool atual (`is_active=false`) — mantém histórico.
- Cria nova pool + membros usando `buildRodizioPoolPlan` já existente.
- Retorna `{ pool_id, members }`.

### 4. Salvar como modelo (já existe: `SaveTemplateDialog.tsx`)

- Ampliar o snapshot salvo em `ad_templates` para incluir também `custom_locations` (hoje só salva `cities`). Novos anúncios criados a partir do template já herdam o raio.

### 5. Validações finais

- Rodar `admin-resync-waba-phones` para destravar os 3 consultores restantes (snippet DevTools).
- Testar: criar campanha com rodízio de 2 partners → clicar no anúncio 3× → verificar `referral_partner_id` alternando circular.
- Testar: editar rodízio adicionando 3º partner → próximos leads incluem o novo na posição 2.
- Testar: editar segmentação adicionando endereço+10km → Meta aceita o PATCH.

## Detalhes técnicos

- Tabelas afetadas: nenhuma migration nova (colunas `cities`, `custom_locations`, `fb_adset_ids` já existem em `facebook_campaigns`; `rodizio_pools.is_active` já existe).
- Arquivos novos: `src/components/admin/ads/EditCampaignDialog.tsx`, `supabase/functions/facebook-update-campaign-targeting/index.ts`, `supabase/functions/facebook-update-campaign-rodizio/index.ts`.
- Arquivos editados: `CampaignsList.tsx` (botão editar), `SaveTemplateDialog.tsx` (incluir custom_locations no snapshot).

## Resposta direta à sua pergunta

- **Aprendizado/enriquecimento**: 100% funcionando (métricas, criativos, concorrentes, CAPI, health, captação).
- **Rodízio validado**: 100% (helper puro + testes de propriedade + fallback seguro).
- **Editar rodízio depois de salvar**: NÃO existe — este plano adiciona. SIM
- **Manter cidades e adicionar rua+km / cidade+km depois**: NÃO existe — este plano adiciona (backend Meta e frontend já sabem lidar com custom_locations, só falta a UI de edição). SIM
- **3 consultores travados**: precisam do resync (snippet já pronto).