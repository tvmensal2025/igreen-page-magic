# 13 — Solar 3D e propostas

**Data:** 2026-07-16  
**Escopo:** módulo `src/features/solar-3d`, EFs `solar-*`, rate limits, exposição pública  
**Docs de plano (já existentes):** `docs/planos/solar-3d-ai/` (não substituem esta auditoria de código).

---

## 1. Superfície

### Edge Functions (`verify_jwt=false` no config para as públicas)

| EF | Público? | Controles |
|---|---|---|
| `solar-roof-public` | Sim | Flag consultor `solar_3d_enabled` / `solar_public_widget_enabled` + rate limit IP (3/dia) |
| `solar-roof-image` | Sim | Rate limit IP |
| `solar-roof-hd` | Sim | Rate limit + flags |
| `solar-design-public` | Sim | `public_token` **ou** `snapshotId` cru |
| `solar-roof-context` | Sim | contexto |
| `solar-geocode` | ? | geocode |
| `solar-roof-analyze` | Auth consultor (esperado) | rate consultor 50/dia |
| `solar-design-get` | jwt=false | get design |
| `solar-hd-probe` | **Diagnóstico** | **sem rate limit / sem auth** — comentário “Remover após validação” |

Shared: `_shared/solar/*` (Google Solar API, economics BR, rate-limit, imagery).

### Frontend

`src/features/solar-3d/` — viewers 3D/2D, widget captação, bloco proposta, testes Vitest economics/proposal.

### Banco

`solar_roof_analyses`, `solar_design_snapshots`, `solar_public_rate_limit`, `solar_api_usage_log`, flags em `consultants`, `proposals.public_token` / `solar_snapshot_id`.

---

## 2. Achados

### AUD-011 — `solar-design-public` aceita `snapshotId` sem token

**Prioridade:** P1  
**Situação:** Confirmado  

```ts
// solar-design-public/index.ts
const token = String(body.token ?? "");
const snapshotId = String(body.snapshotId ?? "");
if (!token && !snapshotId) return json({ error: "..." }, 400);
// se snapshotId → select direto em solar_design_snapshots
```

Quem adivinhar/ vazar UUID do snapshot obtém métricas, posições de painéis, blurb, endereço parcial e `consultantId`.

**Correção:** exigir `public_token` (ou assinatura HMAC); `snapshotId` só com ownership JWT.

### AUD-012 — `solar-hd-probe` diagnóstico público sem rate limit

**Prioridade:** P1  
**Situação:** Confirmado  

Comentário no arquivo: “DIAGNÓSTICO TEMPORÁRIO… Remover após validação.”  
`verify_jwt=false`; chama Google Data Layers / GeoTIFF — risco de **custo** e abuso.

**Correção:** remover do deploy público, ou exigir service secret + rate limit.

### Positivos

- Rate limit público persistente (`solar_public_rate_limit`) — 3/dia/IP.
- Rate consultor via `solar_api_usage_log`.
- Feature flags por consultor antes de analisar.
- Disclaimer regulatório no shared types.

---

## 3. Propostas

Integração via `adapters/proposalSolarBlock.ts` + `proposals.public_token`.  
Fluxo feliz: token público → snapshot ligado à proposta (OK).  
Caminho `snapshotId` é o atalho problemático (AUD-011).
