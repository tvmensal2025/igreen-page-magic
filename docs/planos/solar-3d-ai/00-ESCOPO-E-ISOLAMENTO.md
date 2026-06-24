# 00 — Escopo e isolamento

## Objetivo de negócio

Replicar (com adaptação iGreen) o que vendedores de painel solar usam em 2026:

1. Ver a **casa em 3D / vista aérea** com telhado analisado.
2. **Dimensionar** sistema (kWp, módulos, geração anual) sem visita inicial.
3. **Mostrar painéis no telhado** na proposta (efeito “uau” que fecha venda).
4. Usar **IA** para qualificar, explicar e fazer follow-up — integrando com o que já existe.

## Produtos iGreen no escopo

| Produto | Slug | Prioridade | Motivo |
|---------|------|------------|--------|
| Conexão Placas | `conexao-placas` | **P0** | Venda de sistema no telhado do cliente — encaixa 100% com mapa 3D |
| Conexão Solar | `conexao-solar` | P2 | Energia em fazenda (sem placa no imóvel) — mapa 3D é secundário; só economia estimada |
| Conexão Green / Livre | `conexao-green`, `conexao-livre` | Fora | Não envolve telhado |

## O que entra no módulo

- Geocodificação de endereço → coordenadas.
- Chamada Google Solar API (server-side).
- Cache de análises por imóvel.
- Visualizador 3D/2.5D do telhado + overlay de painéis.
- Cálculo comercial: kWp, geração, economia vs. `electricity_bill_value`.
- Export para proposta (`proposals.line_items` + anexo visual).
- Hooks de integração (opcionais por fase) com WhatsApp e vendedora.

## O que fica explicitamente fora (v1)

- Substituir PV\*SOL / homologação técnica final.
- Drone próprio ou LiDAR proprietário.
- Permissão de obra / ART automática.
- Financiamento automático com bancos (só exibir cenários já manuais).
- Alterar `evolution-webhook` / `whapi-webhook` na Fase 0–1.

## Estratégia de isolamento

```
┌─────────────────────────────────────────────────────────┐
│  PRODUÇÃO ATUAL (intocada nas fases 0–1)                │
│  src/, supabase/functions/evolution-webhook, etc.       │
└─────────────────────────────────────────────────────────┘
                          │
              adapters finos (Fase 3+)
                          │
┌─────────────────────────────────────────────────────────┐
│  MÓDULO NOVO                                            │
│  experiments/solar-3d-ai/  →  src/features/solar-3d/  │
│  supabase/functions/solar-*  (novas functions)          │
│  tabelas solar_roof_analyses, solar_design_snapshots    │
└─────────────────────────────────────────────────────────┘
```

### Princípios

1. **API key Google nunca no browser** — só Edge Function com secret.
2. **Novas tabelas**, não colunas em `customers` na Fase 1 (evita migration arriscada).
3. **Feature flag** `solar_3d_enabled` por consultor antes de expor no admin.
4. **Rotas novas** sob `/admin/solar-design` e `/experiments/solar-3d` — não alterar rotas existentes.
5. **Proposta atual** continua funcionando; campo JSON opcional `solar_design_id` só na Fase 3.

## Personas

| Persona | Uso |
|---------|-----|
| Consultor no admin | Abre lead → “Analisar telhado” → gera preview → anexa à proposta Placas |
| Cliente (link público) | Vê proposta com render do telhado + economia |
| Vendedora IA (futuro) | Envia link de preview ou imagem estática quando lead pergunta “meu telhado serve?” |
| Super admin | Liga/desliga módulo, vê custos API, cobertura BR |

## Definição de sucesso (piloto)

- 3 consultores, 30 análises reais em SP/RJ/MG.
- Tempo médio endereço → preview **< 90s** (p95 < 3 min).
- ≥ 70% dos endereços urbanos retornam `imageryQuality` ≥ MEDIUM.
- Nenhuma regressão em fluxo WhatsApp/orçamento (testes E2E existentes verdes).
