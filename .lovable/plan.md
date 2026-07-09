# Protocolo profissional de atendimento

## Como o cliente vai ver (exemplo real)

Quando o lead manda a 1ª mensagem, o bot responde em **2 balões**:

**Balão 1 — Saudação institucional**

```
Olá, Muito Bom Dia! 👋
Esse é o canal de atendimento especializado da iGreen Energy.
```

**Balão 2 — Protocolo + pergunta de abertura ( não tem como posso ajudar )** 

```
━━━━━━━━━━━━━━━━━━━━━━
📋 Protocolo de atendimento
*RFD-260119-0042*
━━━━━━━━━━━━━━━━━━━━━
💚💚💚💚💚💚💚💚💚💚💚💚


```

A saudação (`Muito Bom Dia / Muita Boa Tarde / Muita Boa Noite`) é calculada pelo horário de São Paulo no momento da chegada.

## Formato do protocolo

`INICIAIS-YYMMDD-####`

- **INICIAIS (3 letras)**: iniciais do nome do parceiro que recebeu o lead no rodízio (ex.: Rafael Ferreira Dias → `RFD`). Se o lead cair fora do rodízio, usamos as iniciais do consultor, e como último fallback `IGR`.
- **YYMMDD**: data de chegada em SP (`260119` = 19/jan/2026).
- **####**: contador sequencial diário do próprio parceiro (`0001`, `0002`, …) — reinicia todo dia às 00:00 SP.

Vantagem: o parceiro consegue "ler" o protocolo (sabe que é dele, sabe o dia, sabe a ordem).

## Como não vamos nos perder — onde fica registrado

1. `**customers.tracking_protocol**` — protocolo gravado direto no cadastro do lead. Aparece no Kanban, no CRM e em qualquer busca.
2. `**partner_protocol_seq**` — tabela contadora `(partner_id, data)` que garante sequência única por parceiro/dia. É a "fonte da verdade" e evita colisão.
3. `**conversations**` — o balão 2 (com o protocolo) é salvo como mensagem outbound normal, então fica na timeline do lead.
4. **Notificação ao parceiro** — a mensagem que já mandamos ao parceiro (`notify-partner-leads-batch`) passa a citar o mesmo protocolo. Parceiro e cliente compartilham o mesmo código.
5. **Painel `/admin/protocolos**` (já existe) — passa a listar também os protocolos de atendimento, com filtro por parceiro/data e link para o lead.

## Como fica gerado (fluxo interno)

```text
Lead manda 1ª msg
    │
    ▼
Webhook cria customer (sem protocolo ainda)
    │
    ▼
Rodízio decide o parceiro
    │
    ▼
RPC generate_partner_protocol(partner_id, iniciais)
    │  ├─ INSERT/UPDATE em partner_protocol_seq (seq++)
    │  └─ RETURN "RFD-260119-0042"
    ▼
UPDATE customers.tracking_protocol
    │
    ▼
Envia balão 1 (saudação) → salva em conversations
Envia balão 2 (protocolo + pergunta) → salva em conversations
    │
    ▼
Bot flow normal continua a partir do próximo turno
```

Se o lead cair em revisão manual (sem parceiro), geramos o protocolo com iniciais do consultor e marcamos `needs_partner_review = true` — o admin pode reatribuir depois; o protocolo continua o mesmo.

## Arquivos a criar/editar

- **Migração**: coluna `customers.tracking_protocol`, tabela `partner_protocol_seq`, RPC `generate_partner_protocol(uuid, text)`.
- `**_shared/greeting.ts**`: `greetingForNow()` (horário SP) + `partnerInitials(name)`.
- `**_shared/protocol.ts**` (novo): `assignProtocolToCustomer(customerId, partnerId?)` — chama a RPC e faz `UPDATE customers`.
- `**_shared/welcome-header.ts**` (novo): monta os 2 balões e chama o adapter do canal (Evolution/Whapi) já resolvido para o customer.
- `**whapi-webhook/index.ts` + `evolution-webhook/index.ts**`: nos pontos onde hoje chamamos `notifyPartnerNewLead` (após rodízio decidir), adicionar:
  1. `assignProtocolToCustomer(...)`
  2. `sendWelcomeHeader(...)` — apenas na **primeira** interação do lead (checa `conversations` count == 1 inbound).
- `**notify-partner-leads-batch**`: incluir `tracking_protocol` na mensagem enviada ao parceiro.
- `**AdminProtocolsPage.tsx**`: acrescentar aba "Atendimento" listando `customers.tracking_protocol`.

## Regras de segurança

- RPC roda como `SECURITY DEFINER` com `search_path=public` e só recebe grants para `service_role`.
- Envio da saudação é **idempotente**: se `customers.tracking_protocol` já existe, não regenera nem reenvia (evita duplicar se o webhook processar 2x).
- Se o envio do balão falhar, o protocolo fica gravado mesmo assim (não bloqueia a conversa).

## Não faz parte deste plano

- Trocar formato dos protocolos de campanha (`FB-XXXXX`) que já existem em `facebook_campaigns` — esse continua igual, é outro escopo.
- Migração retroativa dos leads antigos — só os novos a partir do deploy recebem protocolo.