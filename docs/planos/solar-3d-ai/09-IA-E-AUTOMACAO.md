# 09 — IA e automação

Como a IA entra em cada etapa — alinhado ao que o mercado faz em 2026 e ao que o iGreen já tem.

---

## 9.1 Mapa IA por etapa

| Etapa | IA hoje iGreen | IA com módulo solar |
|-------|----------------|-------------------|
| Captação | Bot steps, OCR conta | + preview telhado embed (Fase 5) |
| Qualificação | Valor conta, score | + viabilidade telhado (HIGH/MEDIUM) |
| Apresentação | Vendedora texto | + imagem telhado personalizada |
| Objeções | RAG + templates | + dados kWp/economia reais |
| Proposta | Manual builder | + auto-fill Placas |
| Follow-up | ai-followup-cron | + "viu preview?" |
| Fechamento | Humano | Humano + visita técnica |

---

## 9.2 Design assistido (não é LLM)

**Automático via Google Solar API:**

- Segmentação telhado
- Posição painéis
- Shading / kWh

**Heurísticas iGreen (código determinístico):**

```typescript
function pickPresets(configs, monthlyBillKwh) {
  const ideal = configs.find(c => c.yearlyEnergyDcKwh >= monthlyBillKwh * 12 * 0.95);
  const eco = configs.find(c => c.yearlyEnergyDcKwh >= monthlyBillKwh * 12 * 0.7);
  return { ideal, eco };
}
```

---

## 9.3 LLM — casos de uso

### A) Resumo comercial (Gemini)

Input: JSON métricas + perfil lead.  
Output: parágrafo WhatsApp-friendly (máx 400 chars).

```
"Maria, seu telhado comporta 14 placas (5,6 kWp), gerando cerca de 7.200 kWh/ano.
Isso representa uma economia estimada de R$ 380/mês na conta. A instalação é sob medida
e a visita técnica confirma tudo antes de fechar."
```

**Onde:** `solar-roof-analyze` pós-processamento opcional (`generateSalesBlurb`).

### B) Tool vendedora `analyze_roof`

Fase 4 — function calling:

1. Vendedora detecta intenção Placas + endereço disponível.
2. Chama edge function.
3. Injeta resultado na resposta.
4. Se API falhar → fallback script humano existente.

### C) Coaching objeções (futuro)

Real-time coaching (como Appendment SalesPilot) — **fora escopo**; documentar roadmap.

---

## 9.4 Lead scoring enriquecido

Estender `qualification_score` (ou campo paralelo `solar_fit_score`):

| Fator | Peso |
|-------|------|
| `electricity_bill_value` ≥ 250 | +30 |
| `imageryQuality` HIGH | +25 |
| `max_panels` ≥ 8 | +20 |
| `imageryQuality` BASE | -15 |
| API not_found | -40 |

**Não escrever em `customers` na Fase 1** — calcular on read ou view materializada Fase 3.

---

## 9.5 OCR conta × dimensionamento (v2)

Cruzamento:

- OCR extrai kWh consumo (`media_consumo` já existe em customers).
- Comparar com `yearlyEnergyKwh` do design.
- Alerta consultor se sistema < 80% consumo.

---

## 9.6 Guardrails LLM (obrigatório)

| Regra | Implementação |
|-------|---------------|
| Não prometer % fixo sem disclaimer | Template pós-LLM |
| Não citar incentivo fiscal sem fonte | Blocklist + RAG oficial |
| Não dizer "aprovado" sem vistoria | Frase obrigatória |
| Não inventar kWp | Números só do JSON API |

Reutilizar padrão `_shared/cerebro/comum/critico.ts` para validar blurb.

---

## 9.7 Automação de follow-up

Se proposta com solar enviada e não aberta em 48h:

- `ai-followup-cron` inclui: "Conseguiu ver como ficam as placas no seu telhado?"
- Só se `solar_snapshot_id` presente.

---

## 9.8 Testes IA

| Teste | Método |
|-------|--------|
| Skill vendedora 20 conversas | dryRun fluxo-b-ai |
| Blurb não alucina números | unit: regex kWp do JSON |
| Tool analyze_roof | integration mock |

---

## 9.9 O que NÃO usar IA (v1)

- Detecção geometria telhado (Google já faz)
- Cálculo elétrico stringing
- Homologação ANEEL
- Precificação dinâmica por concorrente
