## O que muda no anúncio

Hoje o sistema só aceita **fotos** e segmenta **cidade inteira** com mínimo de R$20/dia × 7 dias = R$140 travados na carteira. Vou abrir três frentes:

### 1. Anunciar apenas com 1 vídeo (Reels)

- No editor de campanha (`CreateCampaignWizard.tsx` step "Criativo") adicionar um **toggle "Foto" / "Vídeo"**. Modo vídeo aceita 1 arquivo `.mp4/.mov` (até ~100 MB, 9:16 recomendado para Reels) e desabilita o uploader de fotos.
- Upload do vídeo para o bucket `IMAGE` (já existe) em `ad-videos/{consultantId}/...`.
- `ad_templates`: adicionar colunas `video_url text`, `video_thumb_url text` (capa opcional). Editor de templates ganha mesma opção.
- `facebook-create-campaign`:
  - Aceitar `video: { url, thumb_url? }` no body.
  - Subir o vídeo via `POST /{ad_account}/advideos` (multipart `source`) → recebe `video_id`. Cache em nova tabela `ad_video_library` (espelha `ad_image_library`).
  - Pular fluxo de `asset_feed_spec`/fotos quando há vídeo: montar `object_story_spec.video_data = { video_id, image_url: thumb, call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP", link: wa.me/... } }, message: primary_text, title: headline }`.
  - Em modo vídeo, **forçar placements Reels-first** (`fb:facebook_reels`, `ig:reels`, `ig:story`, `fb:story`) — mais barato e nativo para vídeo vertical.

### 2. Segmentação por endereço / raio (rua, casa do conhecido, bairro)

- Novo step no wizard: **"Onde anunciar"** com 2 modos:
  - **Cidades** (atual, mantido).
  - **Endereço + raio** (novo): campo de busca com autocomplete usando o conector Google Maps (Places API New, `PlaceAutocompleteElement`); slider de raio **1 km a 50 km** (mínimo do Meta é 1 km / ~0.6 mi); opcional adicionar **múltiplos pontos** (até 200) para cobrir vizinho + bairro + outra rua. Mostra mini-mapa com círculos.
  - Botões rápidos: **"Só este quarteirão" (1 km)**, **"Bairro" (3 km)**, **"Cidade inteira"** (cai no modo cidade).
- `facebook-create-campaign` passa a aceitar `custom_locations: [{ latitude, longitude, radius, distance_unit: "kilometer", address_string }]` em `geo_locations`. Quando vier preenchido, **substitui** o array `cities` no targeting.
- Pré-validação de alcance (`facebook-preflight-campaign`) usa o mesmo payload — alerta se ficar <5 mil pessoas (raio pequeno demais para o algoritmo otimizar).

### 3. Análise + ajustes para gastar menos e converter mais

Diagnóstico do que está caro hoje:

1. **Trava de 7 dias × R$20** força R$140 mínimo no saldo, mesmo querendo testar com R$10/dia.
2. **Cidade inteira sem raio** entrega muito impressionamento desperdiçado em quem não vai virar cliente.
3. Falta vídeo vertical — Reels tem CPM **~40% mais barato** que feed estático para CTWA.
4. Otimização por `CONVERSATIONS` exige ~50 conversas/semana pra sair do aprendizado; com R$20/dia em cidade grande, dilui demais.

Ações:

- Reduzir mínimo na UI para **R$10/dia** e duração mínima de **3 dias** (R$30 travados em vez de R$140). Backend: baixar `daily_budget_cents < 2000` para `< 1000`, manter checagem de saldo proporcional. Mostrar aviso "abaixo de R$20/dia o Facebook leva mais tempo para otimizar".
- **Modo Econômico** (botão destacado no resumo): pré-seleciona vídeo + raio 5 km do endereço do consultor + R$15/dia + 3 dias + placements Reels/Stories. Esse é o preset "gastar pouco e validar".
- Mostrar no resumo um **estimador honesto**: "Com R$15/dia × 3 dias = R$45 → ~8-15 conversas iniciadas no WhatsApp, ~2-4 leads cadastrados" baseado no CPL médio do template (`avg_cpl_cents`) quando existir.
- Aviso quando alcance preflight < 30 mil: "Audiência pequena — bom para teste local, mas o CPL pode subir após 2 dias".

## Arquivos a tocar

```
supabase/migrations/*  -> ad_templates: + video_url, video_thumb_url
                         + ad_video_library (espelha ad_image_library)
supabase/functions/facebook-create-campaign/index.ts
                         -> aceitar video + custom_locations, baixar mínimo p/ 1000
supabase/functions/facebook-preflight-campaign/index.ts
                         -> aceitar custom_locations
src/services/adTemplates.ts -> campos video_url/thumb
src/services/facebookAds.ts -> tipo CustomLocation + payload no createCampaign
src/components/admin/ads/CreateCampaignWizard.tsx
                         -> toggle foto/vídeo, step endereço+raio, modo Econômico
src/components/admin/ads/AdTemplateEditor.tsx (se existir) -> upload de vídeo
src/components/admin/ads/AddressRadiusPicker.tsx (novo)
                         -> Google Maps autocomplete + mapa + slider de raio
src/services/smartPublish.ts -> preset "Econômico" passa pelo mesmo caminho
```

## Conectores

- **Google Maps**: já está como conector disponível. Vou usar Places API (New) para autocomplete de endereço e Maps JavaScript API para o mini-mapa com os círculos de raio. Browser key já injetada como `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY` — não precisa nova configuração.

## Confirma para eu seguir?

implemente tudo, analisando cada ponto e para ficar 100%