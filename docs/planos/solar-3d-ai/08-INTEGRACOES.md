# 08 — Integrações com sistema existente

Como conectar o módulo solar **sem quebrar** CRM, WhatsApp, orçamento e vendedora.

---

## 8.1 CRM / Customers

### Dados já disponíveis

| Campo `customers` | Uso solar |
|-------------------|-----------|
| `address_street`, `number`, `neighborhood`, `city`, `state`, `cep` | Geocoding |
| `electricity_bill_value` | Cálculo economia |
| `distribuidora` | Tarifa v2 |
| `electricity_bill_photo_url` | OCR cruzado (consumo kWh) v2 |
| `phone_whatsapp` | Enviar preview |
| `sales_phase` | Mover para `fechamento` após preview enviado |

### Adapter `CustomerAddressAdapter`

```typescript
function formatCustomerAddress(c: Customer): string {
  return [c.address_street, c.address_number, c.address_neighborhood,
          c.address_city, c.address_state, c.cep].filter(Boolean).join(", ");
}
```

### UI no admin existente

**Fase 3 — ponto único de entrada:**

- `WhatsAppDashboard` / painel cliente: botão **"Analisar telhado"** → `/admin/solar-design?customerId=`
- `VendasEmAndamentoPanel` para `conexao-placas`: badge "Sem análise" / "Analisado"

**Não alterar** layout mobile auditado sem teste E2E.

---

## 8.2 Módulo Orçamento (`src/features/produtos/orcamento/`)

### Produto alvo: `conexao-placas`

`pricingMode: "project_once"` — consultor informa `projectAmountCents`.

### Integração Fase 3

1. `OrcamentoBuilderSheet` — novo passo opcional **"Design solar"** se produto = placas.
2. Botão "Importar análise" lista `solar_design_snapshots` do customer.
3. Preenche:
   - `projectAmountCents` (sugestão tabela R$/kWp — configurável)
   - `line_items` extras:

```typescript
{
  label: "Sistema fotovoltaico",
  value: "5,6 kWp · 14 módulos · ~7200 kWh/ano",
  kind: "solar_design",
  snapshotId: "...",
}
```

4. `ProposalPublicPage` — detectar `kind === "solar_design"` → render `SolarProposalSection`.

### O que não mudar

- Fluxo aceitar/recusar/contrapropor.
- `proposal-public-get` contract backward compatible (campos novos opcionais).

---

## 8.3 Proposta pública

Arquivo: `src/pages/ProposalPublicPage.tsx`

### Nova seção (Fase 3)

- Hero mini: imagem telhado com painéis.
- Bullets: kWp, economia, garantias (do `catalog.ts` placas).
- Disclaimer legal (doc 10).
- Toggle comparar 2 snapshots se houver.

### API

Estender `proposal-public-get` para join `solar_design_snapshots` quando `solar_snapshot_id` presente.

---

## 8.4 WhatsApp / Bot

### Fase 4 — integração gradual

**Opção A (recomendada):** mensagem template manual do consultor

- Consultor gera PNG → envia pelo `MessageComposer` existente.
- Zero mudança no webhook.

**Opção B:** step novo no bot **somente** para consultores com flag

- Step `oferta_solar_preview` após qualificação Placas.
- Chama `solar-roof-analyze` se endereço completo.
- Envia imagem + texto métricas.

**Opção C:** tool na vendedora conversacional

```typescript
// _shared/vendedora/tools/analyze-roof.ts
{ name: "analyze_roof", parameters: { customerId } }
```

Vendedora responde: "Analisei seu telhado: cabem 14 placas..."

### Cuidados anti-ban

- Não enviar link pesado 3D — só PNG < 500KB.
- Respeitar `checkSendQuota`, quiet hours.
- Não disparar análise Google em **toda** mensagem (custo).

---

## 8.5 Vendedora / Fluxo B

Arquivos sensíveis:

- `supabase/functions/_shared/vendedora/orchestrator.ts`
- `supabase/functions/fluxo-b-ai/`

### Integração mínima (Fase 4)

1. Adicionar contexto opcional no prompt:

```
roof_analysis_summary: "14 módulos, 5.6kWp, economia ~R$380/mês (estimativa)"
```

2. Só injetar se `solar_design_snapshots` existir para o customer.

3. Skill de teste: rodar `.agents/skills/vendedora-e2e-conversations` antes/depois.

---

## 8.6 Captação pública (`ConsultantPage`)

### Fase 5 (opcional)

Embed calculadora após step endereço:

- "Veja seu telhado" — lead magnet.
- Salva `solar_roof_analyses` com `customer_id` parcial.
- **Cuidado:** custo API por lead frio — limitar 1 análise por IP/dia.

---

## 8.7 Academy / treinamento

Atualizar trilha Placas (conteúdo, não código):

- Módulo "Ferramenta de análise remota" — vídeo curto.
- Não bloquear implementação técnica.

---

## 8.8 Matriz de touchpoints

| Sistema | Fase | Tipo mudança | Risco |
|---------|------|--------------|-------|
| customers | 1 | Leitura | Baixo |
| solar_* tables | 2 | Novo | Baixo |
| Admin route | 2 | Novo | Baixo |
| orcamento | 3 | Extensão | Médio |
| proposal-public-get | 3 | Extensão | Médio |
| evolution-webhook | 4 | Extensão | **Alto** |
| vendedora | 4 | Extensão | **Alto** |
| ConsultantPage | 5 | Novo embed | Médio |

**Regra:** fases 4+ exigem feature flag + testes E2E WhatsApp.
