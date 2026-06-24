# 03 — Google Solar API (documentação Context7)

> Fonte: Context7 library `/googlemaps-samples/js-solar-potential` (sample oficial Google) + Google Maps Platform docs.  
> Referência de implementação: [js-solar-potential](https://github.com/googlemaps-samples/js-solar-potential)

---

## Pré-requisitos Google Cloud

1. Projeto GCP com **billing habilitado** (Context7: produção exige API key padrão + billing).
2. Habilitar APIs:
   - **Solar API** (`solar.googleapis.com`)
   - **Geocoding API** (endereço → lat/lng)
   - Opcional: **Maps JavaScript API** (mapa interativo no frontend)
3. Restringir API key:
   - Key **server** (Edge Function): IP/referrer restrito + só Solar + Geocoding.
   - Key **client** (se mapa JS): HTTP referrer do domínio iGreen.

**Regra crítica:** nunca expor key server no Vite `import.meta.env` público.

---

## Endpoint 1: `buildingInsights:findClosest`

### Propósito

Retorna metadados de potencial solar do **edifício mais próximo** de uma coordenada.

### Chamada (REST)

```
GET https://solar.googleapis.com/v1/buildingInsights:findClosest
  ?location.latitude={lat}
  &location.longitude={lng}
  &requiredQuality=BASE
  &key={API_KEY}
```

`requiredQuality=BASE` — retorna a melhor qualidade disponível sem falhar se HIGH ausente (padrão do sample Context7).

### Resposta — campos essenciais

| Campo | Uso iGreen |
|-------|------------|
| `solarPotential.maxArrayPanelsCount` | Teto superior de módulos |
| `solarPotential.maxSunshineHoursPerYear` | Argumento comercial |
| `solarPotential.panelCapacityWatts` | Watts por módulo (ex.: 400W) |
| `solarPotential.solarPanelConfigs[]` | `{ panelsCount, yearlyEnergyDcKwh }` — curva tamanho×geração |
| `solarPotential.solarPanels[]` | Posição de cada slot de painel (lat/lng ou segment) |
| `solarPotential.roofSegmentStats[]` | Área, azimute, inclinação por face |
| `imageryQuality` | HIGH / MEDIUM / BASE — decisão de confiança |
| `imageryDate` | Data da imagem (transparência com cliente) |

### Erros (tratar no backend)

```typescript
// Context7: RequestError shape
{ error: { code: number, message: string, status: string } }
```

| Código típico | Ação iGreen |
|---------------|-------------|
| 404 / NOT_FOUND | Fallback: sketch manual ou foto celular |
| 403 | Key/billing — alerta super admin |
| 429 | Rate limit — fila + retry exponencial |

### Exemplo TypeScript (server-side)

```typescript
export async function findClosestBuilding(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<BuildingInsightsResponse> {
  const url = new URL("https://solar.googleapis.com/v1/buildingInsights:findClosest");
  url.searchParams.set("location.latitude", String(lat));
  url.searchParams.set("location.longitude", String(lng));
  url.searchParams.set("requiredQuality", "BASE");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json();
    throw err; // { error: { code, message, status } }
  }
  return res.json();
}
```

---

## Endpoint 2: `dataLayers:get`

### Propósito

URLs assinadas (GCS) para rasters GeoTIFF: DSM, máscara, RGB, fluxo anual/mensal, sombra horária.

### Chamada

```
GET https://solar.googleapis.com/v1/dataLayers:get
  ?location.latitude={lat}
  &location.longitude={lng}
  &radiusMeters={radius}
  &view=FULL_LAYERS
  &requiredQuality=BASE
  &key={API_KEY}
```

`radiusMeters` — tipicamente ~50m ou diagonal do bounding box do edifício (sample Context7).

### Resposta — campos essenciais

| Campo | Uso |
|-------|-----|
| `dsmUrl` | Modelo de superfície (elevação) |
| `rgbUrl` | Imagem aérea colorida |
| `maskUrl` | Máscara do telhado |
| `annualFluxUrl` | Irradiância anual |
| `monthlyFluxUrl` | Sazonalidade |
| `hourlyShadeUrls[]` | 12 arquivos — sombreamento mensal |
| `imageryQuality` | Confiança do render |

### Processamento

O sample Google usa **geotiff.js** no browser para ler pixels.  
**Plano iGreen:** processar GeoTIFF na **Edge Function** (ou worker) e devolver:

- PNG preview 2D (leve para WhatsApp)
- Geometria simplificada JSON para R3F (vértices do telhado)

Evitar enviar 12 GeoTIFFs ao cliente mobile.

---

## Fluxo completo (sample oficial)

```
Endereço usuário
  → Geocoding API → LatLng
  → buildingInsights:findClosest → configs + panel slots
  → dataLayers:get → URLs rasters
  → (opcional) render 3D + financial module
  → proposta / UI
```

---

## Módulo financeiro (sample Context7)

O sample inclui estimativa de:

- Custo instalação
- Economia energia
- Payback

**iGreen:** não usar defaults US do sample. Substituir por:

- `electricity_bill_value` do `customers`
- Tarifa estimada por `distribuidora` (tabela interna futura)
- % economia Placas (até 95% no copy — usar faixa conservadora na simulação)

---

## Cobertura Brasil

- Google declara 40+ países; Brasil incluído em expansões recentes da Solar API.
- **Risco:** qualidade `BASE` em bairros novos, área rural, telhados metálicos complexos.

### Estratégia de validação (Fase 0 spike)

Testar 20 endereços:

| Região | Qtd | Objetivo |
|--------|-----|----------|
| SP capital | 8 | HIGH esperado |
| Interior MG | 4 | MEDIUM/BASE |
| RJ | 4 | misto |
| Condomínio vertical | 2 | pode falhar — documentar |
| Laje comercial | 2 | validar segmentação |

Registrar `imageryQuality` + latência em planilha → define % de fallback.

---

## Alternativas se Google falhar

| Fallback | Quando | Esforço |
|----------|--------|---------|
| Sketch 2D (OpenSolar-style) | Imagem ruim | Médio — UI desenho polígonos |
| Foto celular + overlay | Sem cobertura | Baixo — canvas 2D |
| Entrada manual kWp | Último recurso | Já existe no orçamento |

---

## Rate limits e custos (planejar)

- Consultar [Google Maps Platform pricing — Solar](https://mapsplatform.google.com/maps-products/solar/) no momento do spike.
- **Cache obrigatório:** mesma lat/lng (6 casas decimais) → não re-chamar API por 30 dias.
- Log por consultor: `solar_api_calls` para controle de wallet interno (opcional).

---

## Referências Context7 consultadas

| Library ID | Uso |
|------------|-----|
| `/googlemaps-samples/js-solar-potential` | Endpoints, tipos, erros, fluxo |
| `/websites/developers_google_maps_javascript` | API keys, billing, setup |
| `/pmndrs/react-three-fiber` | Render 3D (doc 05) |
| `/supabase/supabase` | Edge secrets, CORS, invoke |
