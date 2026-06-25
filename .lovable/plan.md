# Limpeza de duplicatas em `flow_router_rules`

## Objetivo
Remover 6 regras duplicadas idênticas que apontam para `fluxo_a_cadastro` com a keyword `"fazer o cadastro"`, mantendo apenas a regra com label completo.

## Por que é seguro
- **Flow D (Cadastro Rápido) não usa `flow_router_rules`** — é disparado por OCR de foto da conta de luz. Intocado.
- O router (`_shared/flow-router.ts`) **retorna no primeiro match**, então as 6 duplicatas nunca são alcançadas. São código morto.
- Todas as 7 linhas têm `priority`, `target_flow_key`, `trigger_keywords` e `consultant_id` idênticos — comportamento pós-limpeza é bit-a-bit igual.
- Nenhum código em `_shared/`, `whapi-webhook/` ou `evolution-webhook/` referencia os UUIDs específicos das regras.

## Ação única
Executar um `DELETE` na tabela `flow_router_rules`:

```sql
DELETE FROM flow_router_rules
WHERE target_flow_key = 'fluxo_a_cadastro'
  AND id <> '3a993b41-8263-4c96-b128-3a0fbccdcb50';
```

Mantém a regra `3a993b41-8263-4c96-b128-3a0fbccdcb50` (label `"Fluxo A — Cadastro direto"`) e apaga as outras 6.

## O que NÃO muda
- Código de Flow D, Flow A, Flow B, Flow PJ — nenhum arquivo editado.
- Guard `in_cadastro_pipeline` no router — preservado.
- Regex de intenção (`NON_NAME_RESPONSES`, `isPositiveCheckinIntent`) — preservadas.
- Schema da tabela — sem migration, só dados.

## Verificação pós-execução
Query de confirmação:
```sql
SELECT id, target_flow_label, trigger_keywords
FROM flow_router_rules
WHERE target_flow_key = 'fluxo_a_cadastro';
```
Deve retornar exatamente 1 linha.
