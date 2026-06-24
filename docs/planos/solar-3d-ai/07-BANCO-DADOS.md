# 07 — Banco de dados

Novas tabelas **isoladas** — migrations em `supabase/migrations/` só na Fase 2, prefixo `solar_`.

---

## `solar_roof_analyses`

Cache e histórico de chamadas à Google Solar API.

```sql
CREATE TABLE public.solar_roof_analyses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id     UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  customer_id       UUID REFERENCES public.customers(id) ON DELETE SET NULL,

  -- Input
  address_text      TEXT,
  latitude          DOUBLE PRECISION NOT NULL,
  longitude         DOUBLE PRECISION NOT NULL,
  cache_key         TEXT NOT NULL,  -- hash lat/lng 5 casas

  -- Google response (raw, service-only)
  building_insights JSONB NOT NULL,
  data_layers       JSONB,          -- URLs + metadata (podem expirar)
  imagery_quality   TEXT NOT NULL CHECK (imagery_quality IN ('HIGH','MEDIUM','BASE','UNKNOWN')),
  imagery_date      DATE,

  -- Derived
  max_panels        INTEGER,
  panel_watts       INTEGER,
  max_yearly_kwh    NUMERIC(12,2),

  -- Lifecycle
  source            TEXT NOT NULL DEFAULT 'google_solar_api',
  expires_at        TIMESTAMPTZ NOT NULL,  -- cache TTL 30 dias
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX solar_roof_analyses_cache_consultant
  ON public.solar_roof_analyses (consultant_id, cache_key)
  WHERE expires_at > now();  -- partial: apenas vigentes (ou tratar em app)
CREATE INDEX solar_roof_analyses_customer ON public.solar_roof_analyses (customer_id);
```

---

## `solar_design_snapshots`

Versões editáveis (slider painéis, presets).

```sql
CREATE TABLE public.solar_design_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id       UUID NOT NULL REFERENCES public.solar_roof_analyses(id) ON DELETE CASCADE,
  consultant_id     UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,

  panels_count      INTEGER NOT NULL,
  system_kwp        NUMERIC(8,2) NOT NULL,
  yearly_energy_kwh NUMERIC(12,2),
  monthly_savings_cents INTEGER,

  -- Geometria simplificada para frontend (sem GeoTIFF)
  roof_segments     JSONB NOT NULL DEFAULT '[]',
  panel_positions   JSONB NOT NULL DEFAULT '[]',

  -- Assets
  preview_image_path TEXT,  -- storage path PNG
  manual_sketch      JSONB, -- fallback polígonos usuário

  label             TEXT,   -- "Econômico", "Ideal", custom
  is_primary        BOOLEAN NOT NULL DEFAULT true,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## `solar_api_usage_log` (opcional, recomendado)

Auditoria de custos.

```sql
CREATE TABLE public.solar_api_usage_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID REFERENCES public.consultants(id),
  endpoint      TEXT NOT NULL,  -- findClosest | dataLayers | geocode
  cache_hit     BOOLEAN NOT NULL DEFAULT false,
  latency_ms    INTEGER,
  error_code    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## Alteração em `proposals` (Fase 3 apenas)

```sql
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS solar_snapshot_id UUID
    REFERENCES public.solar_design_snapshots(id) ON DELETE SET NULL;
```

Alternativa **sem migration:** guardar em `line_items` meta:

```json
{ "kind": "solar_design", "snapshotId": "...", "previewUrl": "..." }
```

**Preferência Fase 3:** coluna FK explícita + meta em line_items para render.

---

## Feature flag consultor

```sql
ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS solar_3d_enabled BOOLEAN NOT NULL DEFAULT false;
```

Ou tabela `consultant_features` se já existir padrão similar (auditar antes de implementar).

---

## RLS

| Tabela | SELECT | INSERT | UPDATE |
|--------|--------|--------|--------|
| `solar_roof_analyses` | `consultant_id = auth.uid()` mapping | mesmo | mesmo |
| `solar_design_snapshots` | idem | idem | idem |
| `solar_api_usage_log` | super admin only | service_role | — |

Página pública: **não** acessa tabelas — só edge function `solar-design-public`.

---

## Storage (Supabase)

Bucket: `solar-previews` (privado)

- Path: `{consultant_id}/{snapshot_id}.webp`
- Policy: signed URL 7 dias para proposta pública
- Context7 Supabase: configurar secrets S3 se usar mount persistente (opcional)

---

## Índices de performance

- `cache_key` + `consultant_id` para dedup.
- `created_at DESC` em analyses para listagem admin.

---

## Retenção LGPD

- Analyses expiradas: job mensal deleta `building_insights` raw > 90 dias, mantém métricas agregadas.
- Direito ao esquecimento: cascade delete por `customer_id`.
