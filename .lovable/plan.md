## Análise das mudanças

Commit `be7aa4a88 "Added retry & hint flow"` está no repositório com as 6 alterações do turno anterior:

**Backend (edge — precisa deploy):**
- `supabase/functions/start-customer-attendance/index.ts` — retry 1× + `fixHint` + mensagens específicas
- `supabase/functions/end-customer-attendance/index.ts` — mesmo tratamento

**Frontend (auto-publica no próximo update):**
- `src/lib/attendanceShortcut.ts` (novo)
- `src/hooks/useCustomerAttendance.ts`
- `src/components/captacao/runFastStartAttendance.ts`
- `src/components/captacao/CaptacaoPanel.tsx`

## Status do deploy

- Busca em logs de `start-customer-attendance` por `fixHint` → **0 ocorrências**. Confirma que a versão nova das edges **ainda NÃO está em produção**.
- Segundo `.kiro/steering/deploy.md`, edge functions só sobem via workflow_dispatch do GitHub Actions (`deploy-edge-functions.yml`). Não há trigger automático em push.
- Working tree limpo, então nada perdido — só falta disparar o deploy.

## O que fazer

1. Disparar deploy só das 2 funções alteradas (evita rebuild geral):
   - `start-customer-attendance`
   - `end-customer-attendance`
   
   Usando o caminho já documentado em `.kiro/steering/deploy.md` (curl no workflow_dispatch com token do git credential helper), 1 chamada por função.

2. Acompanhar os 2 runs até `conclusion=success`.

3. Validar no Supabase:
   - `edge_function_logs` de cada função procurando `fixHint` após 1 clique real em Iniciar/Finalizar atendimento, OU
   - Chamar via `supabase--curl_edge_functions` com payload inválido e conferir que a resposta traz `fixHint` no JSON (prova que a versão nova está viva).

4. Frontend não precisa de ação extra — publica junto no próximo Update do preview.

## Fora de escopo

- Nenhuma mudança de código nesta rodada. Só deploy + verificação.
- Se algum dos 2 deploys falhar, aí sim abro plano de correção com o log específico.
