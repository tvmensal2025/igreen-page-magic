# Corrigir `media_consumo` errado do OCR (BRUNO: 555 kWh → ~1.433 kWh)

## Princípio
**Worker-portal-2 é a fonte oficial e SEMPRE valida primeiro.** O bot/OCR é coadjuvante: se o worker discordar do valor salvo, o valor do worker prevalece e sobrescreve o DB.

## Mudanças

### 1. `worker-portal-2/server.mjs` — validador primário (PRIORIDADE MÁXIMA)
Antes de enviar ao portal iGreen, sempre roda sanity-check:

```text
ratio = electricity_bill_value / media_consumo
faixa esperada: 0.70 ≤ ratio ≤ 1.60 (R$/kWh realista p/ B1)

se fora da faixa:
  consumo_corrigido = round(electricity_bill_value / 1.10)
  clamp(100, 2000)
  → usa consumo_corrigido no POST /customers
  → UPDATE customers SET media_consumo = consumo_corrigido,
       ocr_consumo_rejeitado = true,
       ocr_consumo_original = <valor antigo>
  → log estruturado: [portal2][sanity] customer=X valor=Y consumo_ocr=Z ratio=W → corrigido=N
```

Isso garante que **mesmo que o bot já tenha salvo um valor errado**, o cadastro oficial sai certo.

### 2. `supabase/functions/_shared/ocr.ts` — validador secundário (defesa em profundidade)
Em `extractBillData`, após Gemini retornar `consumomedio`:
- Se `valorConta` presente e `ratio` fora de `[0.70, 1.60]` → descarta OCR e usa `round(valorConta/1.10)`.
- Loga `[ocr][sanity] rejected=<n> reason=ratio=<r> fallback=<n2>`.

### 3. `supabase/functions/whapi-webhook/handlers/bot-flow.ts` + `evolution-webhook/handlers/bot-flow.ts`
No bloco que persiste `media_consumo` após OCR (linhas ~3432-3439 do whapi):
- Mesmo sanity-check antes do `UPDATE customers`.
- Se rejeitado, salva o valor estimado e marca `ocr_consumo_rejeitado=true`.

### 4. Melhorar prompt Gemini em `_shared/ocr.ts:131`
Adicionar:
- "O valor R$/kWh realista no Brasil B1 é R$ 0,80 a R$ 1,50. Se o consumo dividir o valor total fora dessa faixa, você escolheu o campo errado."
- "NÃO use: demanda contratada (kW), consumo de fase isolada, ou histórico de meses específicos. Use SEMPRE a média dos últimos 12 meses ou o consumo do mês faturado."

### 5. Migration — adicionar colunas de auditoria + corrigir BRUNO
```sql
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS ocr_consumo_rejeitado boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ocr_consumo_original integer;

-- Reprocessar BRUNO (11971254913): 1576.34/1.10 ≈ 1433
UPDATE customers
SET ocr_consumo_original = media_consumo,
    media_consumo = 1433,
    ocr_consumo_rejeitado = true
WHERE phone_whatsapp LIKE '%11971254913%'
  AND media_consumo = 555;
```

> Observação: o cadastro do BRUNO já foi aceito no portal (idcliente=1524093) com 555 kWh. A correção no DB é para histórico/relatórios; **não** vamos re-submeter ao portal (geraria duplicidade). O fluxo correto só vale para próximos leads.

## Ordem de execução
1. Migration (colunas + UPDATE BRUNO).
2. `_shared/ocr.ts` (validador secundário + prompt melhorado).
3. `bot-flow.ts` whapi + evolution (sanity antes do UPDATE).
4. `worker-portal-2/server.mjs` (validador primário — sobrescreve DB se necessário).
5. Deploy edge functions + redeploy worker-portal-2.

## Não-objetivos
- Não mexer no worker-portal (Portal 1 / digital).
- Não re-submeter cadastros já aprovados.
- Não alterar regras de bonus/desconto (continua `desconto_padrao=true`).
