## Diagnóstico
Rafael (0c2711ad) tem **754 clientes**. Deles:
- 699 `customer_origin='igreen_sync'` (importados do portal iGreen).
- 55 `whatsapp_lead`.
- **583 têm `origin_channel` em (whapi, evolution)** — vieram pelo WhatsApp; muitos foram sincronizados depois com iGreen.
- 43 têm mensagem gravada em `conversations`/`last_bot_interaction_at`.
- 180 dos 583 têm status ativo (`andamento_igreen` ativo/aprovado/validado/…) → clientes fechados.

O Whapi antigo era outro número mas mesmo canal — muitas conversas nunca foram persistidas em `conversations`, então exigir "ter mensagem gravada" some com esses leads.

## Regra
Só entra no Conversão quem **é lead do WhatsApp** (Evolution ou Whapi):
- `customer_origin IN ('whatsapp_lead','manual')` **OU** `origin_channel IN ('whapi','evolution')`.

E **nunca** `customer_origin='igreen_sync'`, mesmo que também tenha `origin_channel` marcado — sync é cliente do portal, não lead.

Fora do funil: qualquer um com sinal de cliente ativo (`data_ativo`, `data_validado`, `andamento_igreen ∈ ativo/aprovado/validado/licenciada/licenciado`, `assinatura_cliente` truthy).

## Mudança
### `src/components/admin/conversao/ConversaoCockpit.tsx` — `fetchRows` (linhas 130-196)

1. **Select** — trazer também `origin_channel`.
2. **Filtros SQL**:
   - `.eq("consultant_id", consultantId)`
   - `.neq("customer_origin", "igreen_sync")` ← exclui sync mesmo com canal WhatsApp
   - `.or("customer_origin.in.(whatsapp_lead,manual),origin_channel.in.(whapi,evolution)")`
   - `.is("data_ativo", null)`
   - `.is("data_validado", null)`
   - ordenar por `last_bot_interaction_at desc`, `limit(1000)`.
3. **Filtro JS**: remover a exigência de "started" (`last_bot_interaction_at` ou linha em `conversations`) e remover a segunda query em `conversations`. Manter só a exclusão por `andamento_igreen ∈ CLIENT_STATUSES` e `assinatura_cliente` truthy.

Resultado esperado para Rafael: leads do canal WhatsApp que não são `igreen_sync` e não estão ativos — inclui os contatos antigos do Whapi sem histórico gravado.

## Fora de escopo
- Sem alterar Captação, schema, RLS.
- Sem mudar UI, drawer, filtros de tela ou IA.

## Verificação
Recarregar `/admin` → Central de Conversão. Contatos antigos do Whapi (mesmo sem `conversations`) passam a aparecer; nenhum `igreen_sync` na fila; nenhum com `andamento_igreen` ativo/validado.
