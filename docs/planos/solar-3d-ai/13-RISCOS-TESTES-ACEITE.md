# 13 — Riscos, testes e critérios de aceite

---

## 13.1 Matriz de riscos

| ID | Risco | Prob. | Impacto | Mitigação |
|----|-------|-------|---------|-----------|
| R1 | Cobertura BR ruim (BASE/404) | Alta | Alto | Sketch + foto; spike F0 |
| R2 | Custo API explosivo | Média | Alto | Cache, rate limit, wallet |
| R3 | Edifício errado (condomínio) | Média | Alto | Disclaimer + vistoria |
| R4 | Regressão WhatsApp | Média | Crítico | Fase 4 isolada; flags |
| R5 | Bundle JS inchado | Média | Médio | Lazy routes, 2D default mobile |
| R6 | Promessa comercial indevida | Média | Alto | Disclaimers + critico.ts |
| R7 | Key Google vazada | Baixa | Crítico | Server-only, rotação |
| R8 | GeoTIFF lento no server | Alta | Médio | PNG server composição; async job |
| R9 | Conflito com PV\*SOL comercial | Baixa | Baixo | Posicionar complementar |
| R10 | LGPD coordenadas | Baixa | Médio | Retenção + exclusão |

---

## 13.2 Testes por fase

### Fase 0 — Spike

- [ ] 20 endereços documentados
- [ ] Latência média findClosest
- [ ] Custo por análise calculado

### Fase 1 — Experiment

- [ ] Unit: parse mock `buildingInsights`
- [ ] UI: render overlay 14 painéis
- [ ] Sem dependência `src/` produção

### Fase 2 — Backend + Admin

- [ ] EF auth: 401 sem JWT
- [ ] EF auth: 403 customer outro consultor
- [ ] Cache hit segunda chamada
- [ ] `imageryQuality` persistido
- [ ] PNG < 500KB
- [ ] E2E `/admin/solar-design` (flag on)

### Fase 3 — Proposta

- [ ] Proposta Placas com bloco solar
- [ ] Mobile audit proposta (sem overflow)
- [ ] Aceitar proposta ainda cria sale
- [ ] Proposta sem solar inalterada (regression)

### Fase 4 — WhatsApp / IA

- [ ] Skill vendedora 20 conversas — 0 loops novos
- [ ] PNG enviado respeita anti-ban
- [ ] Tool falha gracefully

### Fase 5 — Captação

- [ ] Rate limit IP
- [ ] Lead parcial não quebra cadastro

---

## 13.3 Critérios de aceite (Definition of Done)

### MVP (fim Fase 3)

1. Consultor com flag analisa telhado de lead com endereço completo.
2. Sistema exibe kWp, kWh/ano, economia estimada com disclaimer.
3. Consultor anexa design à proposta `conexao-placas`.
4. Cliente vê preview na proposta pública em mobile.
5. Nenhum teste E2E existente quebrado.
6. Feature flag default **off**.

### Produção piloto (fim Fase 4)

1. 3 consultores usam 2 semanas em produção staging.
2. ≥ 50 análises; ≥ 60% satisfação (survey interno).
3. Tempo médio < 90s.
4. Custo API dentro do orçamento aprovado.
5. Vendedora pode citar análise quando existir.

---

## 13.4 Checklist pré-deploy produção

- [ ] Secrets configurados prod
- [ ] RLS testado
- [ ] Disclaimers revisados
- [ ] Política privacidade atualizada
- [ ] Feature flag off
- [ ] Rollback plan: desligar flag + desativar rotas
- [ ] Monitoramento dashboards
- [ ] Runbook incidente Google API

---

## 13.5 Rollback

1. `consultants.solar_3d_enabled = false` global.
2. Remover botão admin (ou esconder via flag).
3. Propostas existentes com solar continuam visíveis (read-only).
4. EFs podem ficar deployadas — sem callers.

---

## 13.6 Métricas pós-lançamento (90 dias)

| Métrica | Como medir |
|---------|-------------|
| Análises/consultor/mês | `solar_api_usage_log` |
| Propostas Placas com solar % | join proposals |
| Taxa aceite com vs sem solar | A/B |
| Tempo lead → proposta | CRM timestamps |
| Custo API / proposta fechada | financeiro |

---

## 13.7 Estrutura de pastas final (pós Fase 2)

```
src/features/solar-3d/
├── adapters/
│   ├── customerAddress.ts
│   └── proposalSolarBlock.ts
├── components/
│   ├── SolarMap2D.tsx
│   ├── SolarRoofViewer3D.tsx
│   ├── SolarMetricsPanel.tsx
│   ├── SolarPanelSlider.tsx
│   └── SolarSketchFallback.tsx
├── hooks/
│   ├── useSolarAnalysis.ts
│   └── useSolarSnapshots.ts
├── lib/
│   ├── economics.ts
│   ├── geometry.ts
│   └── types.ts
├── pages/
│   ├── SolarDesignPage.tsx
│   └── SolarDesignDetailPage.tsx
└── index.ts

supabase/functions/
├── solar-geocode/
├── solar-roof-analyze/
├── solar-render-preview/
├── solar-design-get/
├── solar-design-public/
└── _shared/solar/

docs/planos/solar-3d-ai/     ← este plano (fonte da verdade)
experiments/solar-3d-ai/     ← spike; pode arquivar após F2
```

**Nenhuma pasta acima existe em produção até aprovação explícita fase por fase.**
