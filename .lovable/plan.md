# Plano — Refino do protocolo de atendimento + clareza do matching de campanha

## Decisões confirmadas
1. **Protocolo de atendimento** passa para `IGR-{SIGLA_PARCEIRO}-{SEQ4}` (ex.: `IGR-RFF-0042`).
2. **Matching de campanha no rodízio** continua com `2026-####` embutido no `initial_message` do anúncio Meta — só vamos reforçar a distinção visual/documental.

## O que muda no código

### 1. Novo formato do protocolo do parceiro
- Atualizar RPC `generate_partner_protocol` (migration): retornar `IGR-{initials3}-{seq4}` onde:
  - `initials3` = `short_code` do parceiro se existir (truncado/padded para 3), senão 3 iniciais do nome (ex.: Rafael Ferreira Ferreira → `RFF`).
  - `seq4` = sequência **global por parceiro** (não zera por dia — assim `IGR-RFF-0042` é único e cresce ao longo do tempo, estilo Zendesk).
- Manter compat: se vier `PPP-YYMMDD-####` antigo em customer.tracking_protocol, continua válido (não reescreve).
- Atualizar `supabase/functions/_shared/protocol.ts`:
  - Fallback local também no formato novo `IGR-{initials}-{4chars}`.
  - Comentário do topo atualizado.

### 2. Reforçar clareza dos DOIS protocolos na UI
- Em `AdminProtocolsPage.tsx` (painel de protocolos):
  - Adicionar cabeçalho explicativo com 2 cards lado-a-lado:
    - **Protocolo da Campanha (matching)** — `2026-####` — "vai no anúncio Meta, o cliente envia, casa com a campanha e dispara o rodízio"
    - **Protocolo de Atendimento (ticket)** — `IGR-XXX-####` — "gerado por nós quando abre o atendimento; é o número do chamado do cliente"
  - Deixa visualmente óbvio que são coisas diferentes.
- Em `notify-partner-leads-batch` e `notify-consultant`: nas mensagens onde o protocolo aparece, rotular como "📋 Chamado: *IGR-RFF-0042*" (em vez de só "Protocolo:") — evita confusão com o código da campanha.

### 3. Regex/parser
- `campaign-tracking.ts` continua igual — regex `2026-####` só reconhece protocolo de campanha, não confunde com `IGR-RFF-0042`.
- Adicionar constante `SERVICE_TICKET_RE = /\bIGR-[A-Z0-9]{3}-\d{4}\b/` para eventuais buscas por ticket no futuro (sem uso obrigatório agora).

### 4. Migração de dados existentes
- Não reescrever tickets já emitidos (`RFF-260709-0001` etc. permanecem — é histórico do cliente).
- Só novos protocolos daqui pra frente saem no formato `IGR-RFF-0042`.

## Detalhes técnicos

**Migration:**
```sql
-- Nova função: sequência global por parceiro (não por dia)
CREATE OR REPLACE FUNCTION public.generate_partner_protocol_v2(
  _partner_id uuid, _initials text
) RETURNS text ...
-- usa referral_partners.protocol_seq como contador incremental
ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS protocol_seq int DEFAULT 0;
```

**protocol.ts:**
- Trocar chamada de `generate_partner_protocol` → `generate_partner_protocol_v2`.
- Normalizar `initials`: uppercase, só A-Z/0-9, exatamente 3 chars (pad com `X` se curto).

## Arquivos afetados
- `supabase/migrations/…` (nova migration)
- `supabase/functions/_shared/protocol.ts`
- `supabase/functions/_shared/campaign-tracking.ts` (só adicionar constante)
- `supabase/functions/notify-partner-leads-batch/index.ts` (label "Chamado")
- `supabase/functions/_shared/notify-consultant.ts` (label "Chamado")
- `src/pages/AdminProtocolsPage.tsx` (cards explicativos)

## Fora do escopo
- Não vou mexer em: injeção do `2026-####` nos anúncios, resolver de campanha, rodízio, ou lógica de pool.
