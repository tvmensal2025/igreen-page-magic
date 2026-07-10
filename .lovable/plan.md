
# Mensagem "Campanha aprovada pela Meta" — versão rica

## Problema
`formatCampaignApprovedMessage` hoje manda só nome + intervalo. Faltam: dias, orçamento/dia, investimento total, cidades, alcance estimado, protocolo, ID/nome do parceiro, posição no rodízio, roster. A estrutura completa já existe em `notify-partner-leads-batch` (lead) — vamos replicar o padrão para o aviso de aprovação.

## O que muda

### 1. `supabase/functions/_shared/rodizio-metrics-format.ts`
Substituir `formatCampaignApprovedMessage(name, interval)` por uma nova assinatura que aceita um objeto completo:

```ts
formatCampaignApprovedMessage({
  campaignName, trackingProtocol, fbCampaignId,
  dailyBudgetCents, durationDays, totalInvestmentCents,
  cities,                       // string[] até 5 nomes
  estimatedReach,               // {lower,upper} | null
  partnerName, partnerIgreenId,
  position, totalPositions,     // rodízio
  rosterLines,                  // ["1º Fulano · ID 123 ← você", ...]
  intervalMinutes,
})
```

Layout (WhatsApp, todo emoji + negrito):

```
✅ *Campanha aprovada pela Meta!*
🚀 Seu anúncio já está no ar.

📢 *Campanha*
🎯 *{campaignName}*
🆔 ID Meta: `{fbCampaignId}`
🔖 Protocolo: *{trackingProtocol}*
📅 Duração: *{durationDays} dias*
💵 Orçamento/dia: *R$ X,XX*
💼 Investimento total previsto: *R$ Y,YY*
📍 Cidades: {city1, city2, city3 …}
👀 Alcance estimado: *{lower}–{upper} pessoas*

🪪 *Seu cadastro*
   Nome: *{partnerName}*
   ID iGreen: *{partnerIgreenId}*

👥 *Rodízio*
🏅 Sua posição: *Nº de Total*
📋 Integrantes:
  1º Fulano · ID 123 ← você
  2º Ciclano · ID 456
  ...

📊 Atualização de métricas a cada *{intervalLabel}*
   (gasto, cliques, conversas e seus leads)
🌙 Sem mensagens de madrugada.

💪 Bons leads!
✨ _iGreen Ads_
```

Regras de omissão: qualquer campo `null/0/[]` some (sem "N/D"), pra manter a filosofia "nunca mandar dado errado".

### 2. `supabase/functions/rodizio-metrics-broadcast/index.ts`
No bloco `if (!pool.approval_notified_at && poolSize > 0)` (linhas 291-322):

1. **Buscar campanha completa** (adicionar campos ao SELECT do pool ou fazer 1 query extra):
   `cities, duration_days, daily_budget_cents, tracking_protocol, fb_adset_ids`.
2. **Estimativa de alcance** (por adset): chamar Meta Graph API
   `GET /{adset_id}/delivery_estimate?optimization_goal=<goal>` com token do consultor. Se falhar → omitir campo. Cachear em memória por execução (mesma pool = mesmo valor pra todos os parceiros).
3. **Roster do rodízio**: usar `eligible` (já carregado) + query única em `referral_partners` (nome, partner_igreen_id, short_code) — reaproveitar padrão de `notify-partner-leads-batch` linhas 231-255.
4. **Para cada `m` em `eligible`**, montar mensagem individualizada com `partnerName`, `partnerIgreenId`, `position = m.position+1`, `rosterLines` marcando "← você".
5. Passar tudo pro novo `formatCampaignApprovedMessage`.

Dedup e marcação de `approval_notified_at` seguem iguais.

### 3. Sem migration
Todos os campos usados já existem em `facebook_campaigns` e `referral_partners`.

## Detalhes técnicos

- **Alcance estimado** vem de `POST/GET https://graph.facebook.com/v20.0/{adset_id}/delivery_estimate` — retorna `estimate_ready`, `users_lower_bound`, `users_upper_bound`. Timeout curto (5s) e try/catch pra não bloquear envio.
- **Cidades**: `camp.cities` é jsonb `[{key,name}]` → mapear `.name`, limitar a 5, juntar com ", " e adicionar "+N" se houver mais.
- **Investimento total**: `daily_budget_cents * duration_days` (só se `duration_days > 0`; senão "contínua" e omite total).
- **Intervalo**: reusar `intervalLabel(intervalMinutes)` já exportado do mesmo arquivo.
- **Backfill do consultor solo (sem parceiros)**: se `poolSize === 0`, continua sem enviar (comportamento atual).

## Arquivos alterados
- `supabase/functions/_shared/rodizio-metrics-format.ts` — nova função rica (mantém export com mesmo nome, quebra assinatura).
- `supabase/functions/rodizio-metrics-broadcast/index.ts` — enriquece o bloco de aprovação com queries adicionais + delivery_estimate + roster.

## Fora de escopo
- Reenviar aviso pras campanhas já aprovadas (histórico) — se você quiser, faço num segundo passo com um endpoint one-shot que reseta `approval_notified_at` de uma pool específica.
