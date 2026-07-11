# Plano: blindar campanha/rodízio para não misturar Francisco, Horácio e outros parceiros

## O que foi encontrado

- Há duas campanhas ativas no consultor Rafael:
  - `Horacio · Brasilândia de Minas` com pool ativo contendo só `Rodrigo Horácio`.
  - `Jaraguá` com pool ativo contendo `Rafael Ferreira Dias`, `Francisco Melquiades` e `Abel Oliveira`.
- O erro real apareceu em leads recentes: alguns leads chegaram com `source_ad_id = 120246248100890645`, que pertence à campanha `Jaraguá`, mas foram gravados como campanha `Horacio`.
- Isso significa que o sinal forte do Meta (`source_ad_id`) não está vencendo o fallback/atribuição anterior em todos os caminhos.
- Resultado: quando a campanha errada é salva no lead, o rodízio usa o pool errado e manda para Horácio.

## Objetivo

Garantir que, quando o Meta enviar qualquer identificador confiável (`source_ad_id`, `ad_id`, `ctwa_clid`, `campaign_id` ou URL com `ad_id`), esse dado sempre tenha prioridade absoluta sobre qualquer fallback por frase, DDD, atividade recente ou pool ativo.

## Correções propostas

### 1. Criar uma função única de resolução determinística
Centralizar em um helper compartilhado a regra:

```text
source_ad_id/ad_id/source_url com ad_id
  > fb_campaign_id
  > ctwa_clid mapeado
  > protocolo da mensagem
  > fallback controlado
```

Essa função será usada tanto no `whapi-webhook` quanto no `evolution-webhook`, para os dois canais seguirem a mesma regra.

### 2. Trava anti-contaminação no momento de salvar campanha
Antes de salvar `source_campaign_id` em `customers`, validar:

```text
Se existe source_ad_id e a campanha escolhida NÃO contém esse ad_id em facebook_campaigns.fb_ad_ids:
  não salvar campanha errada
  registrar auditoria
  enviar para revisão/manual-safe em vez de rodízio errado
```

Isso impede exatamente o erro visto: lead com ad de Jaraguá ser salvo como Horácio.

### 3. Reprocessar os leads recentes já contaminados
Corrigir os leads dos últimos dias onde:

```text
customers.source_ad_id existe
E customers.source_campaign_id aponta para uma campanha que não contém esse source_ad_id
```

Para cada caso:
- localizar a campanha correta via `facebook_campaigns.fb_ad_ids`;
- atualizar `source_campaign_id`;
- limpar ou recalcular `referral_partner_id` conforme o pool correto;
- registrar em `campaign_match_log` com método de correção.

### 4. Rodízio só roda depois de campanha validada
Nos webhooks, o `rodizio_next` só poderá ser chamado quando:

```text
campaign_id validado
campanha ativa/pending_review
pool ativo da mesma campanha
se source_ad_id existir, ele pertence à campanha
```

Se falhar qualquer item, o lead não será enviado para parceiro errado; ficará para revisão segura.

### 5. Corrigir o fallback por atividade recente
O fallback atual pode escolher a campanha “mais quente” quando não encontra sinal forte. Ele deve ser mais conservador:

- se houver qualquer sinal de Meta não resolvido, não usar atividade recente para escolher outra campanha;
- se houver múltiplas campanhas ativas com a mesma frase genérica, só usar protocolo ou identificador Meta;
- fallback por DDD/atividade só pode atuar quando não existe `source_ad_id`, `ctwa_clid` ou URL com ad.

### 6. Ajustar pool solo da campanha Horácio
Como a campanha Horácio tem pool com apenas Rodrigo Horácio, definir uma proteção no painel/criação:

- avisar quando campanha ativa tem pool com 1 pessoa;
- permitir destino exclusivo somente se estiver marcado explicitamente como “destino único”; caso contrário exigir 2+ participantes.

Para agora, manter a configuração atual sem mexer automaticamente nos participantes até você confirmar se essa campanha deve ser exclusiva do Horácio ou entrar no rodízio geral.

## Validação depois da implementação

- Consultar todos os leads recentes com `source_ad_id` e confirmar que a campanha salva contém o ad em `fb_ad_ids`.
- Testar caso Jaraguá/Francisco: `120246248100890645` precisa resolver para campanha Jaraguá, nunca Horácio.
- Confirmar que o rodízio da campanha Jaraguá usa apenas o pool Jaraguá.
- Confirmar que o rodízio da campanha Horácio só roda para ads realmente da campanha Horácio.

## Resultado esperado

- Lead da campanha Francisco/Jaraguá nunca vai para Horácio.
- Lead da campanha Horácio só vai para Horácio se o anúncio realmente for da campanha Horácio.
- Se o Meta vier sem identificador suficiente, o sistema não inventa campanha errada; manda para revisão segura.