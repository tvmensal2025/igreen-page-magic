## 1. Acerto financeiro do Rafael

`rafael.ids@icloud.com` (uid `0c2711ad-4836-41e6-afba-edd94f698ae3`) está com `balance_cents=0` e `debt_cents=2348` (R$ 23,48), não R$ -100.

Lançamento manual via `supabase--insert`:
- Cria 1 registro em `wallet_transactions` tipo `topup` de R$ 123,48 com descrição `"Crédito manual Super Admin — quitação dívida + R$ 100 (pago em dinheiro)"`.
- Atualiza `consultant_wallet`: `balance_cents = 10000`, `debt_cents = 0`, `total_topped_up_cents += 12348`.
- Reativa campanhas pausadas por saldo (se houver) — limpa `pause_pending` e `pause_reason='saldo_insuficiente'`.

## 2. Fluxo "Adicionar saldo em dinheiro"

Tabela nova `wallet_manual_topup_requests` (migration com GRANTs + RLS):
- Colunas: `id`, `consultant_id`, `amount_cents`, `status` (`pending|approved|rejected`), `created_by_role` (`consultant|super_admin`), `note`, `approved_by`, `approved_at`, `created_at`.
- RLS: consultor vê/cria os próprios; super_admin (via `has_role`) vê tudo e aprova.

Edge function nova `wallet-manual-credit`:
- Valida JWT, checa `has_role(uid,'admin')`.
- Body: `{ consultant_id, amount_cents, note, request_id? }`.
- Credita carteira (quita débito primeiro, sobra vai pra saldo), grava `wallet_transactions` tipo `topup` com `metadata.source='manual_cash'`, marca request como `approved`.

UI:
- **Consultor** (`WalletChip.tsx`): novo botão "Paguei em dinheiro ao Super Admin" → modal com valor + observação → cria request `pending`. Mostra badge "Aguardando aprovação" enquanto pendente.
- **Super Admin** (`SuperAdmin.tsx`): no card de cada consultor, botão "Adicionar saldo (dinheiro)" → modal valor/observação → chama edge function direto (sem request). Nova aba opcional "Saldos pendentes" lista requests `pending` com botões Aprovar/Rejeitar.

## 3. Painel de custos do cliente (`WhatsAppDashboard`)

Substituir o `AICostCard` isolado por um novo `MonthlyCostsCard` que mostra:

```text
┌─ Custos do mês (estimativa) ────────────┐
│  Total: R$ XX,XX                        │
│  ───────────────────────────────────    │
│  Anúncios (Facebook):    R$ XX,XX       │
│  Assistente IA:          R$ XX,XX       │
│  ───────────────────────────────────    │
│  [Ver detalhes ▾]                       │
└─────────────────────────────────────────┘
```

- **Anúncios**: soma `wallet_transactions` tipo `spend` do mês corrente, com breakdown por campanha ao expandir (já temos `getWalletFeed`).
- **IA**: mantém lógica atual do `AICostCard` (agrupada por fase) como subseção expansível.
- **Total**: soma dos dois, badge "estimativa".
- Mantém o `WalletChip` separado pra recarregar.

## Arquivos afetados

**Novos**
- `supabase/migrations/<ts>_wallet_manual_topup.sql` (tabela + RLS + GRANTs)
- `supabase/functions/wallet-manual-credit/index.ts`
- `src/components/wallet/ManualTopupDialog.tsx` (consultor — pedir aprovação)
- `src/components/admin/super/SuperAdminCashCreditDialog.tsx` (super admin — creditar direto)
- `src/components/whatsapp/MonthlyCostsCard.tsx`

**Editados**
- `src/components/admin/ads/WalletChip.tsx` — botão "Paguei em dinheiro"
- `src/pages/SuperAdmin.tsx` — botão por consultor + (opcional) aba aprovações
- `src/components/whatsapp/WhatsAppDashboard.tsx` — troca `AICostCard` por `MonthlyCostsCard`
- `src/services/facebookAds.ts` — helper `getMonthlyAdSpend(consultantId)`

## Fora de escopo

- Cobrar pelo robô/WhatsApp (não há cobrança hoje).
- Auditoria mobile já entregue na conversa anterior — não mexer.
- Stripe topup automático segue funcionando como está.
