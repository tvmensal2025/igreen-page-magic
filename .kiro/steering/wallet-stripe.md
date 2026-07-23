---
inclusion: fileMatch
fileMatchPattern:
  - "supabase/functions/wallet-*/**"
  - "src/components/wallet/**/*"
  - "src/hooks/useWalletGuard.*"
  - "src/components/admin/financeiro/**/*"
  - "src/components/admin/ads/WalletChip.*"
  - "supabase/functions/_shared/validate-campaign-activation.ts"
---

# Wallet / Stripe — Ads pré-pago

Fonte: #[[file:docs/auditoria/06-integracoes.md]]

## Edges
| Função | Papel |
|---|---|
| `wallet-create-topup` | Checkout Stripe (card, BRL) — JWT consultor |
| `wallet-stripe-webhook` | Credita/estorna — `verify_jwt=false` + assinatura Stripe |
| `wallet-manual-credit` | Crédito/approve·reject — JWT + admin |

## Tabelas / RPCs
- `consultant_wallet` — `balance_cents`, `debt_cents`, `auto_pause_at_cents` (escrita **service_role**)
- `wallet_transactions` — `topup|spend|refund|adjustment` + fee Stripe
- `wallet_manual_topup_requests` — `pending|approved|rejected`
- RPCs: `credit_consultant_wallet`, `debit_consultant_wallet`, `refund_consultant_wallet`

## Fluxo
1. Top-up R$ 50–5.000 → Checkout (`metadata.consultant_id`)
2. `checkout.session.completed` → crédito **líquido** (bruto − fee)
3. Pós-crédito: `facebook-realign-lifetime` (`reactivate: true`)
4. Gasto Ads: `facebook-sync-metrics` debita delta
5. Saldo baixo → auto-pause Meta; UI `useWalletGuard`
6. Chargeback → `refund_consultant_wallet`

## Secrets / cadeados
`STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` · webhook com `constructEventAsync` · criar campanha exige saldo via `validate-campaign-activation`.

## NÃO FAÇA
Creditar bruto · expor Stripe no front · bypass RPC · inventar saldo na UI.
