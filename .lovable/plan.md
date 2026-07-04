## Diagnóstico da conexão Whapi

Verifiquei o estado atual no banco (`settings`) e no código:


| Item                                                                  | Estado                                                                                                          | Ação                                                                                                                                         |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings.whapi_token`                                                | ✅ Já gravado (`LjTJR3…V21i` — bate com o screenshot)                                                            | Nada                                                                                                                                         |
| `settings.whapi_connected_phone`                                      | ⚠️ Desatualizado: `+55 11 99009-2401` (número antigo)                                                           | Atualizar para `+55 34 9823-9056` (canal SHAZAM-A79TY / igreen-energy)                                                                       |
| Secret `WHAPI_TOKEN` (env, usado como fallback em ~15 edge functions) | ❓ Pode estar com o token antigo                                                                                 | Sobrescrever via `set_secret` com `LjTJR3RhPthc1O0tKkSiP61zEfyqV21i`                                                                         |
| Webhook URL na Whapi (dashboard da Whapi.cloud → Settings)            | ❓ Só vc consegue conferir                                                                                       | Deve apontar para `https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/whapi-webhook` com eventos `messages`, `statuses`, `chats` marcados |
| Envio manual + bot (whapi-webhook / manual-step-send / etc.)          | ✅ Todos leem `settings.whapi_token` primeiro, depois env — funcionará assim que o token estiver certo (já está) | Nada                                                                                                                                         |


**Nada mais falta no código.** O canal está tecnicamente conectado. Só resta os dois ajustes de config acima.

---

## Importação do histórico de conversas anteriores

A Whapi expõe o histórico do WhatsApp via API. Vou criar uma edge function nova `whapi-history-backfill` que puxa TODOS os chats e mensagens do canal e grava em `public.conversations` (a tabela que alimenta a aba **Conversas**), criando/atualizando `public.customers` pelo telefone.

### Fluxo

```text
GET gate.whapi.cloud/chats?count=500&offset=N       (pagina todos os chats)
  │
  ├─ Para cada chat (não-grupo):
  │    upsert customers (phone_whatsapp = normalizeE164(chat_id))
  │       - name = chat.name || pushname || null
  │       - lead_source = 'whapi_backfill'
  │       - bot_paused = true              ← IMPORTANTE: não dispara bot em lead histórico
  │       - bot_paused_reason = 'whapi_history_import'
  │       - consultant_id = superadmin_consultant_id (fallback)
  │
  │    GET /messages/list/{chatId}?count=500&offset=M    (pagina todas msgs)
  │      │
  │      └─ Para cada mensagem:
  │           insert conversations (idempotente via external_message_id UNIQUE)
  │             - customer_id
  │             - message_direction = from_me ? 'outbound' : 'inbound'
  │             - message_type = text | image | audio | video | document | sticker
  │             - message_text = body || caption || '[mídia]'
  │             - external_message_id = whapi msg.id  (dedup)
  │             - created_at = to_timestamp(msg.timestamp)
  │             - delivery_status = msg.status (sent/delivered/read) quando outbound
```

### Trigger

- Botão "Importar histórico Whapi" na aba de admin (visível só ao super admin).
- POST `/whapi-history-backfill { since?: ISOdate, max_chats?: number, dry_run?: boolean }`
- Roda em background com retorno imediato de `job_id` + status via polling (`settings.whapi_backfill_status`).
- Idempotente: rodar 2× não duplica (UNIQUE index em `conversations.external_message_id`).

### Segurança / limites

- Endpoint `verify_jwt=false`, mas valida super admin no corpo (mesma checagem do `whapi-admin`).
- Rate limit da Whapi: ~10 req/s → `await sleep(120ms)` entre chamadas.
- `bot_paused=true` **obrigatório** em todo lead importado para evitar o bot disparar mensagem para milhares de números antigos assim que a conversa é criada.

### Passos técnicos

1. **Migração:** adicionar índice único `CREATE UNIQUE INDEX IF NOT EXISTS conversations_external_message_id_uk ON public.conversations(external_message_id) WHERE external_message_id IS NOT NULL;` (se ainda não existir) + campos `whapi_backfill_started_at`, `whapi_backfill_finished_at`, `whapi_backfill_stats jsonb` em `settings` (via linhas key/value).
2. **Edge function `whapi-history-backfill/index.ts**` — implementa o loop `chats → messages`, upsert `customers`, insert `conversations`, atualiza progresso em `settings.whapi_backfill_status`.
3. **Edge function `whapi-history-status/index.ts**` — GET simples que retorna o status/contadores para polling do frontend.
4. **Frontend:** card no admin (super admin) com botão **Importar histórico** + barra de progresso (chats processados / mensagens importadas / erros).
5. **Ajuste de config (fora de código):** atualizar `settings.whapi_connected_phone` para o número novo, e sobrescrever secret `WHAPI_TOKEN` para bater com `settings.whapi_token`.

### O que fica de fora (por segurança)

- Não vou apagar dados existentes de `customers`/`conversations`. Se o número já existe, faço merge preservando `consultant_id` atual e nunca sobrescrevo `bot_paused=false` para `true` em lead já ativo.
- Mídia binária (áudio/foto de conta) NÃO é baixada — só grava o link/URL da Whapi. Baixar tudo estouraria storage. Se quiser download, é uma segunda etapa opcional.
- Grupos WhatsApp (`chat_id` terminando em `@g.us`) são pulados — a plataforma trabalha com leads 1:1.

### Riscos

- Volume: se o canal tem 10k conversas × 200 msgs = 2M inserts → 30–90 min. Rodar em background e monitorar `whapi_backfill_status`.
- Se o webhook da Whapi ainda estiver apontando para outro canal, mensagens NOVAS não chegam. Verificar no dashboard.
- Reprocessar leads antigos com bot ativo enviaria promocional inesperado — por isso `bot_paused=true` é obrigatório.

---

## Confirmações antes de implementar

1. Confirmo `WHAPI_TOKEN = LjTJR3RhPthc1O0tKkSiP61zEfyqV21iLjTJR3RhPthc1O0tKkSiP61zEfyqV21i` e atualizo `whapi_connected_phone` para `+55 34 9823-9056`? Sim novo numero 
2. Todos os leads importados devem entrar com `bot_paused=true` (recomendado) ou você quer que o bot possa retomar automaticamente? Os importados sem bot apenas no manual
3. Importar histórico **completo** ou só dos últimos N dias (ex.: 90 dias)? Tudo que entrou no WhatsApp todos, não clientes importado do igreen
4. Vincular todos os leads importados a um consultor específico (id) ou deixar sem consultor até atribuição manual? Deixe manual vai ser tudo meu