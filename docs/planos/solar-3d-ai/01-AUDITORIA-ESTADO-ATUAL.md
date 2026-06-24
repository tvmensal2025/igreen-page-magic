# 01 — Auditoria do estado atual (iGreen Portal)

## Stack existente relevante

| Camada | Tecnologia | Notas |
|--------|------------|-------|
| Frontend | React 18 + Vite + Tailwind + shadcn/ui | PWA, lazy routes |
| Backend | Supabase Edge Functions (Deno) | 120+ functions |
| IA | Gemini via `_shared/vendedora/`, `fluxo-b-ai` | Vendedora conversacional |
| WhatsApp | Evolution API + Whapi | Webhooks pesados — não misturar cedo |
| Propostas | `proposals` + `proposal-public-get` | Link `/proposta/:token` |
| Orçamento | `src/features/produtos/orcamento/` | `conexao-placas` = `project_once` |
| Endereço lead | `customers.*` | CEP, rua, cidade, UF — **sem lat/lng** |

## O que já existe (aproveitável)

### Captação de endereço

Fluxo documentado em `docs/auditoria/05-fluxos-do-sistema.md`:

- CEP, valor conta, CPF, WhatsApp, endereço completo, distribuidora.
- ViaCEP no bot (`buscarEnderecoPorCep`, `buscarCepPorEndereco`).
- Campos: `address_street`, `address_number`, `address_city`, `address_state`, `cep`, `electricity_bill_value`, `distribuidora`.

**Gap:** não há `latitude` / `longitude` persistidos → geocoding será etapa nova.

### Módulo de orçamento / proposta

- `QUOTABLE_PRODUCT_SLUGS` inclui `conexao-placas` e `conexao-solar`.
- Placas: `pricingMode: "project_once"`, financiamento até 120x, visita técnica pós-aceite.
- `ProposalPublicPage`: landing do produto + modal glass com proposta.
- `line_items` JSONB — pode carregar bloco visual solar sem migration.

### Vendedora / WhatsApp

- Qualificação por valor de conta (≥ R$ 100).
- Pedido de foto/PDF da conta (OCR).
- **Não** menciona telhado 3D nem viabilidade estrutural hoje.
- CRM: `sales_phase`, `qualification_score`, funil em `useSalesFunnel`.

### Conteúdo comercial solar

- Landing `conexao-placas` / `conexao-solar` em `conexaoProducts.ts`.
- Academy: trilha “Conexão Placas” (proposta, vistoria) — processo manual.
- `LicConexaoSolar.tsx`: página institucional simples (sem ferramenta).

## O que não existe (lacunas)

| Lacuna | Impacto |
|--------|---------|
| Integração Google Maps / Solar API | Núcleo do plano |
| Viewer 3D no frontend | Experiência visual |
| Dimensionamento automático kWp | Consultor faz manual / externo |
| Vínculo análise telhado ↔ proposta | Proposta é só valor + texto |
| Cache de análises solares | Custo API repetido |
| Cobertura fallback (imagem ruim) | Endereços sem 3D ficam sem ferramenta |
| Registro de qualidade da análise | Risco vender em telhado inviável |

## Arquivos sensíveis — não alterar nas fases iniciais

| Arquivo | Motivo |
|---------|--------|
| `supabase/functions/evolution-webhook/` | Orquestrador bot |
| `supabase/functions/_shared/vendedora/` | State machine vendedora |
| `src/features/produtos/orcamento/catalog.ts` | Só leitura até Fase 3 |
| `src/integrations/supabase/types.ts` | Auto-gerado |

## Pontos de integração futuros (mapeados, não implementados)

```
customers (id, endereço, electricity_bill_value)
    ↓
solar_roof_analyses (nova) ← Google Solar API
    ↓
solar_design_snapshots (nova) ← layout painéis + PNG/WebGL export
    ↓
proposals.line_items[] ← bloco "Seu telhado" + kWp
    ↓
sales (família placas) ← ao aceitar proposta (já existe)
```

## Dependências de pacote atuais

- **Não** há `three`, `@react-three/fiber`, `@react-google-maps/api` no `package.json` principal.
- Adicionar só em `experiments/solar-3d-ai/` na Fase 1; promover ao root na Fase 2 com code-splitting agressivo.

## Conclusão da auditoria

O portal tem **funil, endereço, conta de luz, proposta e WhatsApp** — falta apenas a **camada de inteligência espacial do telhado**. O plano encaixa como feature vertical nova, não como refactor do bot.
