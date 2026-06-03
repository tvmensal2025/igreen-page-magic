## Objetivo

Remover dependência do Google Maps no `AddressRadiusPicker.tsx` e usar **Nominatim (OpenStreetMap)** para autocomplete de endereços. Sem mapa visual, sem chave de API, sem custo.

## O que muda

**Arquivo único:** `src/components/admin/ads/AddressRadiusPicker.tsx`

1. Remover todo o código de carregamento do Google Maps JS (`loadMapsApi`, `mapsLoadPromise`, refs de mapa/marker/circle, `renderAll`, `useEffect` do mapa).
2. Remover variáveis `BROWSER_KEY` / `TRACKING_ID` e o bloco de aviso "Google Maps não está configurado".
3. Substituir o autocomplete do Places API por chamada direta ao Nominatim:
   - Endpoint: `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=br&limit=8&q={query}`
   - Headers: `Accept: application/json` (sem User-Agent custom — browser bloqueia)
   - Debounce 400ms (Nominatim pede ≤1 req/s; 400ms + debounce do digitar fica seguro)
   - Resposta traz `lat`, `lon`, `display_name` → mapear direto para `RadiusPoint`
4. Remover o `<div>` do mapa (`mapDivRef`). Manter:
   - Input com sugestões em dropdown
   - Slider de raio (1–50 km)
   - Botões de preset (Quarteirão / Bairro / Região / Cidade)
   - Bloco "Confirmar" verde
   - Lista de pontos confirmados com badges removíveis
5. Adicionar pequeno texto informativo: "Buscando endereços via OpenStreetMap".
6. Manter exatamente a mesma interface `RadiusPoint` e props `value`/`onChange` — `CreateCampaignWizard.tsx` continua funcionando sem alteração.

## Detalhes técnicos

- Nominatim é gratuito e público, sem chave. Política de uso permite apps de baixo volume; para produção pesada o ideal seria self-host, mas dado o uso (admin criando campanha pontualmente) está dentro do aceitável.
- Coordenadas vêm como string → converter com `parseFloat`.
- Tratamento de erro: se fetch falhar, mostrar mensagem discreta abaixo do input.
- Sem mudanças no backend, banco, ou em `CreateCampaignWizard.tsx`.

## Fora de escopo

- Mini-mapa visual (escolha Opção B explícita do usuário).
- Remoção do conector Google Maps em outros lugares — esse componente era o único consumidor da chave `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY` no front.
