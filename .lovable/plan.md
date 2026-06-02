## Objetivo
Garantir que o fluxo público variante D (Fluxo Whapi - botões) funcione 100% no Evolution, onde não há botões interativos do WhatsApp Business. Hoje as transições só batem por palavra-chave; quando o lead digita `1`, `2` ou `3` (resposta natural sem botão), nenhuma transição é acionada e ele cai no fallback.

## Solução
Migração SQL idempotente que percorre todos os steps do fluxo público variante D (super-admin, `is_public=true`, `variant='D'`) e injeta variações numéricas nos `trigger_phrases` de cada transição, na ordem em que aparecem (1ª transição → "1", 2ª → "2", 3ª → "3").

Variações adicionadas por posição (mantendo as palavras-chave existentes):
- Posição 1: `"1"`, `"1)"`, `"1."`, `"um"`, `"primeira"`, `"primeiro"`
- Posição 2: `"2"`, `"2)"`, `"2."`, `"dois"`, `"segunda"`, `"segundo"`
- Posição 3: `"3"`, `"3)"`, `"3."`, `"três"`, `"tres"`, `"terceira"`, `"terceiro"`

## Regras
1. Aplica somente ao fluxo público variante D do super-admin (não toca fluxos próprios de consultores nem outras variantes).
2. Idempotente: se o número já estiver em `trigger_phrases`, não duplica (usa `array(select distinct ...)`).
3. Preserva todas as palavras-chave atuais (cashback, energia, indicação etc.) — só adiciona.
4. Só atua em steps com `transitions` não-vazias; não cria transição onde não existe.
5. Não altera o fallback (4ª+ transição ignorada — se um step tem 4+ saídas, só as 3 primeiras ganham número, padrão WhatsApp).

## Validação pós-migração
- Query de verificação contando steps atualizados e mostrando 3 exemplos de transitions com os novos `trigger_phrases`.
- Confirmação de que `runConversationalFlow` (motor já em produção) faz match exato e normalizado (lower/trim) — não precisa mudar código.

## Detalhes técnicos
- Tabela: `bot_flow_steps` (coluna `transitions jsonb`).
- Filtro de fluxo: `flow_id IN (select id from bot_flows where is_public=true and variant='D')`.
- Update com `jsonb_set` em loop por índice de transição usando função PL/pgSQL temporária (ou CTE com `jsonb_agg`).
- Nenhum schema novo; nenhum código TS alterado; nenhum redeploy de edge function necessário.

## Fora de escopo
- Não altera fluxos privados de outros consultores (eles herdam o público).
- Não altera variantes A/B/C.
- Não mexe no `evolution-webhook` nem no `whapi-webhook`.
