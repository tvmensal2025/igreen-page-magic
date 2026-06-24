# 06 — Backend (Edge Functions)

> Padrões do projeto: Deno, `Deno.serve`, CORS, `caller-auth` para funções internas.  
> Context7 Supabase: secrets via `Deno.env.get`, invoke via `supabase.functions.invoke`.

---

## Funções novas (pasta isolada)

```
supabase/functions/
├── solar-geocode/
│   └── index.ts
├── solar-roof-analyze/
│   └── index.ts
├── solar-render-preview/
│   └── index.ts
├── solar-design-get/
│   └── index.ts
└── _shared/solar/
    ├── google-solar-client.ts
    ├── google-geocode-client.ts
    ├── cache.ts
    ├── types.ts
    ├── economics-br.ts      # estimativa R$ (Lei 14.300 simplificada)
    └── roof-geometry.ts     # GeoTIFF → JSON (Fase 2)
```

Registrar em `supabase/config.toml` com `verify_jwt = true` (exceto endpoint público sanitizado).

---

## `solar-geocode`

### Input

```json
{
  "addressText": "Rua X, 123, Bairro, São Paulo, SP, 01310-100",
  "customerId": "uuid-opcional"
}
```

### Lógica

1. Auth: JWT → `consultant_id`.
2. Se `customerId`: validar ownership (RLS pattern existente).
3. `GET https://maps.googleapis.com/maps/api/geocode/json?address=...&key=...`
4. Retornar `{ lat, lng, formattedAddress, placeId }`.

### Output erro

```json
{ "ok": false, "code": "GEOCODE_ZERO_RESULTS" }
```

---

## `solar-roof-analyze` (orquestrador principal)

### Input

```json
{
  "customerId": "uuid-opcional",
  "lat": -23.55,
  "lng": -46.63,
  "forceRefresh": false
}
```

### Lógica

```
1. Autenticar consultor
2. cacheKey = round(lat,5) + round(lng,5)
3. SELECT solar_roof_analyses WHERE cache_key AND expires_at > now()
4. Se hit e !forceRefresh → return cached
5. findClosestBuilding(lat, lng)
6. Se imageryQuality aceitável → getDataLayerUrls (radius do bbox)
7. Montar solar_design_snapshots default (preset ideal)
8. INSERT analyses + snapshot
9. Return { analysisId, snapshot, metrics, imageryQuality }
```

### Output (sucesso)

```json
{
  "ok": true,
  "analysisId": "uuid",
  "snapshotId": "uuid",
  "imageryQuality": "HIGH",
  "metrics": {
    "panelCapacityWatts": 400,
    "panelsCount": 14,
    "systemSizeKwp": 5.6,
    "yearlyEnergyKwh": 7200,
    "estimatedMonthlySavingsCents": 38000,
    "maxPanels": 42
  },
  "previewUrl": null,
  "disclaimer": "Estimativa comercial. Vistoria técnica obrigatória."
}
```

### Timeouts

- Geocode: 10s
- findClosest: 30s
- dataLayers: 30s
- Total: 60s — após isso retornar 202 + job id (Fase 2b opcional)

---

## `solar-render-preview`

Gera asset estático para WhatsApp/proposta.

### Input

```json
{ "snapshotId": "uuid", "width": 1024, "height": 768 }
```

### Opções implementação

| Opção | Prós | Contras |
|-------|------|---------|
| A) Canvas server Deno + lib PNG | Sem browser | GeoTIFF complexo |
| B) Chromium headless (worker) | Fiel ao 3D | Infra extra |
| C) Compor 2D no EF com RGB URL | Simples MVP | Sem 3D real |

**MVP:** Opção C — fetch RGB signed URL → overlay painéis com coordenadas → PNG → Supabase Storage.

---

## `solar-design-get` / `solar-design-public`

- **get:** consultor autenticado, dados completos.
- **public:** via `proposal.public_token` → só campos marketing (sem lat/lng exatos se LGPD restritivo — ver doc 11).

---

## Módulo `_shared/solar/economics-br.ts`

Entrada:

- `yearlyEnergyKwh`
- `electricityBillValue` (R$)
- `distribuidora` (opcional)

Saída:

- `estimatedOffsetPercent` (cap 95% para Placas)
- `estimatedMonthlySavingsCents`
- `assumptions[]` (transparência)

**v1:** regra simples — não simular TUSD/TE separado.  
**v2:** tabela tarifária por distribuidora (CSV interno).

---

## Configuração secrets

```bash
supabase secrets set GOOGLE_SOLAR_API_KEY=...
supabase secrets set GOOGLE_GEOCODING_API_KEY=...  # ou mesma key Maps
```

Context7: nunca commitar; usar `Deno.env.get` apenas.

---

## `config.toml` entries (planejado)

```toml
[functions.solar-roof-analyze]
verify_jwt = true

[functions.solar-design-public]
verify_jwt = false  # valida token proposta internamente
```

---

## Invocação frontend (Fase 2)

```typescript
const { data, error } = await supabase.functions.invoke("solar-roof-analyze", {
  body: { customerId, lat, lng },
});
```

---

## Rate limiting interno

Reutilizar padrão `try_acquire_rate_limit` se existir para webhooks — nova tabela `solar_api_rate_limit`:

- Max 50 análises/dia/consultor no piloto.
- Max 5/min global burst protection.

---

## Testes backend

| Teste | Método |
|-------|--------|
| Mock Google responses | fixtures JSON em `experiments/solar-3d-ai/fixtures/` |
| cache hit/miss | unit Deno |
| auth negado | integration |
| economics-br | unit com casos BR |
