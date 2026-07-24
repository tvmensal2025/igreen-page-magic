---
inclusion: fileMatch
name: cross-sell
description: Cross-sell manual + sombra Cérebro.
fileMatchPattern:
  - "src/features/produtos/acompanhamento/crossSell*"
  - "src/features/produtos/acompanhamento/CrossSell*"
  - "supabase/functions/_shared/cerebro/cross-sell.ts"
---

# Cross-sell — manual + sombra (não massa)

## Evidência
- Template key: `cross_sell_hint` em `consultant_message_templates` — prod: **1** row
- Stages do card: `aprovado,d30…d210` (`crossSellConfig.ts`)
- Comentário canônico no config: **“Sem disparo automático — só alimenta o card manual.”**

## Dois caminhos

### 1) UI card (consultor)
- `crossSellConfig.ts` + `CrossSellCard.tsx`
- Persistência: `text_content` + `variables.{stages,products,placeholders}`
- Placeholders: `{{nome}}`, `{{produto}}` — nome só se seguro

### 2) Cérebro sombra
- `_shared/cerebro/cross-sell.ts:4–6` → “NÃO envia mensagem sozinho”
- `avaliarCrossSell` + `isCrossSellShadowMode` (`:28–30` default `"true"`; hint só se sombra off `:44–50`)
- Só se `crossSellBotEnabled` + cliente só energia + gaps telecom/seguros
- **Hoje `avaliarCrossSell` não tem consumidor no código de produção:** é só helper de sombra/sugestão, sem injeção no turno e sem envio.

Card: `crossSellConfig.ts:4–7` — “Sem disparo automático — só alimenta o card manual.”

## NÃO FAÇA
- Transformar card em **envio automático em massa** sem pedido explícito do usuário
- Ligar `CROSS_SELL_SHADOW=false` em prod sem pedido
- Confundir com pós-venda auto-progress ou cadência B/C
- Usar nome inseguro no template
