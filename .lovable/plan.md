# Etapa 2 — Balões separados + botão "Iniciar atendimento"

## O que o cliente vai ver quando cair da campanha

Nada é enviado automaticamente na chegada. O lead entra silencioso no painel do consultor com o protocolo já gerado (Etapa 1). O primeiro disparo só acontece quando o consultor clica **Iniciar atendimento** — aí saem **2 balões separados** no WhatsApp:

**Balão 1 — Saudação institucional**
```
Olá, Muito Bom Dia! 👋
Esse é o canal de atendimento especializado da iGreen Energy.
```

**Balão 2 — Protocolo + pedido de nome (sem "como posso ajudar")**
```
━━━━━━━━━━━━━━━━━━━━━━
📋 Protocolo de atendimento
*RFD-260119-0042*
━━━━━━━━━━━━━━━━━━━━━

Para começarmos, me conta seu nome completo? 🙂
```

Saudação calculada por horário de SP no momento do clique. Sem "como posso ajudar" — o próximo passo é sempre pedir o nome, que já casa com o fluxo de captação (`askLeadName`).

## Botão "Iniciar atendimento"

Novo botão verde no topo da ficha do lead (ChatView) **e** no card do Kanban de Conversão, visível quando:
- lead veio de campanha (`source_campaign_id` preenchido) **ou** `origin_channel` = whapi/evolution **e**
- ainda não recebeu saudação (`welcome_sent_at IS NULL`).

Depois de clicar, o botão some e vira um selo "Atendimento iniciado às HH:MM · protocolo RFD-260119-0042".

Clique dispara `start-customer-attendance` (nova edge) que:
1. Garante protocolo via `assignProtocolToCustomer` (idempotente — Etapa 1).
2. Monta os 2 balões com `greetingForNow()` + protocolo.
3. Envia pelo canal certo (Whapi/Evolution) resolvido pelo `consultant_id`.
4. Grava as duas mensagens em `conversations` como outbound normal (aparecem na timeline).
5. Marca `customers.welcome_sent_at = now()` e `name_ask_sent_at = now()` (para não repedir nome depois).
6. Coloca `conversation_step = 'ask_name'` e `capture_mode = 'manual'` (painel de captação já abre sozinho — regra existente).

Idempotente: se `welcome_sent_at` já existe, retorna 200 sem reenviar.

## Regras importantes

- **Nunca dispara sozinho** quando o lead cai da campanha — só depois do clique do consultor. Isso resolve o "não tem como posso ajudar devido…".
- **Não usa mais** a saudação automática que a Etapa 1 injetava no webhook. O webhook continua gerando o protocolo e o rodízio no fundo, mas o envio dos 2 balões passa a ser 100% pelo botão.
- Se o lead **responder antes** do consultor clicar (raro, mas acontece com Meta), o webhook faz o mesmo disparo automaticamente (fallback) — assim ninguém fica sem saudação.
- **Pedido de nome unificado**: o balão 2 já é o próprio "pedir nome". Não dispara `askLeadName` de novo em cima.

## Onde muda no código

- **Novo**: `supabase/functions/_shared/welcome-header.ts` — monta os 2 balões e envia pelo canal (Whapi/Evolution).
- **Novo**: `supabase/functions/start-customer-attendance/index.ts` — endpoint chamado pelo botão. Valida consultor dono do lead, chama `assignProtocolToCustomer`, chama `welcome-header`, atualiza `customers`.
- **Migração**: adicionar `customers.welcome_sent_at timestamptz` (idempotência).
- **Edit** `supabase/functions/whapi-webhook/index.ts` e `evolution-webhook/index.ts`: remover o disparo automático de saudação da Etapa 1; manter só a geração de protocolo + rodízio. Adicionar fallback "se lead responder antes do consultor iniciar, envia saudação agora".
- **Edit** `src/pages/WhatsAppClientsPage.tsx` (ChatView) e `src/components/admin/conversao/ConversaoCockpit.tsx` (card do lead): botão **Iniciar atendimento** + selo pós-clique. Usa `supabase.functions.invoke("start-customer-attendance", { body: { customerId } })`.
- **Reuso**: `askLeadName` e o painel de captação continuam iguais — apenas passam a considerar `name_ask_sent_at` para não pedir 2x.

## Fora do escopo

- Fluxos de reativação e mensagem em massa (continuam com o header próprio).
- Mudar formato do protocolo ou o rodízio (Etapa 1 já resolveu).
