# 02 — Mercado e referências 2026

Como integradores e SaaS de solar usam IA + mapa 3D para vender mais — cada ponto mapeado para decisão iGreen.

---

## 1. Camada de dados geoespaciais

### Google Solar API (padrão de mercado)

- 472M+ edifícios, 40+ países.
- Parceiros: OpenSolar, Aurora, Sunrun, DemandIQ.
- Entrega: medidas, sombreamento, sugestão de painéis, potencial kWh.

**Lição iGreen:** usar como **fonte primária** no Brasil urbano; não construir modelo próprio de telhado.

### EagleView + Nearmap (EUA, premium)

- Imagens sub-1 polegada, modelos 3D proprietários.
- Aurora AI: modelo em < 15s, LiDAR, 1,6M+ execuções.

**Lição iGreen:** inacessível/caro para v1 BR; reservar para parceria futura se volume justificar.

### Foto do celular + perspectiva (EasySolar)

- Cliente ou vendedor tira foto; IA ajusta perspectiva dos painéis.

**Lição iGreen:** **fallback obrigatório** quando `imageryQuality === BASE` ou API retorna 404.

---

## 2. Design automático (meio do funil)

| Ferramenta | Tempo design | Diferencial |
|------------|--------------|-------------|
| OpenSolar Ada | Segundos | Grátis instaladores, NREL-validated shading |
| Aerialytic | < 60s | Embed white-label no site |
| Aurora AutoDesigner | Minutos | Regras fogo, stringing, AHJ 25k+ |

**Fluxo típico:**

1. Endereço + conta de luz  
2. Modelo 3D automático  
3. 2–3 tamanhos de sistema  
4. Proposta interativa (link vivo)

**Lição iGreen:** Fase 2 deve gerar **2 presets** (econômico / ideal) a partir de `solarPanelConfigs` da API.

---

## 3. Proposta interativa (fechamento)

Tendência 2026 (SurgePV, Sunbase):

- Link, não PDF.
- Cliente alterna painéis / financiamento.
- Vendedor edita na call; página atualiza.
- Tracking: abriu, tempo, seção.

**iGreen já tem:** `ProposalPublicPage` + eventos `viewed` / `accepted`.  
**Falta:** seção 3D + comparador de kWp na proposta Placas.

---

## 4. IA no topo do funil

| Função | Exemplos mercado | Métricas citadas |
|--------|------------------|------------------|
| Chat 24/7 | SolarBud, Solar Assist | +78% conversão resposta imediata |
| Voice AI | One Solar | Qualificação por voz |
| Lead scoring | ML em CRM | +15–25% produtividade |
| Calculadora embed | EasySolar | Lead com dados de telhado |

**iGreen já tem:** vendedora Gemini + bot step-based.  
**Integração planejada (Fase 4):** tool `analyze_roof(address)` na vendedora.

---

## 5. Objeções tratadas por IA

| Objeção | Resposta esperada |
|---------|-------------------|
| “Meu telhado serve?” | Dados do imóvel + link preview |
| “Quanto economizo?” | kWh × tarifa local × % compensação |
| “É caro?” | Payback, financiamento 120x |
| “Preciso pensar” | Follow-up + link proposta |

**iGreen:** objeções parciais em `fluxo-b-ai` / vendedora — enriquecer com **dados reais do telhado**, não texto genérico.

---

## 6. Pós-venda (fora do MVP)

- Manutenção preditiva, detecção anomalias, plan sets automáticos.

**iGreen:** não escopo v1; documentar para roadmap 2027.

---

## 7. Brasil específico

| Player | Foco BR |
|--------|---------|
| SurgePV | ANEEL, R$, proposta PT |
| EasySolar | Forte LATAM, SCEE Lei 14.300 |
| PV\*SOL | Homologação técnica, Google Solar |
| Suns Brasil | Dimensionamento rápido gratuito |

**iGreen deve:**

- Manter **homologação manual** (visita técnica pós-aceite já no copy de Placas).
- Traduzir disclaimers: “estimativa comercial, sujeita a vistoria”.
- Tarifas por `distribuidora` já capturada no lead.

---

## 8. Benchmark de KPIs (mercado → meta piloto iGreen)

| KPI | Mercado 2026 | Meta piloto |
|-----|--------------|-------------|
| Tempo cotação | 10 min – 2 dias → 10 min | < 90s até preview |
| Propostas/dia/vendedor | 10–15 com automação | +30% vs. manual |
| Taxa fechamento | +15–25% com automação | Medir A/B 60 dias |
| Custo survey | 1/5 visita física (One Solar) | R$ API << visita |

---

## 9. Matriz “copiar vs. construir vs. integrar”

| Capacidade | Decisão iGreen |
|------------|----------------|
| Modelo 3D telhado | **Integrar** Google Solar API |
| Render WebGL | **Construir** viewer fino (R3F) |
| CRM / WhatsApp | **Integrar** existente |
| Proposta pública | **Estender** `line_items` + seção UI |
| IA conversação | **Estender** vendedora (tool call) |
| CAD / stringing elétrico | **Fora** v1 |
| Financiamento | **Manter** manual no builder |
