# 12 — Fases e cronograma

Estimativa para equipe 1–2 devs — **não implementado**.

---

## Fase 0 — Spike e validação (1–2 semanas)

**Entregável:** relatório em `experiments/solar-3d-ai/SPIKE-REPORT.md`

| Task | Done quando |
|------|-------------|
| Conta GCP + billing + APIs habilitadas | Keys funcionando |
| Script CLI geocode + findClosest | 20 endereços BR testados |
| Planilha qualidade por cidade | % HIGH/MEDIUM/BASE |
| Estimativa custo/análise | R$ e USD documentados |
| Go/no-go | Aprovação stakeholders |

**Zero mudança em produção.**

---

## Fase 1 — Sandbox técnico (2–3 semanas)

**Pasta:** `experiments/solar-3d-ai/`

| Task | Done quando |
|------|-------------|
| Mock fixtures Solar API | JSON reutilizável |
| UI modo 2D overlay | 3 endereços mock |
| Chamada real via proxy local | 1 endereço real |
| README experimento | Documentado |

**Critério:** demo gravada em vídeo 2 min.

---

## Fase 2 — Backend + admin isolado (3–4 semanas)

| Task | Done quando |
|------|-------------|
| Migrations `solar_*` | Aplicadas staging |
| EFs `solar-geocode`, `solar-roof-analyze` | Deploy staging |
| Cache + usage log | Funcionando |
| `src/features/solar-3d/` | Rota `/admin/solar-design` |
| Feature flag consultor | 3 pilotos |
| Modo 2D + PNG export | WhatsApp manual |

**Critério:** consultor piloto gera análise real em < 90s.

---

## Fase 3 — Orçamento e proposta (2–3 semanas)

| Task | Done quando |
|------|-------------|
| Adapter OrcamentoBuilder | Import snapshot |
| `proposal-public-get` estendido | Bloco solar |
| `ProposalPublicPage` seção solar | Mobile ok |
| `solar_snapshot_id` ou line_items meta | Persistência |
| E2E proposta com solar | Playwright verde |

**Critério:** cliente abre link e vê telhado com painéis.

---

## Fase 4 — WhatsApp e vendedora (2–3 semanas)

| Task | Done quando |
|------|-------------|
| Envio PNG pelo composer | Sem mudar webhook |
| Tool `analyze_roof` vendedora | Feature flag |
| Teste skill 20 conversas | Sem regressão |
| Opcional: step bot Placas | Flag separada |

**Critério:** 1 conversa e2e "meu telhado serve?" com dados reais.

---

## Fase 5 — Captação embed (opcional, 2 semanas)

| Task | Done quando |
|------|-------------|
| Widget pós-endereço ConsultantPage | Flag global off |
| Rate limit IP | Abuse ok |
| Lead com solar_preview | CRM |

---

## Fase 6 — 3D WebGL + refinamentos (contínuo)

| Task | Done quando |
|------|-------------|
| R3F viewer desktop | Lighthouse ok |
| Sketch fallback | BASE quality |
| Tarifas por distribuidora v2 | 5 concessionárias |
| OCR × kWh cruzamento | Alertas |

---

## Timeline visual

```
Semana:  1-2    3-5      6-9       10-12     13-15    16+
         [F0]   [F1]     [F2]      [F3]      [F4]     [F5/F6]
Produção: intacta ─────────────────────────────────────────────►
         só docs + experiments até F2 merge admin
```

---

## Critério de merge em `main`

| Fase | Requisito |
|------|-----------|
| F2 | PR isolado; feature flag off default |
| F3 | Review produto + jurídico disclaimers |
| F4 | Review WhatsApp + testes anti-ban |
| F5 | Aprovação custo API por lead |

---

## Equipe sugerida

| Papel | Responsabilidade |
|-------|------------------|
| Dev fullstack | EF + UI |
| Dev frontend | R3F, proposta |
| Produto/comercial | Copy, preços kWp |
| Jurídico/compliance | Disclaimers LGPD |
| Piloto consultores | Feedback 30 análises |
