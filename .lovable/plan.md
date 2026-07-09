## Notificar os 3 parceiros com o(s) lead(s) + info da campanha

### Situação atual
- Os 6 leads foram atribuídos no banco (`referral_partner_id` setado) — **✅ feito**
- **Nenhum parceiro foi avisado por WhatsApp** — `last_partner_notified_at` está NULL para os 6
- Sem `notifyPartnerNewLead()` executar, o parceiro só descobre o lead abrindo o Kanban

### O que fazer

**1. Criar edge function `notify-partner-leads-batch`**
- Recebe: lista de `customer_id` (ou "todos os leads sem `last_partner_notified_at` das últimas 24h")
- Para cada lead:
  - Resolve `referral_partner_id` → `notification_phone` do parceiro
  - Busca `source_campaign_id` (ou o pool → campanha)
  - Busca métricas da campanha (`facebook_campaigns` + `facebook_metrics_daily` se houver)
  - Calcula posição do parceiro no pool (`rodizio_pool_members.position` + counter atual)
  - Envia mensagem formatada via Whapi/Evolution (`sendRawToNumber` já existente)
  - Marca `last_partner_notified_at = now()`
  - Registra em `campaign_match_log` (method='manual_backfill', outcome contém "notified")

**2. Design da mensagem (bonito, com dados de campanha)**

```
Olá, Rafael! 👋

🎉 NOVO LEAD DA CAMPANHA
━━━━━━━━━━━━━━━━━━

👤 Nome: Wudysson Moraes
📱 WhatsApp: (34) 8447-0496
🕐 Chegou: 08/07 21:34
🤖 Sofia (IA) já está atendendo

📢 CAMPANHA
━━━━━━━━━━━━━━━━━━
🏷️  Uberlândia, Uberaba, BH
📅 Ativa desde: 08/07
💰 Orçamento/dia: R$ 10,00
📊 Total investido: R$ — (sem dados)
🎯 Leads gerados: 6

🔄 SEU RODÍZIO
━━━━━━━━━━━━━━━━━━
Posição: 1º de 3
Próximo giro: você (posição 1)
Leads recebidos hoje: 2

_Automático · iGreen_
```

**3. Executar em lote (chamar 1x agora)**
- Chama a edge function com os 6 customer_ids
- Cada parceiro recebe 1 mensagem por lead (respeitando dedup de 24h)
- Rafael recebe 3 mensagens (leads 1, 4, 6), Francisco 2, Abel 1

**4. Deixar ligado para o futuro (opcional, confirmar)**
- Hoje `notifyPartnerNewLead` já é chamado pelo `lead-intake` quando o lead chega via webhook — o motivo destes 6 não terem sido notificados é que foram inseridos por SQL direto, pulando a função
- Não precisa mudar nada: leads novos via campanha continuarão notificando automático

### Detalhes técnicos
- Reusa `sendRawToNumber()` de `_shared/notify-consultant.ts`
- Nova função `notify-partner-leads-batch/index.ts`
- Sem alteração de schema
- Não altera `notifyPartnerNewLead` original (segue igual para fluxo normal); a nova função tem template estendido com dados de campanha + posição no rodízio
- Autenticação: exige JWT admin (mesma lógica de `assign-lead-manual`)

### Limitação
- `facebook_metrics_daily` está vazia para essas campanhas → o "Total investido" vai aparecer como "—" ou "sem dados"; podemos disparar um refresh do Meta Insights antes, mas isso é um segundo trabalho
