
## Diagnóstico real

O log do turno 13:36 mostrou:
- bot respondeu (não ficou só "digitando")
- mas usou `engine: sys` (legado hardcoded `welcome → qualificacao`), não o fluxo D

Comparando flags dos 2 consultores no banco:

| Consultor | `conversational_flow_enabled` |
|---|---|
| Rafael (superadmin) | `true` ✅ |
| tvmensal01 | `false` ❌ |

No `evolution-webhook/index.ts:1353` há um gate que força o motor `flow` (que executa `bot_flow_steps` do fluxo D) somente quando `conversational_flow_enabled = true`. Com `false`, cai no legado. Por isso o fluxo D do tvmensal01 — apesar de existir, estar `is_active=true`, com 16 passos cloneados — nunca foi acionado.

Sobre "número no lugar de botão": **já está correto**. Evolution v2 removeu `sendButtons` (página da doc dá 404); só `sendList` é estável. O adapter `_shared/channels/evolution.ts` declara `supportsButtons:false, supportsList:true` e `sendChoice` renderiza texto numerado — funciona em qualquer aparelho. A variante D em `_shared/engine/variants/d.ts` também já cobre esse caso. Nada a mexer aqui.

O plano anterior (flipar `flow_reliability_v2='on'`) **estava errado** — esse flag controla rate-limit/dedup, não o motor de fluxo. Não vou aplicá-lo.

## Correção

### 1. Ligar `conversational_flow_enabled=true` para o tvmensal01

```sql
UPDATE public.consultants
   SET conversational_flow_enabled = true
 WHERE id = '953f7e48-509b-4069-9822-bdad9902be09';
```

(Rafael já está true — não toco.)

### 2. Zerar o estado do customer 937defb9 (mesma operação de antes)

Necessário porque o turno legado de 13:36 gravou `conversation_step='qualificacao'`:

```sql
UPDATE public.customers
   SET conversation_step = NULL,
       previous_conversation_step = NULL,
       custom_step_retries = 0,
       custom_step_retries_step = NULL,
       last_custom_prompt_at = NULL,
       ai_followups_count = 0,
       chat_cleared_at = now()
 WHERE id = '937defb9-e206-4779-9855-92753883cf08';

DELETE FROM public.ai_slot_dispatch_log
 WHERE customer_id = '937defb9-e206-4779-9855-92753883cf08';

DELETE FROM public.customer_flow_state
 WHERE customer_id = '937defb9-e206-4779-9855-92753883cf08';
```

### 3. Tornar o seed do fluxo D também ligar a flag

Hoje a função `seed_default_camila_flow()` (rodada quando consultor novo é criado) clona o fluxo D do Rafael mas não ativa `conversational_flow_enabled` no consultor — replica o bug. Ajustar para que, ao clonar, também faça:

```sql
UPDATE public.consultants
   SET conversational_flow_enabled = true
 WHERE id = <consultant_id>
   AND conversational_flow_enabled IS DISTINCT FROM true;
```

Assim, todo consultor novo já nasce com o motor `flow` ligado e o fluxo D executando de cara.

### 4. Verificação no log

Após Rafael mandar `Oi`, esperar nos logs do `evolution-webhook`:
- `🚀 [router] forçado para flow (consultor=953f7e48..., step legado="welcome")`
- `engineUsed: "flow"`
- envio em sequência: áudio do `d_welcome` (slot público do Rafael que foi marcado `is_public=true`) + texto do step + se houver `choices`, **texto numerado** (correto para Evolution).

Se aparecer `delegate_legacy_runBotFlow` ou `engine: sys`, é regressão — anota e investigamos.

## Não escopo

- Não vou ligar `flow_engine_v3='on'` nem `use_engine_v3=true` — o V3 é a próxima geração e não é necessário para o fluxo D rodar hoje.
- Não vou mexer em `flow_reliability_v2` — não tem relação com motor.
- Não vou alterar adapter Evolution — capabilities e renderização numerada já estão corretas conforme a doc oficial.
