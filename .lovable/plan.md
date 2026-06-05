# Resetar daily cap no "Resetar telefone"

## Causa raiz

Logs do `evolution-webhook` (16:59) mostram tudo bloqueado por `daily_cap_reached`:

```
🚫 [sender-guard] bloqueado kind=media reason=daily_cap_reached  (audio)
🚫 [sender-guard] bloqueado kind=media reason=daily_cap_reached  (video)
🚫 [sender-guard] bloqueado kind=text  reason=daily_cap_reached
```

`check_send_quota` consulta `public.instance_send_counters(instance_name, day, sent_count)`. Para `igreen-953f7e48509b` no dia `2026-06-05` há `sent_count = 20`, e a instância está no **warmup_day 1** cujo cap é **20**. O `admin_hard_reset_phone` zera o lead, mas **não** zera esse contador (que é por instância, não por telefone). Resultado: o 1º texto saiu, e tudo depois (áudio, vídeo, texto+botões) cai no guard.

A correção que acabamos de fazer no dispatcher do `evolution-webhook` está OK — ela não tem como ajudar quando o guard nega antes do envio.

## Mudança

Estender o RPC `admin_hard_reset_phone` para que, depois de identificar os `consultant_id`s afetados pelo telefone, também zere o contador de hoje das instâncias daqueles consultores. Sem mexer em warmup, risk signals, cap configurado nem na lógica do guard.

### Migration (uma só)

Recriar `public.admin_hard_reset_phone(_phone text)` mantendo todo o comportamento atual e adicionando, ao final, antes do `RETURN`:

```sql
-- Zera o contador diário de envios das instâncias dos consultores afetados,
-- para que o "Resetar telefone" libere imediatamente novos envios em testes.
WITH affected_consultants AS (
  SELECT DISTINCT consultant_id
  FROM public.customers
  WHERE id = ANY(v_customer_ids)              -- já calculado acima no RPC
),
affected_instances AS (
  SELECT wi.instance_name
  FROM public.whatsapp_instances wi
  JOIN affected_consultants ac ON ac.consultant_id = wi.consultant_id
)
DELETE FROM public.instance_send_counters
WHERE day = (now() AT TIME ZONE 'UTC')::date
  AND instance_name IN (SELECT instance_name FROM affected_instances)
RETURNING 1
-- contagem agregada vai para v_deleted->'instance_send_counters_today'
;
```

Acumular a contagem no JSON `deleted` que o RPC já devolve, sob a chave nova `instance_send_counters_today`, para o `HardResetPhoneCard` exibir no toast existente sem mudança de UI.

Os nomes exatos das variáveis internas (`v_customer_ids`, `v_deleted`, etc.) serão lidos do corpo atual do RPC antes de escrever a migration; o efeito final é o descrito acima.

### Frontend

Nenhuma alteração obrigatória. O toast `✅ Telefone zerado confirmado` já lista as chaves de `deleted`, então `instance_send_counters_today: 1` aparece sozinho.

### Fora de escopo

- Não muda `check_send_quota`, caps por warmup_day, `min_interval_ms`, nem `instance_risk_signals`.
- Não muda o dispatcher do `evolution-webhook` (já consertado na rodada anterior).
- Não toca em `whapi-webhook`, schema, RLS, ou no botão "Zerar" por-conversa do `ChatView` (ele é por lead, não por telefone admin).

## Validação

1. Rodar a migration (aprovação do usuário no fluxo padrão).
2. No `/admin`, clicar **Resetar telefone** em `11971254913`.
3. Conferir no toast a chave `instance_send_counters_today` ≥ 1.
4. Pelo WhatsApp, mandar `Oi` → `2` no número da instância e confirmar a sequência completa: **áudio → vídeo → texto + botões**.
5. Conferir nos logs do `evolution-webhook` ausência de `daily_cap_reached` e presença de `sendButtons ok=true`.

## Risco

- Baixo. O DELETE é restrito a `day = hoje` e às instâncias dos consultores do telefone resetado.
- Reset manual é uma ação admin já destrutiva; zerar o contador de hoje está alinhado com a expectativa de "deixar como se o lead nunca tivesse existido".
- Em produção real, se o operador resetar um telefone, ele também consome a proteção de cap daquele dia para a instância — aceitável porque o botão já é admin-only e usado para QA.
