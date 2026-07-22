## Diagnóstico — o número parece certo, mas está morto na operadora

Você olha e lê "+55 (34) 99708-1920". Bate com o padrão de celular MG. O problema é que **essa linha não existe mais na rede móvel** — a Velip e a operadora de SMS confirmaram isso de forma independente, no mesmo dia:

| Timestamp (21/07) | Canal | Resultado |
|---|---|---|
| 12:05 | SMS #1 | enviado → **UNDELIV** (não entregue) |
| 14:05 | Ligação A_CALL | Velip devolveu **`IK` = número inexistente** |
| 17:10 | SMS #2 | **UNDELIV** |
| 17:40 | SMS #3 | **UNDELIV** |
| 22:55 | SMS #4 | **UNDELIV** |

Dois provedores diferentes (voz e SMS) responderam "esse chip não está registrado". Isso é o padrão clássico de um **número WhatsApp-only**: o cliente trocou de chip/operadora e o WhatsApp continua funcionando (a Meta guarda a conta), mas ligação e SMS caem no vazio.

Detalhe extra que reforça isso: em `customers.phone_whatsapp` o número está salvo como `553497081920` (12 dígitos, **sem o 9**). O `normalizeBrazilPhone` injeta o 9 automaticamente antes de discar. Se o cliente cadastrou o número antigo (pré-obrigatoriedade do 9º dígito) e nunca refez o chip, a linha voz/SMS pode ter sido desativada há anos — só o WhatsApp sobreviveu.

**Conclusão:** o motor fez o certo. Já suprimiu automaticamente as próximas ligações (guard IK), e agora ele está no `voice_dnc_list` (backfill de ontem). Não vai queimar mais saldo com esse contato via voz/SMS. **WhatsApp continua indo normalmente** — que é o único canal que provavelmente entrega.

## Blindagem SMS/Call — para não repetir com os próximos

Hoje o guard só reage **depois** de queimar 1 ligação ou 1 SMS. Dá pra ficar mais esperto sem ficar paranóico. Proposta em 4 camadas, ordenadas por retorno:

### 1. Cross-channel suppression (SMS ↔ Voz)

Hoje IK/EK na voz bloqueia a próxima voz, mas **não bloqueia o SMS** — por isso esse lead levou 3 UNDELIV depois do IK. Estender o guard:

- No `cadence-tick`, antes de enfileirar `SMS_*`, checar se o mesmo telefone já tem `voice_dnc_list` (fonte `velip_reproved`) **ou** ≥ 2 SMS `UNDELIV` nas últimas 72h. Se sim: pula SMS, mantém WhatsApp.
- Simétrico no lado da voz: 2 SMS `UNDELIV` seguidos → não gastar ligação, WhatsApp-only.
- **Efeito estimado nos 6 leads IK atuais:** economia de ~18 SMS + 6 retries de voz.

### 2. Auto-DNC do SMS (hoje só existe pra voz)

Callback SMS com `delivery_status='UNDELIV'` ≥ 2 vezes → upsert em `voice_dnc_list` com `source='sms_undeliv'`. O painel "Números inválidos" já lista isso porque lê o DNC — só precisa passar a alimentar.

### 3. Marcar o lead como "WhatsApp-only" (não é DNC total)

Quando voz + SMS falham no mesmo telefone, **não é** para colocar no "não perturbe" geral. É para marcar `customers.channels_disabled = ['voice','sms']` (coluna nova, ou reaproveitar `do_not_contact_channels` se existir), e o `cadence-tick` já filtra por canal antes de agendar. Assim:

- A jornada A/B/C continua rodando pelo WhatsApp
- Painel do consultor mostra badge "só WhatsApp — voz/SMS inválidos"
- Não some do CRM, não vira DNC total

### 4. Validação leve no cadastro (barato, opcional)

- Numero com 12 dígitos e DDD ≥ 30 (SP=11, RJ=21, MG=31…) e começando com padrão de fixo (2/3/4/5) → tratar como landline, **não** injetar 9, marcar `voice_only`.
- Numero com 12 dígitos onde o 5º dígito começa com 6/7/8/9 → provável celular pré-9, injetar 9 mas marcar `phone_needs_verification` para o consultor conferir.
- Zero custo de API, é só regex.

### O que **não** vou mexer

- Não vou tirar o `normalizeBrazilPhone` — ele acerta em 95%+ dos casos e o comportamento atual (injetar 9) está certo.
- Não vou desligar o SMS globalmente para leads antigos — o UNDELIV é raro (~2% da base).
- Sem novas chamadas a API paga (HLR/lookup) — o próprio comportamento da Velip/SMS já entrega esse sinal de graça, é só usar melhor.

## Arquivos a tocar

- `supabase/functions/cadence-tick/index.ts` — estender o guard atual (já bloqueia voz por IK) para também consultar SMS UNDELIV e vice-versa antes de agendar `SMS_*`/`CALL_*`.
- `supabase/functions/voice-dialer-webhook/index.ts` — já grava DNC para IK/EK/BK; adicionar o mesmo tratamento no callback SMS (função `voice-sms-send` ou webhook Velip de SMS).
- `src/components/admin/InvalidPhonesPanel.tsx` — separar visualmente "voz inválida", "SMS inválido" e "ambos → WhatsApp-only".
- Migration (nova coluna opcional): `customers.channels_disabled text[]` **ou** aproveitar coluna existente equivalente — vou verificar antes de escrever.

## Pergunta

Toco nos 4 itens de uma vez, ou você prefere só o **(1) + (2)** — que é a proteção real contra desperdício — e deixa o **(3) marcação WhatsApp-only** e **(4) validação no cadastro** para uma segunda rodada?
