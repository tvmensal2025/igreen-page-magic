# Fix: OCR não captura consumo médio (kWh) → worker-portal-2 falha com `/bonus/rules 404`

## Diagnóstico

Rastreei o lead `146137eb-8c3b-4bd8-b014-7e2d4f3e30a8` (BRUNO MANOEL):

- Banco hoje: `media_consumo = NULL`, `electricity_bill_value = 1576.34`, `distribuidora = "CPFL PIRATININGA"`, `address_state = SP`, `address_city = SALTO`, conta PDF salva inline.
- Logs do whapi mostram que o fluxo conversacional rodou inteiro, `ocrContaEnergia` (Gemini) executou e gravou nome, endereço, CEP, distribuidora, valor, número da instalação.
- **Mas a função `ocrContaEnergia` (`supabase/functions/_shared/ocr.ts:95`) não extrai o campo `consumoMedio` (kWh)** — o prompt pede 10 campos e nenhum deles é o consumo.
- Por isso o worker-portal-2 recebe `c.media_consumo = NULL`. Ele tenta chamar `/bonus/rules` da iGreen com `consumo_medio=0`, a API rejeita com 404 “Consumo médio não informado. Regras de UF=SP, concessionária=CPFL PIRATININGA exigem consumo mínimo de 100 kWh”.
- O `worker-portal-2/server.mjs` tem fallback (OCR via `/extractor/extract-receipt` ou estimativa `valor/1,10`), mas no log do job 11 não aparece a linha `📄 OCR fatura: chamando…` — o build em produção no Easypanel está sem o fallback (deploy antigo). Como esse repo é deployado fora do Lovable, a solução robusta é alimentar `media_consumo` ANTES de disparar o worker.

## Mudanças

### 1. `supabase/functions/_shared/ocr.ts` — `ocrContaEnergia`

- Adicionar campo `11. CONSUMO MÉDIO em kWh` ao prompt (instruir o Gemini a buscar “Consumo medido (kWh)”, “Média kWh”, “Histórico de consumo — média”, “Consumo do mês (kWh)” — comum na CPFL/Enel/Light).
- Atualizar o JSON de saída para incluir `"consumoMedio":""`.
- Sanitizar: extrair só dígitos, aceitar 50–5000 kWh; valores fora da faixa viram `""`.

### 2. `supabase/functions/whapi-webhook/handlers/bot-flow.ts` (bloco do OCR da conta, ~linha 3243-3257)

- Após `updates.electricity_bill_value = …`, gravar `updates.media_consumo = parseInt(d.consumoMedio) || null`.
- Se o OCR não trouxer kWh mas houver `electricity_bill_value ≥ 30`, calcular fallback `Math.round(valor / 1.10)` clampeado em 100–2000 e gravar em `media_consumo` (mesma heurística do worker-portal-2). Marcar `media_consumo_source = 'estimated_from_value'` (campo novo? — apenas se já existir; senão omitir).
- Não bloquear o fluxo se `consumoMedio` faltar: é tolerância, não validação obrigatória.

### 3. Paridade Evolution

O `supabase/functions/evolution-webhook/handlers/bot-flow.ts` provavelmente tem o mesmo bloco OCR — aplicar o mesmo patch lá (verificar antes; se for o mesmo arquivo compartilhado, apenas um patch).

### 4. Backfill do lead atual

Migration única para resolver o BRUNO já encalhado:
```sql
UPDATE public.customers
SET media_consumo = GREATEST(100, LEAST(2000, ROUND(electricity_bill_value / 1.10)))
WHERE id = '146137eb-8c3b-4bd8-b014-7e2d4f3e30a8' AND media_consumo IS NULL;
```
Isso destrava o reenvio do job 11 sem precisar do worker-portal-2 redeployado.

## Fora de escopo

- Redeploy do `worker-portal-2`: não rodamos esse repo pelo Lovable. Fica como TODO operacional separado (subir o build atual no Easypanel pra ter o fallback `/extractor/extract-receipt` também).
- Mudar UI dos botões do passo #3 ou tokens da IA — foi tudo na rodada anterior, segue intacto.

## Detalhes técnicos

- Não toco em RLS, schema (exceto UPDATE do backfill) nem em qualquer regra de negócio do desconto.
- O parser de kWh respeita formato BR (“1.234 kWh” → 1234) e ignora valores absurdos (>5000 ou <50) — protege contra alucinação do Gemini.
- Edge functions `whapi-webhook` e `evolution-webhook` são redeployadas automaticamente.
