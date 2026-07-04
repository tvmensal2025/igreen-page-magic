
# Plano: Auto-recriação de instância Evolution em falha grave

## Contexto
Hoje, quando o Evolution devolve `connection.close` com 401/403/440 (sessão banida pelo WhatsApp), o sistema só marca `needs_reconnect` e agenda uma reconexão em 30s no mesmo `instance_name`. Como o WhatsApp já invalidou aquela sessão, o QR nunca mais autentica — o correto é **descartar a instância morta e criar uma nova**.

## Objetivo
Ao detectar desconexão fatal no Evolution, deletar a instância no servidor Evolution e criar automaticamente uma nova instância vinculada ao mesmo consultor/chip, deixando pronto para o usuário só escanear o QR.

Escopo: **apenas Evolution**. Whapi permanece como está (reautorização manual no painel Whapi).

## Comportamento novo

```text
connection.close recebido
        │
        ▼
statusReason ∈ {401, 403, 440}  ──não──►  fluxo atual (needs_reconnect + reconnect 30s)
        │ sim
        ▼
recreate_instance(consultantId, oldInstanceName)
   1. DELETE  /instance/delete/{oldInstanceName}   (Evolution)
   2. gerar novo nome: `${base}-${YYYYMMDDHHmm}`
   3. POST /instance/create  (mesmo webhook, settings)
   4. UPDATE whatsapp_instances: novo instance_name, status='awaiting_qr',
      needs_reconnect=false, fatal_lock_until=NULL, manual_review_required=false
   5. registrar em admin_audit_log: action='auto_recreate_instance'
   6. POST /instance/connect  → devolve QR
   7. notifica frontend via realtime (channel já existente)
```

## Alterações

### 1. Edge function — nova rota utilitária
`supabase/functions/evolution-instance-reconnect/recreate.ts` (novo) exportando `recreateInstance(supabase, instanceRow)`. Reusa o cliente Evolution já existente em `_shared/evolution-api.ts`.

### 2. Handler de desconexão
`supabase/functions/evolution-webhook/handlers/connection.ts`
- Quando `state === "close"` e `statusReason` for 401/403/440 (ou `reason` contiver `logged_out`/`banned`), chamar `recreateInstance` em vez de agendar reconexão simples.
- Para demais códigos (ex.: 500, timeout), manter o fluxo atual.

### 3. UI — SuperAdmin
`src/components/superadmin/WhatsAppInstanceHealthCard.tsx`
- Adicionar coluna "Última recriação" (lida de `admin_audit_log` filtrado por `action='auto_recreate_instance'`).
- Adicionar botão manual **"Recriar instância"** que dispara a mesma função (fallback humano).

### 4. UI — Consultor
`src/components/whatsapp/*` (tela de conexão do consultor)
- Toast "Sua instância foi renovada, escaneie o novo QR" quando o `instance_name` muda via realtime.
- Sem mudança de fluxo — o componente de QR já reage a `status='awaiting_qr'`.

### 5. Migração SQL
Nenhuma tabela nova. Apenas garantir que `admin_audit_log` aceita `action='auto_recreate_instance'` (é texto livre, ok).
Opcional: índice em `admin_audit_log(target_id, action, created_at DESC)` para a listagem no card.

## Detalhes técnicos
- **Rate limit**: só recriar se a última recriação automática foi há > 15min (evita loop se o chip estiver realmente queimado). Após 3 recriações em 24h, para e marca `manual_review_required=true` para intervenção humana.
- **Idempotência**: usar `instance_id` (uuid interno) como chave — o `instance_name` do Evolution muda, mas a linha em `whatsapp_instances` é a mesma.
- **Preservação**: manter `consultant_id`, `phone_number`, contadores (`send_counters`), webhooks e settings.
- **Whapi**: nenhuma mudança.

## Fora do escopo
- Trocar de canal (Evolution → Whapi) automaticamente.
- Recriação preventiva por sinais de risco (só reage a `close` fatal).
- Fluxo Whapi.
