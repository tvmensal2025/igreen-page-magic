---
inclusion: always
---

# Produto — iGreen Official Portal

Captação + WhatsApp + cadastro iGreen para consultores de energia solar: do clique Meta/CTWA ao portal, CRM, Club, Ads e pós-venda.

## Personas

| Quem | Faz |
|---|---|
| Consultor | Landing, chat WA, captura OCR, CRM, agenda, Disparo PRO, Ads+carteira, reheat, voz |
| Superadmin | Kill switch, motores, Meta plataforma, monitor portal, saúde, suporte remoto |
| Lead | Não loga: CTWA/landing → Zap → docs/OTP/portal/Club |

## Jornadas

1. Meta/CTWA → atribuição UUID → rodízio → Whapi → bot/Cérebro
2. Cadência Zero Lead Perdido (`cadence-tick` + `lead_cadence_state`) — A/B/C
3. Portal 2: `finalize-capture` → worker-portal-2 → OTP/facial → CRM em análise
4. Club separado: `finalize-club` → worker-club
5. Humano: takeover, agenda, manual-step-send; pós-venda D30–120
6. Ads + Stripe wallet

## O que NÃO é

- Evolution-first (Whapi é primário)
- Portal 1 / Playwright cadastro default (morto 2026-06)
- CRM SaaS genérico ou chatbot avulso
- Ligar motor/massa novo sem pedido
