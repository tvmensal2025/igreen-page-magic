## Objetivo

Permitir, dentro do card de cada campanha em **Central de Anúncios → Campanhas**, estender o prazo (adicionar mais dias) e alterar o valor do orçamento diário — sem precisar criar nova campanha. Hoje, quando vence (`end_time` no Meta), a campanha pausa e não há como retomar pelo painel.

## Como vai funcionar (visão do usuário)

No card da campanha (`CampaignsList.tsx`), ao lado dos botões de pausar/apagar, aparece um botão **"Estender / Editar"** (ícone calendário). Para campanhas pausadas por vencimento, o card mostra também um aviso amarelo: *"Campanha encerrou em DD/MM. Adicione dias para continuar rodando."* com CTA direto para o mesmo diálogo.

O diálogo abre com 2 campos:

1. **Adicionar dias** — slider/input (1–60 dias). Mostra preview: *"Nova data fim: 15/06/2026"*.
2. **Novo orçamento diário (R$)** — input com valor atual pré-preenchido. Mostra preview: *"Gasto estimado no período: R$ X"* (dias × valor).

Botão **"Aplicar e reativar"**:
- Atualiza o `end_time` e `daily_budget` no Meta (adset).
- Se a campanha estiver `paused` por vencimento, reativa (`ACTIVE`).
- Atualiza `duration_days`, `daily_budget_cents`, `ended_at` e `status` no banco.
- Toast de sucesso e refresh da lista.

## Implementação técnica

**Nova edge function** `facebook-extend-campaign` (`supabase/functions/facebook-extend-campaign/index.ts`):

- Input: `{ campaign_id, add_days?: number, new_daily_budget_cents?: number, reactivate?: boolean }`.
- Carrega campanha, valida ownership (consultor dono ou super admin).
- Para cada `fb_adset_id` em `fb_adset_ids`:
  - `POST /{adset_id}` com `end_time` recalculado (atual `ended_at` ou `now` + `add_days`) e/ou `daily_budget` (em centavos como o Meta exige).
  - Se `reactivate=true`, `POST /{adset_id}` com `status=ACTIVE` e `POST /{campaign_id}` com `status=ACTIVE`.
- Atualiza `facebook_campaigns`: `duration_days += add_days`, `daily_budget_cents`, `ended_at`, `status='active'`, limpa `rejection_reason` se aplicável.
- Usa o mesmo padrão de token da `facebook-toggle-campaign` (token da plataforma).

**Frontend**:

- Novo componente `src/components/admin/ads/ExtendCampaignDialog.tsx` (Dialog do shadcn com os 2 campos + preview).
- Em `CampaignsList.tsx`:
  - Adicionar estado `extending: Campaign | null`.
  - Botão calendário no grupo de ações do card (entre toggle e delete).
  - Banner amarelo "Campanha encerrou" quando `c.status === 'paused'` e `ended_at < now()` (precisa adicionar `ended_at` ao SELECT atual).
  - Após sucesso, atualizar o item localmente (status, daily_budget_cents) e disparar refresh.

## O que NÃO muda

- `CreateCampaignWizard`, lógica de criação, métricas, comissões — intactos.
- Outros status (`rejected`, `pending_review`) continuam tratados pelos fluxos existentes (reativar / reconectar Facebook).

## Arquivos afetados

- `supabase/functions/facebook-extend-campaign/index.ts` (novo)
- `src/components/admin/ads/ExtendCampaignDialog.tsx` (novo)
- `src/components/admin/ads/CampaignsList.tsx` (editado: SELECT + botão + banner + integração com o diálogo)