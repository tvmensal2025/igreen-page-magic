---
inclusion: always
name: product
description: Personas, jornadas e o que o produto não é.
---

# Produto — iGreen Official Portal

Captação + WhatsApp + cadastro iGreen para consultores de energia solar: do clique Meta/CTWA ao portal, CRM, Club, Ads, esteira multiproduto e pós-venda.

Stack/estrutura detalhada: `tech.md` + `structure.md` (always). Domínios sob demanda: ver `AGENTS.md`.

## Personas

| Quem | Faz |
|---|---|
| Consultor | Landing, chat WA, captura OCR, CRM, agenda, Disparo PRO, Ads+carteira, reheat, voz, esteira de venda |
| Superadmin | Kill switch, motores, Meta plataforma, monitor portal, saúde, suporte remoto |
| Lead | Não loga: CTWA/landing → Zap → docs/OTP/portal/Club |

## Jornadas

1. Meta/CTWA → atribuição UUID → rodízio → Whapi → bot/Cérebro
2. Cadência Zero Lead Perdido (`cadence-tick` + `lead_cadence_state`) — A/B/C (**disparo**; não é o Cérebro)
3. Portal 2: `finalize-capture` → worker-portal-2 → OTP/facial → CRM em análise
4. Club separado: `finalize-club` → worker-club
5. Humano: takeover, agenda, manual-step-send
6. **Esteira multiproduto** (`sales` / `sale_stage_*`) ≠ **pós-venda WA** (`pos_venda_*` D30…D210 + retentativa)
7. Ads + Stripe wallet

### Cérebro × Grupo A (obrigatório saber)

- **Cadência A/B/C** = dispara quando o lead some.
- **Grupo A cadastro** = funil determinístico (conta/doc/portal) **manda** nos passos.
- **Cérebro (Sofia)** = IA só responde inbound nas laterais (dúvida livre / fora do cadastro / carteira). **Não** substitui o funil.
- Opt-in: `consultants.cerebro_ativo` default **`off`**; modal Mensagens automáticas (`CEREBRO_OPT_IN`). Novo consultor tem que ligar de propósito.
- Canônico completo: `#cerebro-fluxo-b` · armadilha #36 · rule Cursor `cerebro-vs-grupo-a`.

## O que NÃO é

- Evolution-first (Whapi é primário; `needs_reconnect` ≠ Zap offline)
- Portal 1 / Playwright cadastro default (morto 2026-06)
- CRM SaaS genérico ou chatbot avulso
- Ligar motor/massa novo sem pedido
- Cérebro conduzindo o Grupo A inteiro / Cérebro = cadência A/B/C

## Bônus de entrada Conexão Green (Ads / tiers)

Canônico: `src/data/entradaBonusTiers.ts` + tabela oficial Jul/2026 em `oficialEntradaTabela.ts`.
UI editável: card **Ganhos do funil** → botão **Bônus / cidades** (`EntradaRulesDialog`) + Configurações `BonusTiersAdminCard`.

| Tier | Teto | Exemplos (arte Jul/2026) |
|---|---|---|
| Alto | **60%** | AL Equatorial, BA Coelba, CE Enel, GO Equatorial, MG Cemig, MS/MT Energisa, PE Neoenergia, PI Equatorial, PR Copel, RJ/MG Energisa Minas Rio, RN Cosern, SP CPFL + Energisa Sul-Sudeste |
| Médio | **40%** (trava em 40 pessoas) | PB Energisa, SP/MS Elektro, TO Energisa, RS RGE, SC Celesc |
| Sem bônus | **0%** entrada | lista vazia (editável); **CPFL Piratininga não existe mais** |

Faixas e distribuidoras ficam em `ad_bonus_tiers.faixas` / `.distribuidoras` (JSON) — editar em Configurações → Bônus por tier.

## Regras de ouro

- Automações com cadeados; **não apagar** migrations/toggles/flags
- Kill switch: `app_settings.bot_global_enabled` (`_shared/bot/global-flag.ts`)
- Campanha/rodízio = UUID (`source_campaign_id`), não texto do Zap
- Idioma: **pt-BR**
