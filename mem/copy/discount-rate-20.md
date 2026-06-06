---
name: Discount Copy Rate
description: Texto oficial em todas as comunicações usa "até 20%" de desconto; cálculos da IA usam 0.20
type: feature
---
Padrão para todas as superfícies cliente-final (LP, WhatsApp bot, FAQ, IA):
- **Desconto = até 20%** em LP/FAQ/bot. NUNCA 12%, 15% ou faixa 10-20%.
- **Exceção — IA Fluxo B (Vendedora v1)**: na frase de SIMULAÇÃO verbal usa SEMPRE faixa "*entre 8% e 20%*" (varia por ICMS/consumo). O número em R$ exibido continua `valor × 0,20` fixo. Definido em `_shared/fluxo-b-prompt.ts` (seção "Simulação após receber o valor da conta") e reforçado em `vendedora-v1/planner.ts` e `playbook.ts`.
- `supabase/functions/ai-sales-agent/index.ts`: prompt diz "≈20% sobre o valor"; cálculo `billNum * 0.20`.
- `supabase/functions/{whapi,evolution}-webhook/handlers/bot-flow.ts`: `{economia_mensal/anual}` = `valor * 0.20`.
- `ai_knowledge_sections` "FAQ 2 — DESCONTO E COBRANÇA": "O desconto é de até 20%…".
- LP: `HowItWorksSection`, `LicConexaoGreen`, `ConsultantPage` meta — todos "até 20%".
- Passos `bot_flow_steps.slot_key='como_funciona'` com texto vazio recebem o copy padrão via migration:
  "Funciona assim, {{nome}}: você continua recebendo a conta da sua distribuidora normal — só que a iGreen entra com *até 20% de desconto* todo mês. Sem obra, sem instalação, sem mudar fiação. 💚 Quer que eu já faça a simulação com o valor da sua conta?"
- 15% que sobrou em `LicConexaoClub`/`LicCareerPlan`/`ClubSection` = comissão de licenciado ou benefício de parceiro Conexão Club, **não** desconto do cliente — não mexer.

Tempo humano (`_shared/human-pace.ts`): `2200 + len*55ms` (min 2,2s / max 11s), pausa entre mensagens 1,8-3,8s — evita "soa bot".
