## Distribuição dos 6 leads + ativação de acompanhamento

### 1. Atribuição final (owner_id em `customers`)

| # | Telefone | Consultor | Pool/Origem |
|---|---|---|---|
| 1 | 553484470496 (Wudysson) | Rafael Ferreira | Uberlândia/BH |
| 2 | 553197395046 (Royter) | Francisco Melquiades | Uberlândia/BH |
| 3 | 553897540950 | Abel Oliveira | Uberlândia/BH |
| 4 | 553496300929 | Rafael Ferreira | Uberlândia/BH |
| 5 | 553184829431 | Francisco Melquiades | Uberlândia/BH |
| 6 | 5511971495971 | Rafael Ferreira | Fora de rodízio (SP) |

### 2. Passos de execução

1. **Reativar pool "Jaraguá"** — limpar `last_pause_reason` e `paused_notified_at` em `rodizio_pools`.
2. **Criar/atualizar `customers`** para os 4 leads que faltam (3, 4, 5, 6) — inserir `phone`, `owner_id`, `source = 'facebook_ads'`, `campaign_source = 'Uberlândia/BH'` (ou `SP-fora-rodizio` para o #6), `assigned_at = now()`.
3. **Atualizar `owner_id`** dos 2 já existentes (Wudysson mantém Rafael; Royter passa de Rafael → Francisco).
4. **Girar counter** do pool `Uberlândia/BH` para `5` (5 leads consumidos do giro).
5. **Registrar em `campaign_match_log`** cada lead com pool e consultor final, para deixar histórico mesmo com o classificador quebrado.
6. **Registrar em `sale_status_history`** a atribuição inicial (stage "novo lead") para cada um.

### 3. Acompanhamento — SIM, terão

Depois que `owner_id` fica setado e o customer existe no banco, os leads entram automaticamente em:

- **Kanban do consultor** (`/admin` → CRM) — cada consultor vê o lead dele.
- **Fluxo de bot** (`bot_flows` + `customer_flow_state`) — se houver mensagem inbound do lead, o bot responde e o consultor recebe notificação.
- **Auto-mensagens de estágio** (`stage_auto_messages`) — mensagens automáticas ao mudar de coluna.
- **Reativação** (`reactivation_sends`) — se ficar sem resposta X dias, entra na régua.
- **Handoff alerts** (`bot_handoff_alerts`) — alerta quando lead pedir humano.

**Limitação:** como `campaign_match_log` estava vazia, os 4 leads sem histórico serão marcados como `Uberlândia/BH` por DDD (não 100% garantido). O #6 (SP) fica fora do rodízio, direto com Rafael.

### 4. O que NÃO será feito agora
- Não vou consertar o classificador `campaign_match_log` (é outro trabalho separado).
- Não vou disparar mensagem de boas-vindas aos leads (evitar spam retroativo em leads antigos); consultor decide se envia manual.

### Detalhes técnicos
- Tool: `supabase--insert` para UPDATE em `customers`, `rodizio_pools`, e INSERT em `campaign_match_log` + `sale_status_history`.
- Nenhuma alteração de schema, apenas dados.
