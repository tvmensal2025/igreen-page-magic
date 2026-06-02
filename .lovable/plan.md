## Escopo

Apagar do banco TODOS os leads marcados como teste/warmup/simulador e seus dados relacionados, em **todos os consultores**. Encontrei pelo menos:

- `is_test_lead = true` → **25 leads**
- `is_sandbox = true` → **8 leads**
- nome contém `Test`, `Warmup`, `Simulad`, `Simulator`, `Simular`, `JornadaTest`, `TraceTest`, `FinalTest`, `Lead Real Simulado`, `TestVariantA/B`, etc. → **34 leads**
- telefone com padrão fake `550000…`, `5555…`, `1111…` → **43 leads**

Total único estimado: ~50 customers (há sobreposição entre os filtros). Exemplos confirmados na consulta: `Lead Teste E E`, `TestVariantA #3`, `Maria Silva (sandbox)`, `Test_D_Mapping`, `FinalTest`, `Test1..Test15`, `Simular`, `JornadaTest`, `Lead Real Simulado`.

## O que vou apagar (migration única, `ON DELETE CASCADE` cuidando do resto)

Definir um `WITH targets AS (...)` que seleciona os `customer_id` que casam com qualquer um dos critérios abaixo, e então `DELETE` em cascata:

```sql
WITH targets AS (
  SELECT id FROM customers
  WHERE is_test_lead = true
     OR is_sandbox   = true
     OR name ILIKE '%test%'
     OR name ILIKE '%warmup%'
     OR name ILIKE '%simulad%'
     OR name ILIKE '%simulator%'
     OR name ILIKE '%simular%'
     OR phone_whatsapp LIKE '550000%'
     OR phone_whatsapp LIKE '5555%'
     OR phone_whatsapp LIKE '1111%'
     OR phone_whatsapp LIKE '0000%'
)
DELETE FROM crm_deals      WHERE customer_id IN (SELECT id FROM targets);
DELETE FROM lead_insights  WHERE customer_id IN (SELECT id FROM targets);
DELETE FROM whatsapp_messages WHERE customer_id IN (SELECT id FROM targets);   -- se existir
DELETE FROM customers      WHERE id IN (SELECT id FROM targets);
```

Antes de submeter a migration final, vou listar exatamente quais tabelas referenciam `customers(id)` para incluir todas no DELETE e não deixar órfão.

## Proteções

- A query **NÃO** toca em `customer_origin = 'igreen_sync'` a menos que ele também esteja marcado como teste (`is_test_lead`/`is_sandbox`). Clientes iGreen reais ficam intactos.
- A query **NÃO** apaga por palavra-chave em telefone real (`+55 11 9...`); só padrões claramente fake (`550000…`, `5555…`, `1111…`, `0000…`).
- Nada é apagado em `consultants`, `flow_definitions`, `message_templates`, `network_members` etc.

## Confirmação que peço

**Confirma que posso executar?** Vou rodar primeiro um SELECT mostrando a contagem exata por tabela afetada, depois a migration de DELETE.