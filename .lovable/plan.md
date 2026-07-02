## Diagnóstico

Fui direto no banco pra confirmar sua reclamação:

- Card exibe **R$ 15/dia** mas os dados do Meta mostram gasto real:
  - 27/06: R$ 15,39 · 28/06: R$ 37,21 · 29/06: R$ 27,05 · 30/06: R$ 30,59 · 01/07: R$ 6,97
  - Total 5 dias: **R$ 117,21**, média real ≈ **R$ 30/dia** ✅ (bate com o que você lembra)
- Causa: `facebook_campaigns.daily_budget_cents = 1500` foi gravado na criação e **nunca é atualizado depois**. Se o orçamento foi alterado dentro do Meta (ou pelo `facebook-creative-rotator` / `facebook-extend-campaign`), o banco local ficou desatualizado.
- Além disso, o card só mostra "Gasto (30 dias)" e "CPL" — não mostra **quantos dias rodou** nem **orçamento real vindo da Meta**, então fica difícil auditar.

## Outras lacunas que a análise revelou

1. **CPL usa `leads` da Meta** (que inclui "clientes interessados" reportados pelo pixel/CTA), mas o card também exibe "Clientes interessados WhatsApp" contados de `customers.source_campaign_id`. Os dois números podem divergir bastante e não há explicação visual.
2. **Janela fixa de 30 dias** para agregar métricas mesmo em campanhas que rodaram só 5 dias — infla "Impressões/Cliques" ao longo do tempo mas o "R$/dia" mostrado (do banco) fica congelado.
3. **`leads_count`** na tabela `facebook_campaigns` existe mas não é usado no card — outra fonte de verdade não sincronizada.
4. **Campanhas pausadas** continuam mostrando "Gasto R$ 0,00" quando `spend_cents=0` no período — sem sinalização visual de "pausada há X dias, sem gasto novo".

## O que vou mudar

### 1. Sincronizar `daily_budget_cents` na `facebook-sync-metrics`
Depois de buscar insights, para cada campanha ativa/pausada com `fb_adset_ids`, chamar `GET /{adset_id}?fields=daily_budget,lifetime_budget` na Graph API e **somar** os `daily_budget` dos adsets → `UPDATE facebook_campaigns SET daily_budget_cents = <soma>`. Assim qualquer edição feita direto no Meta (ou pelo `creative-rotator` que bumpa 20%) reflete no card em ≤ 5 min após um sync.

### 2. Card de campanha (`CampaignsList.tsx`) — mostrar realidade
Substituir a linha estática `R$ X/dia` por bloco com 3 fatos verificáveis:
- **Orçamento atual:** R$ 30/dia (vindo da Meta, atualizado no último sync)
- **Rodando há:** 5 dias (calculado de `started_at` ou `created_at`)
- **Gasto total no período:** R$ 117,21

E ajustar os `<Stat>` do rodapé:
- `Gasto` continua mostrando total do período agregado
- Adicionar tooltip explicando "últimos 30 dias" ou "desde início da campanha (o que for menor)"
- CPL fica como está

### 3. Janela de agregação dinâmica
No `useEffect` que carrega `facebook_metrics_daily`: usar `Math.max(started_at, hoje-30d)` como início — assim uma campanha de 5 dias mostra métricas de 5 dias, não de 30.

### 4. Reconciliar "Interessados Meta" x "Interessados WhatsApp"
Adicionar tooltip curto no Stat "Clientes interessados Meta" explicando: *"Contados pelo Facebook via CTA. Pode diferir dos que chegaram no WhatsApp — muitos clicam e não escrevem."*

### 5. Trigger manual + próximo sync
O botão **Sincronizar agora** que já existe passa a atualizar orçamento junto com métricas e capas — sem cron novo (mantém a preferência de sync sob demanda).

## Fora do escopo (não vou mexer sem você pedir)

- Não vou re-arquitetar `leads_count` — só evito usá-lo até estar sincronizado.
- Não vou tocar em `facebook-creative-rotator` (que já bumpa budget) — só passo a refletir o resultado no banco via sync.
- Não vou adicionar cron automático (respeita a preferência de sync manual atual).

## Como testar depois de aplicar

1. Abrir `/admin` → Campanhas → clicar **Sincronizar agora**
2. Card da campanha "Rua João Carlos de Lima" deve passar a mostrar **R$ 30/dia · Rodando há 5 dias · Gasto R$ 117,21**
3. Ao editar orçamento pelo botão "Estender/mudar orçamento" e sincronizar de novo, o novo valor aparece
