# 05 — Frontend 3D e visualização

> Referência Context7: `/pmndrs/react-three-fiber` — lazy loading, Suspense, `frameloop="demand"`.

---

## Rotas (isoladas)

| Rota | Fase | Quem acessa |
|------|------|-------------|
| `/experiments/solar-3d` | 1 | Dev / super admin |
| `/admin/solar-design` | 2 | Consultor com flag |
| `/admin/solar-design/:analysisId` | 2 | Detalhe + editor |
| Seção em `/proposta/:token` | 3 | Cliente público |

Registrar em `App.tsx` **somente na Fase 2**, com lazy:

```tsx
const SolarDesignPage = lazy(() => import("@/features/solar-3d/pages/SolarDesignPage"));
```

## Stack UI proposta

| Lib | Versão alvo | Uso |
|-----|-------------|-----|
| `three` | ^0.17x | Core WebGL |
| `@react-three/fiber` | ^8 ou ^9 | React renderer |
| `@react-three/drei` | latest | OrbitControls, Environment, Html |
| `@googlemaps/js-api-loader` | optional | Mapa 2D |
| `geotiff` | optional | Só se parse client-side (evitar prefer server) |

**Não adicionar ao package.json root na Fase 0** — só em `experiments/solar-3d-ai/package.json`.

---

## Modos de visualização

### Modo A — Mapa 2D + overlay (MVP Fase 1)

- Imagem RGB do `dataLayers` ou Static Maps API.
- Polígonos SVG das `roofSegmentStats`.
- Retângulos painéis nas posições `solarPanels`.
- **Prós:** leve, funciona em qualquer celular, fácil export PNG.
- **Contras:** menos “uau” que 3D.

### Modo B — Viewer 3D (Fase 2)

Context7 R3F patterns:

```tsx
<Canvas frameloop="demand">
  <Suspense fallback={<SolarLoader />}>
    <SolarScene analysis={data} panelCount={selectedPanels} />
    <OrbitControls enablePan={false} maxPolarAngle={Math.PI / 2.2} />
    <Environment preset="city" />
  </Suspense>
</Canvas>
```

**SolarScene:**

1. Malha extrudada por face de telhado (vértices do backend).
2. `InstancedMesh` para módulos (performance).
3. Material simples — não PBR pesado.
4. Árvores/sombra: opcional v2 (sem geometria complexa v1).

### Modo C — Sketch fallback (Fase 2)

Inspirado OpenSolar OS 3.0:

- Usuário desenha polígonos sobre imagem satélite.
- Salva `manual_roof_segments` no snapshot.
- IA/dimensionamento por área × fator (sem Solar API).

---

## Componentes detalhados

### `SolarAddressSearch`

- Autocomplete: customer recente OU Google Places (se habilitado).
- Valida: CEP + cidade + UF mínimo.
- Exibe badge se endereço veio do CRM.

### `SolarMetricsPanel`

| Métrica | Fonte | Exibição |
|---------|-------|----------|
| Módulos | slider → `solarPanelConfigs` | "12 painéis" |
| kWp | `panels × panelCapacityWatts / 1000` | "4,8 kWp" |
| kWh/ano | config selecionada | "6.200 kWh/ano" |
| Economia R$/mês | kWh × tarifa × % | "R$ 380/mês*" |
| Qualidade | `imageryQuality` | HIGH=verde, BASE=amarelo |
| Data imagem | `imageryDate` | "Imagem: jul/2023" |

`*` Disclaimer fixo: estimativa, sujeita a vistoria.

### `SolarPanelSlider`

- Min: 4 módulos (ou mínimo comercial iGreen).
- Max: `maxArrayPanelsCount`.
- Presets: "Econômico" (70% offset conta), "Ideal" (100% offset).

### `SolarExportActions`

| Ação | Output |
|------|--------|
| Salvar snapshot | DB |
| Baixar PNG | share WhatsApp |
| Copiar link interno | `/admin/solar-design/:id` |
| Anexar à proposta | adapter → OrcamentoBuilder |

---

## Integração com design system iGreen

- Usar `section-container`, `Button`, `Card` de `@/components/ui/*`.
- Cores: primária verde iGreen; painéis azul escuro (#1a365d).
- Mobile: modo 2D default; toggle "Ver 3D" só desktop/tablet forte.

---

## Acessibilidade

- Preview 3D: `aria-label` + versão 2D sempre disponível.
- Não depender só de cor para qualidade (ícone + texto).
- `prefers-reduced-motion`: desabilitar orbit auto-rotate.

---

## Export imagem para WhatsApp

1. `canvas.toDataURL` do modo 2D **ou**
2. `gl.domElement.toBlob` do R3F (resolução max 1280px).
3. Upload MinIO (padrão existente `uploadMedia`).
4. URL pública temporária para vendedora enviar.

**Anti-ban:** seguir quotas mídia existentes em `_shared/anti-ban.ts` na Fase 4.

---

## Estados de UI

| Estado | UI |
|--------|-----|
| `idle` | Form endereço |
| `geocoding` | Spinner "Localizando..." |
| `analyzing` | Progress "Analisando telhado..." 15–60s |
| `ready` | Viewer + métricas |
| `low_quality` | Banner amarelo + sketch |
| `not_found` | Modal fallback manual |
| `error` | Retry + suporte |

---

## Testes frontend

| Tipo | O que |
|------|-------|
| Unit | Cálculo kWp, economia, presets |
| Component | Slider, disclaimer, estados |
| Visual | Snapshot PNG do modo 2D |
| E2E | `/experiments/solar-3d` com mock API |
| Performance | Lighthouse na rota — budget +200KB gzip max lazy chunk |
