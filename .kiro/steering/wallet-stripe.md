---
inclusion: fileMatch
name: wallet-stripe
description: Carteira consultor e Stripe.
fileMatchPattern:
  - "supabase/functions/wallet-*/**"
  - "src/components/wallet/**/*"
  - "src/hooks/useWalletGuard.*"
  - "src/components/admin/financeiro/**/*"
  - "src/components/admin/ads/WalletChip.*"
  - "supabase/functions/_shared/validate-campaign-activation.ts"
---

# Wallet / Stripe — Ads + iGreen Fone

Fonte: #[[file:docs/auditoria/06-integracoes.md]]

## Edges
| Função | Papel |
|---|---|
| `wallet-create-topup` | Checkout Stripe (card, BRL) — JWT consultor (Ads) |
| `wallet-stripe-webhook` | Credita/estorna — `verify_jwt=false` + assinatura Stripe |
| `wallet-manual-credit` | Crédito/approve·reject — JWT + admin (também SMS/voz) |

## Tabelas / RPCs
- `consultant_wallet` — `balance_cents`, `debt_cents`, `auto_pause_at_cents` (escrita **service_role**)
- `wallet_transactions` — `topup|spend|refund|adjustment` + fee Stripe
- `wallet_manual_topup_requests` — `pending|approved|rejected`
- `platform_usage_billing` — cobrança idempotente SMS/voz (`UNIQUE(kind, provider_ref)`)
- `platform_low_balance_alerts` — dedup aviso saldo baixo (24h)
- RPCs: `credit_consultant_wallet`, `debit_consultant_wallet`, `refund_consultant_wallet`, `ensure_consultant_wallet` (welcome R$1), `debit_platform_usage_observation`, `claim_platform_low_balance_alert`

## Fluxo
1. **Novo consultor:** `ensure_consultant_wallet` → R$ 1,00 welcome (adjustment)
2. Top-up Ads R$ 50–5.000 → Checkout (`metadata.consultant_id`)
3. `checkout.session.completed` → crédito **líquido** (bruto − fee)
4. Pós-crédito: `facebook-realign-lifetime` (`reactivate: true`)
5. Gasto Ads: `facebook-sync-metrics` debita delta
6. Gasto **iGreen Fone:** SMS R$ 0,10 (`sent`) · voz R$ 0,10/30s ceil se atendida — helper `_shared/voice-sms-billing.ts`
7. Saldo baixo voz/SMS → `notifyConsultant` (WhatsApp do consultor) **e** `notifySuperAdminOpsAlert` (com **nome do consultor**) · cooldown 24h · histórico em `infra_metrics` + modal Super Admin (`OpsAlertsModal`)
8. Saldo baixo Ads → auto-pause Meta; UI `useWalletGuard`
9. Chargeback → `refund_consultant_wallet`
10. Mais crédito SMS/voz: **admin manual** (não auto-serviço)

Quem **não** usa SMS/ligação não recebe o aviso — o alerta só dispara no débito real (`debitPlatformUsage`).

## Secrets / cadeados
`STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` · webhook com `constructEventAsync` · criar campanha exige saldo via `validate-campaign-activation`.

## NÃO FAÇA
Creditar bruto · expor Stripe no front · bypass RPC · inventar saldo na UI · cobrar Cérebro/chatbot · mencionar Velip na UI do consultor (marca **iGreen Fone**).
