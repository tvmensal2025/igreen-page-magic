## Diagnóstico

O botão "Resetar telefone" do `HardResetPhoneCard` funcionou — o `admin_audit_log` confirma três execuções (16:35, 16:36, 17:04), cada uma apagando `customers/conversations/crm_deals/customer_flow_state/capture_field_events`. O problema é que quando você mandou "Oi" de novo logo após o reset, o webhook **recriou o lead, mas não 100% "do zero"**:

- ✅ `customers.id` é novo (`5652b581…`), `conversation_step=null`, `flow_variant=B` reatribuído via distribuição
- ❌ O `consultant_id` é decidido pelo mesmo roteamento de antes (Rafael, porque o número segue na carteira/última fonte)
- ❌ O webhook não revalida `lead_source`, `customer_origin`, `is_test_lead`, etc. — herda o que vier do contexto
- ❌ Possivelmente herda metadados via tabelas que o reset não cobre (ver auditoria abaixo)

Você quer: **após reset, o telefone deve se comportar igual a um número que nunca falou com o sistema** — primeira mensagem cai no fluxo de boas-vindas do consultor que receber pela distribuição padrão, sem nenhum "fantasma" do lead anterior.

## Plano

### 1. Auditar o que sobra fora das tabelas que o `admin_hard_reset_phone` apaga

Rodar (read-only) procura por `5511971254913` em todas as tabelas `public.*` com colunas `phone%`, `remote_jid`, `customer_jid`, `to`, `recipient`, `metadata->>phone`, etc., para listar resíduos. Candidatos prováveis que hoje a função NÃO cobre:

- `bot_messages` / `bot_message_ab_results` (histórico de A/B)
- `outbound_message_log` (cobre por customer_id, mas a entrega `delivered` chega depois do reset com customer já apagado → órfão)
- `webhook_message_dedup` (dedupe por message_id — pode bloquear primeira msg)
- `whatsapp_message_buffer` resíduos por `chat_id`
- `lead_insights`, `ai_winning_conversations`, `ai_cooldown_state` (cobertura parcial via ILIKE — ver se pega o JID `@s.whatsapp.net`)
- `crm_auto_message_log`, `customer_tags`, `scheduled_messages` (cobertos por remote_jid; conferir variantes `@lid`)
- Qualquer tabela com `consultant_id` + `phone` que cacheia distribuição (ex.: `consultant_lead_history`, se existir)

Esse diagnóstico vira a base do passo 2.

### 2. Estender `admin_hard_reset_phone` para "wipe total + cooldown curto"

Migration nova que substitui (CREATE OR REPLACE) a função para:

a) **Apagar resíduos** identificados no passo 1 (acrescentar `DELETE` ao bloco existente, na mesma transação SECURITY DEFINER).
b) **Limpar `webhook_message_dedup`** para os `message_id`s relacionados ao chat_id desse telefone (ou todos os entries cujo `chat_id` bate as variantes).
c) **Inserir uma trava curta em `webhook_rate_limit`** (ou nova tabela `phone_reset_quarantine`) marcando o telefone como "resetado em X" por 30 s. Webhook ignora qualquer status callback (`from_me=true`, type=`statuses`) ou mensagem cujo timestamp ≤ ao instante do reset.
d) Retornar no JSON o `quarantine_until` para o front exibir feedback.

### 3. Honrar a quarentena nos dois webhooks

Em `supabase/functions/whapi-webhook/index.ts` e `supabase/functions/evolution-webhook/index.ts`, bem no topo do handler (antes de qualquer lookup de customer):

```ts
const phoneDigits = onlyDigits(chatIdOrFrom);
const { data: q } = await supabase
  .from("phone_reset_quarantine")
  .select("quarantine_until, reset_at")
  .eq("phone_digits", phoneDigits)
  .gte("quarantine_until", new Date().toISOString())
  .maybeSingle();

if (q) {
  // 1) status callbacks de mensagens antigas → descarta
  if (eventType === "statuses") return ok();
  // 2) mensagens cujo timestamp <= reset_at → descarta (entrega atrasada)
  if (messageTsMs <= new Date(q.reset_at).getTime()) return ok();
  // 3) qualquer customer pré-existente com esse phone é deletado de novo (defesa em profundidade)
}
```

Isso garante: status `delivered` da última mensagem do bot que ainda está em trânsito não recria o customer; só **uma mensagem nova de verdade** (timestamp > reset_at) entra, e aí já entra no caminho de lead novo.

### 4. Garantir reentrada como "lead novo" mesmo dentro da carteira do consultor

Mesmo após wipe, a distribuição vai escolher um consultor (provavelmente Rafael de novo porque é quem recebe esse DDD/instance). Para a UX que você quer (= "um número novo qualquer"), basta:

- Customer recriado já entra com `conversation_step=null`, `flow_variant=B` (sorteado), `lead_source=null`, `customer_origin=null`, `last_bot_reply_at=null` — o que o bypass V2 + Vendedora V2 já trata como welcome.
- Adicionar `previous_conversation_step=null`, `name=null`, `name_source=null` para não herdar nome captado por outros canais (caso a tabela `customer_memory` ressuscite algo via webhook). Já está coberto porque o reset apaga `customer_memory`; só preciso confirmar que NENHUM outro código popula `customers.name` antes do welcome.

Se o passo 1 achar tabela de memória residual, ela entra no `DELETE` do passo 2.

### 5. Feedback no card de UI

`HardResetPhoneCard.tsx`: após sucesso mostrar também `"Quarentena ativa até <hh:mm:ss> — próximos delivered/status são ignorados"`. Sem mexer no botão em si.

### 6. Validação

1. Apertar "Resetar telefone" em `11971254913`.
2. Conferir `admin_audit_log` mais recente: novo campo `quarantine_until` presente.
3. Olhar logs do `whapi-webhook` por 30 s — qualquer `statuses` para esse chat_id deve sair como `⏭️ Mensagem ignorada (quarentena pós-reset)`.
4. Mandar "Oi" do celular depois da quarentena → deve aparecer `[fluxo-b-bypass]` + `[fluxo-b] dispatching customer=<novo-id> step=welcome` SEM `previous_conversation_step`, sem nome herdado, sem `lead_source`.
5. Checar `customers` para `11971254913`: deve existir um único `id` novo, `created_at > reset_at`, e todos os campos de captura/memória zerados.

## Detalhes técnicos

- Mudanças concentradas em: 1 migration (`admin_hard_reset_phone` + nova tabela `phone_reset_quarantine` + GRANTs + RLS service_role-only), 2 edge functions (`whapi-webhook`, `evolution-webhook` — bloco de quarentena no topo), 1 componente (`HardResetPhoneCard` — string de feedback).
- Sem alteração no fluxo da Vendedora V2 nem no Fluxo B.
- A quarentena é por **telefone normalizado** (55 + DDD + número), aplicada antes de qualquer lookup, portanto cobre tanto `whapi` quanto `evolution` e não depende de `customer_id`.
- TTL curto (30 s, configurável) — não impacta uso real porque um humano novo demora > 30 s para iniciar conversa após você apertar reset.
