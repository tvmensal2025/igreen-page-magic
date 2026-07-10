## Objetivo

Transformar o botão **"Encerrar captação"** em uma decisão real de **Ganho / Perdido**, com atribuição correta de **origem** (campanha ou parceiro) e cálculo automático de **comissão** conforme regras financeiras. Hoje ele sempre grava `status='fechado'` — não distingue ganho de perdido e não gera comissão de acordo com a origem real.

---

## Fluxo novo do botão

Ao clicar em **"Encerrar captação"** abre um modal com 2 caminhos:

### 1) 🏆 Ganho (virou cliente)
- **Produto** (default: primeiro ativo — Energia)
- **kWh / valor da conta** (pré-preenchido com `media_consumo` / `electricity_bill_value`)
- **Origem do fechamento** (rádio):
  - `Campanha Meta` → dropdown com `facebook_campaigns` ativas + a que o lead já veio (`source_campaign_id` selecionada por padrão se existir)
  - `Parceiro / indicação` → dropdown com `referral_partners` ativos (selecionado por padrão o `referral_partner_id` atual, se houver)
  - `Orgânico / próprio` → sem origem externa
- **Observações** (opcional)
- Preview: "Comissão estimada: R$ X,XX (regra Y aplicada)"

### 2) ❌ Perdido
- **Motivo** (select): sem interesse · não qualificado · número inválido · sumiu · concorrente · outro
- **Observação livre**
- Sem produto, sem comissão

Em ambos os casos: chat WhatsApp continua vivo; lead sai da lista de captação.

---

## Backend — `close-capture-and-register-sale` (revisão)

Aceita novos campos:
```ts
{
  customerId, consultantId,
  outcome: 'won' | 'lost',
  // won:
  productId?, amountCents?, pointsKwh?,
  attribution?: { kind: 'campaign'|'partner'|'organic', id?: string },
  // lost:
  lostReason?: string,
  notes?
}
```

Comportamento:
- **won** → mantém lógica atual (upsert `sales` com `status='fechado'`), + grava `sales.source_kind` e `sales.source_id` (campanha ou parceiro); atualiza `customers.source_campaign_id` / `referral_partner_id` se o usuário mudou a origem; CRM deal → `stage='ganho'`.
- **lost** → `sales` com `status='perdido'` + `lost_reason`; CRM deal → `stage='perdido'`; **não** gera comissão.
- **Comissão (won)**: consulta `consultant_commission_settings` do consultor + regra da origem:
  - Se `attribution.kind='partner'` → aplica `referral_partners.commission_pct` (split parceiro/consultor conforme o registro).
  - Se `campaign` ou `organic` → percentual cheio do consultor.
  - Cria linha em `wallet_transactions` (tipo `commission_pending`) vinculada ao `sale_id` — igual às vendas normais já geram hoje.
- Idempotência: se já fechado, retorna estado atual.

Migração:
- Adicionar colunas em `sales`: `outcome text ('won'|'lost')`, `source_kind text`, `source_id uuid`, `lost_reason text` (se ainda não existirem — vou checar antes).
- Backfill: linhas antigas com `status='fechado'` → `outcome='won'`; nenhum backfill de comissão retroativa.

---

## Frontend

- Novo componente `CloseCaptureDialog.tsx` (substitui o `AlertDialog` simples atual em `CloseCaptureButton.tsx` e no header do `ChatView.tsx`).
- Reaproveita o mesmo componente nos dois pontos (ficha da captação + header do chat).
- Mostra selo diferente após encerrar: verde "Ganho em DD/MM" ou cinza "Perdido em DD/MM · motivo".
- Lista de captação: leads perdidos também somem da fila (mesma coluna `capture_closed_at`), mas ganham filtro futuro "ver encerrados" (fora deste escopo).

---

## Fora do escopo

- Tela de listagem "encerrados" separada em Captação.
- Edição pós-encerramento (usuário refaz via CRM/Vendas se precisar corrigir).
- Split multi-parceiro (usa a regra única atual de `referral_partners`).

---

## Detalhes técnicos

Antes de gerar a migração, vou confirmar via `supabase--read_query` quais colunas já existem em `sales` (o schema mostra 14 colunas, preciso ver quais) e a estrutura real de `consultant_commission_settings` + `referral_partners.commission_pct` pra usar os nomes exatos. Se alguma coluna já existir com nome diferente (ex.: `status='perdido'` já cobrindo), reuso ao invés de criar duplicata.
