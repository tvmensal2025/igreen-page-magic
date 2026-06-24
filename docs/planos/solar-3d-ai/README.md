# Plano: Solar 3D + IA para Vendas (iGreen)

> **Status:** implementado (Fases 0–5) — aguarda migration + secrets Google + flags consultor  
> **Data:** 24/06/2026  
> **Objetivo:** módulo isolado de levantamento remoto de telhado (mapa 3D, Google Solar API, proposta visual) para **Conexão Placas** e, em fase posterior, **Conexão Solar**, sem misturar com o código em produção.

---

## Regra de ouro

| O que | Onde |
|-------|------|
| Documentação deste plano | `docs/planos/solar-3d-ai/` |
| Código futuro (quando aprovado) | `experiments/solar-3d-ai/` → só depois `src/features/solar-3d/` |
| **Não tocar agora** | `src/`, `supabase/functions/` (exceto quando houver fase explícita de integração) |

Nenhum arquivo deste plano altera rotas, webhooks, vendedora ou orçamento existentes.

---

## Índice dos documentos

| # | Arquivo | Conteúdo |
|---|---------|----------|
| 0 | [00-ESCOPO-E-ISOLAMENTO.md](./00-ESCOPO-E-ISOLAMENTO.md) | Limites, produtos alvo, o que fica fora |
| 1 | [01-AUDITORIA-ESTADO-ATUAL.md](./01-AUDITORIA-ESTADO-ATUAL.md) | O que o portal já tem vs. o que falta |
| 2 | [02-MERCADO-E-REFERENCIAS-2026.md](./02-MERCADO-E-REFERENCIAS-2026.md) | Como concorrentes usam IA + mapa 3D |
| 3 | [03-GOOGLE-SOLAR-API-CONTEXT7.md](./03-GOOGLE-SOLAR-API-CONTEXT7.md) | Endpoints, payloads, cobertura BR (Context7) |
| 4 | [04-ARQUITETURA-TECNICA.md](./04-ARQUITETURA-TECNICA.md) | Camadas, fluxos, diagramas |
| 5 | [05-FRONTEND-3D.md](./05-FRONTEND-3D.md) | UI, React Three Fiber, mapas |
| 6 | [06-BACKEND-EDGE.md](./06-BACKEND-EDGE.md) | Edge Functions, secrets, cache |
| 7 | [07-BANCO-DADOS.md](./07-BANCO-DADOS.md) | Tabelas novas (isoladas) |
| 8 | [08-INTEGRACOES.md](./08-INTEGRACOES.md) | CRM, WhatsApp, vendedora, orçamento |
| 9 | [09-IA-E-AUTOMACAO.md](./09-IA-E-AUTOMACAO.md) | Qualificação, design assistido, objeções |
| 10 | [10-BRASIL-REGULATORIO.md](./10-BRASIL-REGULATORIO.md) | Lei 14.300, tarifas, disclaimers |
| 11 | [11-SEGURANCA-CUSTOS.md](./11-SEGURANCA-CUSTOS.md) | LGPD, API keys, billing Google |
| 12 | [12-FASES-CRONOGRAMA.md](./12-FASES-CRONOGRAMA.md) | MVP → piloto → integração |
| 13 | [13-RISCOS-TESTES-ACEITE.md](./13-RISCOS-TESTES-ACEITE.md) | Riscos, testes, critérios de done |

---

## Resumo executivo (1 parágrafo)

Construir um **módulo sandbox** que, a partir do endereço/CEP já capturado no CRM, consulta a **Google Solar API** (`buildingInsights:findClosest` + `dataLayers:get`), gera um **preview 3D** com painéis no telhado, dimensiona kWp/kWh e alimenta uma **proposta enriquecida** para `conexao-placas` — integrando depois com WhatsApp/vendedora e o builder de orçamento existente, **sem refatorar** fluxos atuais até validação em piloto.

---

## Próximo passo (quando você aprovar)

1. Validar orçamento Google Cloud (Solar API + Geocoding + billing).  
2. Spike técnico em `experiments/solar-3d-ai/` com 3 endereços BR reais.  
3. Decidir: só consultor no admin ou também embed na landing/captação.
