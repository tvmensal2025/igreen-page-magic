## Ideia

Cada lead que chega no WhatsApp recebe **imediatamente** um Protocolo gerado por nós — no estilo do exemplo iGreen (`489486961`) — que embute as iniciais da **chave do parceiro** que vai atender. A saudação do bot é dinâmica pelo horário (**Bom dia / Boa tarde / Boa noite**). Nada depende mais do Meta preservar `welcome_message`.

## Formato do Protocolo

```
{INICIAIS_CHAVE}-{YYMMDD}-{SEQ4}
Ex.: RFD-260119-0042
```

- `INICIAIS_CHAVE`: 3 letras extraídas da **chave iGreen do parceiro do rodízio** (ex.: `RAFAELFERREIRADIAS` → `RFD`). Fallback = 3 primeiras letras do nome sem acento.
- `YYMMDD`: data local (America/Sao_Paulo) da criação do lead.
- `SEQ4`: sequencial diário atômico por parceiro (`0001`, `0002`…), gerado por RPC — garante unicidade e rastreabilidade.

Assim, olhando o protocolo, admin sabe **na hora**: quem atendeu, em que dia, e qual foi o número do atendimento do dia.

## Primeira mensagem do bot

Substitui o texto atual pelo padrão inspirado no exemplo:

```
Olá, Muito Bom Dia! 👋
Esse é o canal de atendimento especializado da iGreen Energy.

━━━━━━━━━━━━━━━━━━━━━━
📋 Protocolo de atendimento
*RFD-260119-0042*
━━━━━━━━━━━━━━━━━━━━━
 💚💚💚💚💚💚💚💚💚💚💚💚
```

Saudação por hora local: `05–11 Bom dia · 12–17 Boa tarde · 18–04 Boa noite`.

Sempre Vai ser Muito Bom Dia, Muita Boa Tarde, Muita Boa Noite. Sempre um olá e nao pode errar, nao vai ter a pergunta, pq sempre vai vir um fluxo apos essa mensagem 

## O que muda no código

1. **Migração**
  - `customers.tracking_protocol text` + índice único por consultor.
  - Nova RPC `generate_partner_tracking_protocol(_partner_id uuid)` que devolve `INICIAIS-YYMMDD-SEQ4` com sequencial atômico (tabela `partner_protocol_seq(partner_id, day, last_seq)`).
2. **Helper `_shared/campaign-tracking.ts**`
  - `partnerInitials(partner)` — extrai 3 letras da `igreen_key`/nome.
  - Atualizar `ensureCampaignTrackingProtocol` para aceitar `partnerId` e chamar a nova RPC.
  - Ajustar `TRACKING_PROTOCOL_RE` para reconhecer o novo formato.
3. **Helper novo `_shared/greeting.ts**`
  - `greetingForNow(tz='America/Sao_Paulo')` → `"Bom dia" | "Boa tarde" | "Boa noite"`.
4. **Webhooks (`whapi-webhook`, `evolution-webhook`)**
  - Após decidir o parceiro pelo rodízio (ou fallback super-admin), gerar o protocolo com esse `partnerId`, gravar em `customers.tracking_protocol` e em `campaign_match_log.protocol`.
  - Substituir a primeira resposta do bot pelo template acima (usando `greetingForNow()` + `formatProtocolBlock()`).
  - Idempotente: só gera se `tracking_protocol IS NULL`.
5. **Notificação ao parceiro**
  - `notifyPartnerNewLead` passa a incluir o protocolo do lead no aviso ("Protocolo: RFD-260119-0042"), pra o parceiro citar ao cliente.

## Detalhes técnicos

- Sequencial atômico via `INSERT ... ON CONFLICT (partner_id, day) DO UPDATE SET last_seq = last_seq + 1 RETURNING last_seq`.
- Sem mexer em creatives no Meta — welcome_message continua como está, mas o sistema não confia mais nele.
- Formato antigo (`2026-0042`, `FB-87321`) continua sendo reconhecido para retrocompat.
- Fuso horário fixo `America/Sao_Paulo` via `Intl.DateTimeFormat` (Deno suporta).
- Testes unitários: `greetingForNow` (bordas 04:59/05:00/11:59/12:00/17:59/18:00) e `partnerInitials` (nomes com acento, 1 palavra, 2 palavras, chave alfanumérica).

## Fora de escopo

- Tela admin para listar/buscar protocolos (fica pra depois).
- Regerar protocolos históricos.
- Alterar UX do parceiro (`/consultor`).