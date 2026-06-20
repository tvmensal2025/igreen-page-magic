# Plano revisado: cada lead fica preso ao canal/instância que o iniciou

## Regra de ouro (definida pelo usuário)

> "Se o cliente iniciou naquela instância, o OTP e o final têm que ser sempre naquela."

Nada de fallback automático Evolution → Whapi superadmin. Cada consultor tem **sua** instância (Evolution própria **ou** Whapi própria) e o lead vive e morre nela. Se a instância caiu, o sistema **não troca de canal** — ele alerta o consultor para religar e segura a mensagem até voltar.

## Causa-raiz do caso SUELI

1. `resolveChannel` escolhe Evolution por existir linha em `whatsapp_instances`, **sem** olhar `status`. A instância do consultor estava `needs_reconnect` desde 15/05 → todo envio falha com `Connection Closed`.
2. Não existe coluna no `customers` que registre **em qual canal/instância o lead entrou**. Hoje cada chamada re-resolve por consultor e pode escolher errado se o consultor tiver mais de uma instância no futuro.
3. Watchdog B fica re-tentando OTP expirado para sempre, gerando ruído.

## Mudanças

### 1. Schema — gravar canal de origem no lead

Adicionar em `public.customers`:

- `origin_channel text` — `'evolution'` ou `'whapi'`
- `origin_instance_name text` — nome exato da instância (ex.: `igreen-0c2711ad4836` ou `whapi-<id>`)
- `origin_consultant_id uuid` — redundância segura para auditoria

Preenchidos **uma vez**, no primeiro inbound (webhook do canal), e **nunca alterados** depois. Migration faz backfill com o melhor palpite atual (instance do consultor) só para leads existentes.

### 2. `resolveChannel` passa a ser "bind por lead", não por consultor

Nova assinatura:

```ts
resolveChannelForCustomer(supabase, customerId, env): Promise<ResolvedChannel | null>
```

- Lê `origin_channel` + `origin_instance_name` do `customers`.
- Monta o adapter exato dessa instância (Evolution OU Whapi, conforme gravado).
- **Nunca** troca de tipo. Se a instância está fora do ar (`status NOT IN ('connected','online','open')` ou `fatal_lock_until > now()`), retorna `{ unavailable: true, reason }` em vez de cair para outro canal.
- A versão legada `resolveChannel(consultantId)` é mantida só para fluxos que ainda não têm `customerId` (ex.: notificação ao consultor), mas marcada como `@deprecated` para envios a clientes.

### 3. Inbound webhooks gravam o canal de origem

- `whapi-webhook` → ao criar/atualizar customer, faz `upsert` com `origin_channel='whapi'` e `origin_instance_name=<instância whapi do consultor>` **só se NULL** (idempotente).
- `evolution-webhook` → mesma lógica com `origin_channel='evolution'` e o `instance_name` do payload.

### 4. Watchdog C (link facial) — usa o canal do lead e segura quando offline

- Chama `resolveChannelForCustomer(customerId)`.
- Se `unavailable`:
  - **Não tenta enviar** (não polui logs com `Connection Closed`).
  - Grava `last_portal_error='instance_offline:<instance>'` e `last_portal_dispatch_at=now()`.
  - Insere um alerta em `bot_handoff_alerts` (severity `high`, tipo `instance_offline_blocking_delivery`) com o telefone do consultor — para ele saber que precisa reconectar para o lead receber o link.
  - Continua tentando a cada ciclo, mas com backoff exponencial (já existe).
- Quando voltar online → envia normalmente e marca `link_facial_sent_at`.

### 5. Watchdog B (OTP) — auto-expirar quando worker disser "expirado"

Quando worker devolver `"Código inválido ou expirado"`:

- Limpar `otp_code` e `otp_received_at`.
- Manter `status='awaiting_otp'`.
- Disparar mensagem ao cliente pelo **canal de origem** pedindo um novo código (texto curto: "Seu código expirou. Por favor, peça um novo no Portal e me envie aqui.").
- Se a instância de origem estiver offline → mesma trilha do item 4 (alerta ao consultor, sem trocar canal).

### 6. Hotfix SUELI (manual, já finalizada)

Via `supabase--insert`:

- `link_facial_sent_at = now()` (para watchdog C parar).
- `otp_code = NULL`, `otp_received_at = NULL` (para watchdog B parar).
- Backfill: `origin_channel='whapi'`, `origin_instance_name='<whapi instance do consultor>'` (confirmar nome exato antes).

## Arquivos a editar

- **Migration** — adicionar 3 colunas em `customers` + índice em `(origin_instance_name)` + backfill condicional.
- `supabase/functions/_shared/channel-sender.ts` — nova função `resolveChannelForCustomer`, marcar `resolveChannel` como deprecated para envios a cliente.
- `supabase/functions/whapi-webhook/index.ts` — gravar origem no primeiro inbound.
- `supabase/functions/evolution-webhook/index.ts` (e/ou `handlers/`) — gravar origem no primeiro inbound.
- `supabase/functions/portal-otp-watchdog/index.ts` — bucket B (auto-expira OTP) + bucket C (usa `resolveChannelForCustomer` e gera alerta em vez de spammar).
- (data) Hotfix SUELI via insert tool.

## Fora de escopo

- Múltiplas instâncias por consultor (modelo atual = 1 consultor → 1 instância; o schema acima já suporta crescer).
- Mudar canal mid-flow (proibido pela regra do usuário).
- Reescrever editor de fluxo / Portal 1.

## Pergunta única antes do build

Para o alerta do item 4 (instância offline bloqueando entrega), o ideal é também **mandar WhatsApp pro próprio consultor** avisando "religue a instância, o lead X está parado"? Posso usar a Whapi superadmin **só para esse aviso ao consultor** (não ao cliente final), ou prefere apenas alerta no painel sem WhatsApp? pode mandar aviso

&nbsp;