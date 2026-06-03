# Próximos passos: UI de Vídeo, Endereço/Raio e Modo Econômico

A base de dados e os serviços já estão prontos (tabela `ad_video_library`, colunas `video_url`/`video_thumb_url`/`creative_mode`, mínimo R$10/dia × 3 dias, helpers em `facebookAds.ts`). Falta a parte visível e a lógica final no Facebook.

## 1. Edge functions

**`facebook-create-campaign/index.ts`**
- Quando vier `video: { url, thumb_url? }`: baixar/encaminhar o arquivo para `POST /{ad_account}/advideos`, aguardar processamento (poll status até `ready`), e montar `object_story_spec.video_data` com CTA WhatsApp (`call_to_action.type = "WHATSAPP_MESSAGE"`).
- Forçar `publisher_platforms` + `*_positions` para Reels/Stories quando `creative_mode = 'video'` (fb/ig reels + stories + feed vertical).
- Quando vier `custom_locations: [{lat, lng, radius_km, address}]`: substituir `cities` por `geo_locations.custom_locations` no targeting (até 200 pontos, raio 1–50 km).
- Salvar `fb_video_id` em `ad_video_library` para reutilização.

**`facebook-preflight-check/index.ts`**
- Aceitar `custom_locations` e estimar alcance via `reachestimate` com o mesmo targeting.
- Avisar quando alcance estimado < 30k (raio muito pequeno) ou quando vídeo ainda está processando.

## 2. Frontend — wizard de campanha

**Novo componente `AddressRadiusPicker.tsx`**
- Autocomplete de endereço usando Places API (New) `AutocompleteSuggestion.fetchAutocompleteSuggestions` (chave browser já disponível via `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY`).
- Mini-mapa Google Maps JS com marcador + círculo desenhado para o raio.
- Slider 1–50 km e botões rápidos: "Quarteirão" (1 km), "Bairro" (3 km), "Cidade" (10 km).
- Permite adicionar múltiplos pontos (até 200) numa lista lateral.

**`CreateCampaignWizard.tsx`** — adicionar/ajustar etapas:
1. **Criativo**: toggle "Fotos" × "Vídeo Reels". No modo vídeo, upload de 1 arquivo `.mp4/.mov` (até 100 MB, recomendar 9:16) via `uploadAdVideo` → salva em `ad_video_library` e preenche `video_url`/`video_thumb_url`.
2. **Onde anunciar**: alternar entre "Cidade inteira" (modo atual) e "Endereço + raio" (novo `AddressRadiusPicker`).
3. **Orçamento**: presets visíveis — **Modo Econômico** (R$15/dia × 3 dias, vídeo + raio 5 km), **Padrão** (R$25/dia × 7 dias), **Personalizado**. Mostrar estimativa honesta no resumo (ex: "R$45 → ~8-15 conversas no WhatsApp, ~2-4 leads") e alertar quando preflight indicar alcance baixo.

**`AdTemplateEditor.tsx`** — espelhar o toggle foto/vídeo para edição de templates já salvos.

**`smartPublish.ts`** — encaminhar `video` e `custom_locations` para o body do `facebook-create-campaign`.

## 3. Detalhes técnicos

- Upload de vídeo: `supabase.storage.from('ad-videos')` (criar bucket privado na próxima migração se ainda não existir) → URL assinada repassada à edge function.
- Polling do `advideos` status: até 60s, intervalos de 3s; se não ficar `ready`, persistir mesmo assim e a campanha entra `PAUSED` até processar.
- `custom_locations` no Marketing API: `{ latitude, longitude, radius, distance_unit: "kilometer", address_string, name? }`.
- Mensagens de erro amigáveis quando vídeo < 4s, > 100 MB, ou proporção fora de 9:16/1:1.

## Arquivos afetados

- `supabase/functions/facebook-create-campaign/index.ts`
- `supabase/functions/facebook-preflight-check/index.ts`
- `src/components/admin/ads/AddressRadiusPicker.tsx` (novo)
- `src/components/admin/ads/CreateCampaignWizard.tsx`
- `src/components/admin/ads/AdTemplateEditor.tsx`
- `src/services/smartPublish.ts`
- Migração extra apenas se o bucket `ad-videos` ainda não existir.

Confirma para eu seguir com essa implementação?
