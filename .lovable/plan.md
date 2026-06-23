## Problema

Quando a conta de luz tem CEP + cidade, a IA ainda pergunta o CEP de novo. Hoje só existe a busca **reversa** (endereço → CEP). Falta a busca **direta** (CEP → rua/bairro/cidade/UF) para fechar automaticamente todos os campos.

## O que vou mudar

### 1. `autoResolveCepIfNeeded` (whapi-webhook + evolution-webhook)
Adicionar segundo ramo: se o próximo passo é `ask_cep` mas o cliente **já tem CEP válido salvo** (8 dígitos, não terminado em 000), pular ask_cep e fazer ViaCEP direto (`https://viacep.com.br/ws/<cep>/json/`) para preencher `address_street`, `address_neighborhood`, `address_city`, `address_state` quando vazios. Depois recalcular `getNextMissingStep`.

Também: se `ask_cep` vier mas `address_city` + `address_state` existirem sem CEP, manter o comportamento atual (reversa).

### 2. OCR pós-extração (whapi-webhook ~linha 3760, evolution-webhook ~linha 3430)
Hoje: se OCR não retornou CEP, busca reversa.
Adicionar: se OCR **retornou CEP válido** mas faltam street/bairro/cidade/UF, fazer ViaCEP direto e preencher só os campos vazios (preserva o que o OCR já capturou).

### 3. Helper compartilhado
Criar `buscarEnderecoPorCep(cep)` em `supabase/functions/_shared/utils.ts` (mesmo arquivo onde mora `buscarCepPorEndereco` e `TIMEOUT_VIA_CEP`). Retorna `{ logradouro, bairro, localidade, uf } | null`. Reusada por whapi-webhook, evolution-webhook e pelo próprio case `ask_cep`.

### 4. Reaproveitar no `ask_cep` existente
O case `ask_cep` (linha 5307 whapi, 4911 evolution) hoje tem fetch ViaCEP inline. Trocar pelo helper novo para ficar uma fonte única.

## Resultado esperado

- Conta com CEP + cidade no OCR → bot **não pergunta CEP**, vai direto pra `ask_number`.
- Conta só com cidade (sem CEP legível) → continua usando busca reversa atual.
- Conta sem nada de endereço → continua perguntando CEP normalmente.
- CEP terminado em 000 (genérico de cidade) → continua pedindo manual, como hoje.

## Arquivos tocados

- `supabase/functions/_shared/utils.ts` — novo helper `buscarEnderecoPorCep`.
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts` — `autoResolveCepIfNeeded`, bloco OCR, case `ask_cep`.
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts` — mesma coisa (paridade).

Nenhuma mudança no frontend, em tabelas ou em RLS.