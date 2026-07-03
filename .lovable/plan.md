## Diagnóstico atualizado

Rodei querys no banco e olhei os runs. O redeploy passou, mas o sync **ainda está travando** por 3 razões:

1. **Timeout da edge function.** Os 4 runs mais recentes (12:01, 12:07, 12:13, 12:15 UTC) estão presos em `status='running'` sem nunca finalizar. Motivo: o novo enrich sem filtro chama `fetchCustomerFull` para os 159 clientes com throttle de 200ms + latência 400ms cada = **90-120s só de enrich**. Somando login + kanban + network + boletos + persistência, estoura o teto de ~150s da edge function e o processo morre **antes** de chamar `persistCustomers`. Nada é gravado. Por isso Matias Brito continua ausente e os 400 órfãos continuam sem `fora_da_carteira`.
2. **100 de 159 clientes falham no upsert** nos runs antigos que finalizaram (`errors: 100, updated: 59, processed: 159`). Não temos os `failed_samples` gravados no `counts` — só nos logs, que já rotacionaram. Precisa investigar caso a caso (provavelmente colisão em índice único `phone_whatsapp` sem `consultant_id` ou algum trigger).
3. **Enriquecimento serial.** Mesmo dentro do worker, o loop de enrich é sequencial (`await` um por um) — desperdício e é o gargalo #1.

## O que o plano vai fazer

### 1. Separar sync em duas fases (resolve o timeout)

**Fase A — persist básico (rápido, <60s):**

- Edge chama o worker com `enrich=false` (só kanban + network + metrics + boletos + devolutivas).
- Persiste TODOS os 159 clientes imediatamente. **Matias Brito aparece no banco na hora.**
- Roda `markOutOfPortfolio` — 400 órfãos ficam com `situacao_igreen='fora_da_carteira'`.
- Retorna 200 pro chamador.

**Fase B — enrich em background:**

- Antes de retornar, edge dispara `EdgeRuntime.waitUntil(enrichPhase(...))` que:
  - Chama o worker `/enrich-batch` (novo endpoint) passando lista de `codigos` em blocos de 30.
  - Cada bloco preenche `address_street`, `cep`, `pj_jsonb`, etc. via `applyCustomerDetails`.
  - Roda até acabar ou até 100s (dentro do teto).
- Se sobrar cliente sem enrich, um novo run pega — ou o cron diário completa.

### 2. Paralelizar `fetchCustomerFull` no worker

- Trocar o loop sequencial por `Promise.all` em janelas de **6 requests concorrentes** (mantém ~15 req/s, dentro do que o portal aguenta sem 429).
- Novo endpoint `POST /enrich-batch` no worker: recebe `{portal_email, portal_password, codigos: [...]}`, devolve `details[]`. Timeout interno 90s.
- Mantém o `enrich=true` no `/sync-all` como fallback, mas com `enrich_limit=30` default para não estourar timeout se alguém chamar direto.

### 3. Investigar os 100 upserts que falham

- Adicionar `failed_samples` ao `counts.customers` (já existe na função, só falta incluir no JSON final que grava em `igreen_sync_runs`).
- Rodar um sync, ler os 10 samples, entender o padrão de erro e corrigir (provavelmente um dos: `phone_whatsapp` NULL após dedupe, constraint em `cpf` único global, ou trigger de `crm_deals`).

### 4. Limpar runs presos

- Marcar como `status='failed'` os 4 runs `running` de hoje que estão travados (via insert tool com UPDATE), para o painel não mostrar "sync em andamento" eternamente.

## Verificação pós-implementação

1. Disparar `sync-igreen-customers` do Rafael.
2. Em 60s: `SELECT count(*) FROM customers WHERE consultant_id='0c27...' AND customer_origin='igreen_sync' AND situacao_igreen!='fora_da_carteira'` → esperado **159**.
3. Confirmar Matias Brito (código 1578934) presente.
4. Em 3 minutos: `SELECT count(*) FILTER (WHERE address_street IS NOT NULL)` → esperado **>140** (enrich pode ter alguns 404 no portal).
5. Rodar novamente o sync — segunda passada preenche os que faltaram.
6. `errors` no `counts` deve ir a **0** depois do fix dos upserts.

## Arquivos tocados

- `worker-igreen-sync/server.mjs`: novo endpoint `/enrich-batch`, paralelização com janela de 6, throttle atualizado.
- `supabase/functions/sync-igreen-customers/index.ts`: separar fase A (persist) da fase B (`EdgeRuntime.waitUntil` chamando `/enrich-batch` em loop de chunks), incluir `failed_samples` no `counts`.
- **Sem migrations novas.** Colunas já existem.

## Pergunta antes de executar

Confirma que posso:

- (a) Marcar os 4 runs travados como `failed` agora (sem esperar mais). 
- (b) Redeploy do worker precisará ser feito por você de novo no Easypanel depois dessas mudanças. OK? Ok