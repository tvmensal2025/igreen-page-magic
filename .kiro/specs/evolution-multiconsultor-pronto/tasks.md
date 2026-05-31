# Implementation Plan

## Overview

Plano de implementação dos 5 workstreams do `design.md`, na **ordem de rollout do menor para o maior raio de impacto (blast-radius)**: **REQ 1 (kill switch)** → **REQ 3 (resolução de fluxo)** → **REQ 2 (seed variante D)** → **REQ 5 (guarda IDOR)** → **REQ 4 (RLS WITH CHECK)**. Cada workstream é um grupo de tarefas de topo; cada propriedade de correção vira uma tarefa de teste.

Princípios codificados nas tarefas:

- **Não auto-aplicável + aprovação humana:** nenhuma migração, política RLS ou redeploy de webhook é aplicado automaticamente.
- **Backup ANTES / rollback documentado:** toda mudança de banco/RLS (REQ 2 e REQ 4) tem sub-tarefa de backup antes e sub-tarefa de rollback documentado depois.
- **Validação dual-channel:** toda mudança de webhook (REQ 1 e REQ 3) é validada no Evolution e confirmada como não-regressiva no Whapi (A/B/D do Rafael).
- **Sem perturbar o Rafael:** REQ 2 não re-executa nenhum backfill de todos os consultores e verifica que as linhas do Rafael ficam inalteradas (idempotência).

### Nota de ordenação por ondas (wave-ordering)

As tarefas são agendadas em ondas (ver **Task Dependency Graph** no fim). Como `supabase/functions/evolution-webhook/index.ts` é tocado por **três** mudanças distintas — a guarda do kill switch (REQ 1, tarefa 1.1), a resolução determinística de fluxo (REQ 3, tarefa 2.1) e a injeção do header `x-service-secret` na chamada interna (REQ 5, tarefa 5.2) — essas três edições ficam em **ondas diferentes** (wave 0, wave 1 e wave 2) para evitar conflito no mesmo arquivo. O segredo `SERVICE_SHARED_SECRET` (5.1) e o header na chamada interna (5.2) são provisionados **antes/junto** de aplicar a guarda em `ai-agent-router` (5.6), para que a chamada interna continue funcionando.

## Tasks

- [x] 1. REQ 1 — Kill switch global no Evolution (apenas edge function; fail-open)
  - [x] 1.1 Inserir a guarda do kill switch no `evolution-webhook`
    - Em `supabase/functions/evolution-webhook/index.ts`, **reutilizar** `isBotGloballyEnabled` de `supabase/functions/_shared/bot/global-flag.ts` (não criar helper novo)
    - Adicionar `import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";`
    - Inserir a guarda no topo do handler `Deno.serve`, logo após criar o client supabase `service_role` e **antes** do `await req.json()` / processamento, espelhando `whapi-webhook/index.ts` (~linha 62): `if (!(await isBotGloballyEnabled(supabase as any))) { return Response 200 { ok: true, msg: "bot_globally_disabled" } com corsHeaders }`
    - Manter o `as any` (mesmo workaround de pinning já usado em `isConsultantAIDisabled`); a guarda fica **antes** da guarda por-consultor `isConsultantAIDisabled`
    - Fail-open garantido pelo próprio helper (try/catch → `true`); zero outbound quando desabilitado; nunca 5xx
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x]* 1.2 Escrever property test para o gating do kill switch
    - **Property 1: Kill switch desliga todo outbound no Evolution**
    - **Validates: Requirements 1.1, 1.3**
    - Extrair a decisão de gating para uma função pura testável em um **módulo separado** (não re-editar `evolution-webhook/index.ts`); entrada: estado da flag incluindo o caso de erro; saída: `{ enabled, outboundAllowed }`
    - fast-check + Vitest, ≥100 iterações; tag `// Feature: evolution-multiconsultor-pronto, Property 1`
    - Sender mockado: afirmar contador de chamadas outbound = 0 quando desabilitado, e `enabled=true` no ramo de erro (fail-open)
    - _Properties: 1_

  - [x]* 1.3 Escrever teste de exemplo + smoke estático para REQ 1
    - Exemplo (1.2): `bot_global_enabled=true` → o handler segue além da guarda (1–2 eventos representativos)
    - Smoke estático (1.4): presença da guarda no topo de `evolution-webhook/index.ts` e paridade de semântica com o whapi
    - _Requirements: 1.2, 1.4_

  - [x] 1.4 Validação dual-channel da mudança de webhook (REQ 1)
    - Validar no canal **Evolution** (instância de teste): kill switch off → fluxo normal; kill switch on → zero outbound e resposta neutra
    - Confirmar **não-regressão no Whapi** do Rafael (variantes A/B/D): nenhum arquivo de `whapi-webhook` foi tocado e o baseline A/B/D responde idêntico
    - Pré-rollout gated por aprovação humana; backup = artefato anterior da função (rollback por redeploy)
    - _Requirements: 1.4, 6.2, 6.3, 6.5, 6.6_

- [x] 2. REQ 3 — Resolução de fluxo ativo robusta (apenas edge function; espelha o Whapi)
  - [x] 2.1 Tornar determinística a resolução de fluxo nos DOIS sites do `evolution-webhook`
    - Em `supabase/functions/evolution-webhook/index.ts`, editar **ambos** os sites:
      - **Site A** — bloco `isOpeningTurn` (~linhas 1052–1057)
      - **Site B** — bloco "FONTE ÚNICA DE VERDADE" (~linhas 1300–1305)
    - Substituir `.eq("is_active", true).maybeSingle()` pelo padrão determinístico do Whapi (~linha 1445): derivar `const variant = (customer as any)?.flow_variant || "A";`, consultar `bot_flows` com `.eq("consultant_id", instanceData.consultant_id).eq("is_active", true).eq("variant", variant).order("created_at", { ascending: true }).limit(1)` e tomar `rows[0]` (`activeFlows?.[0] || null`)
    - Resultado: retorna **no máximo 1 fluxo**, **nunca lança** para 0/1/N fluxos ativos; preserva o `try/catch` existente como defesa
    - Sem mudança de DB; manter espelho inline 1:1 com o Whapi (decisão de design: inline em vez de delegar a `resolveFlowId` de `_shared/resolve-flow.ts`, para minimizar superfície e manter paridade)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x]* 2.2 Escrever property test para o seletor de fluxo
    - **Property 2: Resolução de fluxo é determinística, única e nunca lança**
    - **Validates: Requirements 3.1, 3.2, 3.4**
    - Extrair/colher o seletor como função pura sobre `(flows[], variant)` em módulo separado; gerar conjuntos com 0/1/N fluxos, variantes e `created_at` aleatórios
    - Afirmar: retorna ≤1, nunca lança, **invariante à permutação** da entrada, escolhe o menor `created_at` da variante do cliente, e **coincide com o seletor de referência do whapi-webhook** (model-based)
    - fast-check + Vitest, ≥100 iterações; tag `// Feature: evolution-multiconsultor-pronto, Property 2`
    - _Properties: 2_

  - [x]* 2.3 Escrever teste de exemplo para detecção da etapa de abertura
    - Exemplo (3.3): fluxo resolvido com steps → opening step = primeiro step ativo por `position`
    - Não-regressão: consultor com 1 único fluxo ativo na variante do cliente resolve normalmente
    - _Requirements: 3.3_

  - [x] 2.4 Validação dual-channel da mudança de webhook (REQ 3)
    - Validar no canal **Evolution**: consultor com 1 fluxo resolve; consultor com N fluxos resolve 1 fluxo determinístico (sem cair no welcome legado)
    - Confirmar **não-regressão no Whapi** do Rafael (A/B/D): seletor idêntico ao já usado no Whapi; rodar baseline e confirmar paridade
    - Pré-rollout gated por aprovação humana; rollback por redeploy do artefato anterior
    - _Requirements: 3.4, 6.2, 6.3, 6.5, 6.6_

- [x] 3. Checkpoint — webhooks (REQ 1 + REQ 3)
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. REQ 2 — Consultor novo nasce na variante padrão D (1 migração focada)
  - [x] 4.1 Backup ANTES da mudança de seed/default
    - Capturar e anexar ao PR/rollback: `pg_get_functiondef('public.seed_default_camila_flow'::regprocedure)` e o `DEFAULT` atual de `public.consultants.active_variants` (`ARRAY['A'::text]`)
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 4.2 Criar a migração única e focada (seed + default), NÃO auto-aplicável
    - Criar **um único** arquivo de migração em `supabase/migrations/` que:
      - `CREATE OR REPLACE FUNCTION public.seed_default_camila_flow(...)` idêntica à atual, alterando **apenas** o `INSERT INTO public.bot_flows` para incluir `variant => 'D'` (`VALUES (_consultant_id, 'Fluxo da Camila', 'D', true, false)`); manter o `SELECT` de reuso (idempotência) e os 6 `bot_flow_steps` inalterados
      - `ALTER TABLE public.consultants ALTER COLUMN active_variants SET DEFAULT ARRAY['D'::text];` (afeta **apenas novas inserções**)
    - **NÃO** alterar o default de `public.bot_flows.variant` (fonte de verdade é o seed; evita drift)
    - **NÃO** replicar o bloco `DO $$ ... seed_default_camila_flow(r.id) ... $$` de backfill de todos os consultores — escopo é **apenas novas inserções**
    - Não usar `apply_migration` automaticamente; aplicar somente após aprovação humana explícita, primeiro em banco isolado/branch
    - _Requirements: 2.1, 2.2, 2.3, 6.1, 6.3, 6.4_

  - [x]* 4.3 Escrever teste de integração para o seed na variante D
    - **Property 3: Consultor novo nasce provisionado na variante D**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - Banco isolado (PGlite snapshot, como em `flow-diagram-view/migration-15-3-validation.md`, ou branch Supabase): inserir consultor novo → afirmar exatamente 1 `bot_flow` ativo `variant='D'` e `active_variants` contém `'D'`
    - **Idempotência:** re-chamar `seed_default_camila_flow` para o mesmo consultor → não cria fluxo adicional
    - **Rafael inalterado:** snapshot das linhas do Rafael (id `0c2711ad-4836-41e6-afba-edd94f698ae3`) pré/pós migração → byte-idênticas; confirmar que nenhum backfill de todos os consultores rodou
    - Aplicar o rollback no banco isolado e confirmar função/coluna restauradas
    - tag `// Feature: evolution-multiconsultor-pronto, Property 3`
    - _Properties: 3_
    - _Requirements: 2.3, 6.6_

  - [x] 4.4 Documentar o rollback da migração REQ 2
    - Registrar no arquivo/PR: restaurar o corpo anterior da função (`INSERT` sem `variant`) e `ALTER TABLE public.consultants ALTER COLUMN active_variants SET DEFAULT ARRAY['A'::text];`
    - _Requirements: 2.4, 6.2_

- [x] 5. REQ 5 — Guarda IDOR em 5 edge functions service_role (helper + segredo)
  - [x] 5.1 Provisionar o segredo de ambiente `SERVICE_SHARED_SECRET`
    - Provisionar `SERVICE_SHARED_SECRET` como segredo de ambiente das edge functions (header `x-service-secret`), sem literal no código nem em logs
    - Deve existir **antes** de aplicar a guarda em `ai-agent-router` (5.6) para a chamada interna continuar válida
    - _Requirements: 5.8_

  - [x] 5.2 Fazer o `evolution-webhook` enviar `x-service-secret` na chamada interna ao `ai-agent-router`
    - Em `supabase/functions/evolution-webhook/index.ts`, na invocação interna de `ai-agent-router`, adicionar o header `x-service-secret: SERVICE_SHARED_SECRET` (lido de `Deno.env`)
    - Aplicar **antes/junto** da guarda em 5.6 para que a chamada interna permaneça funcionando (modo `service` dispensa posse)
    - _Requirements: 5.3, 5.7, 5.8_

  - [x] 5.3 Implementar o helper compartilhado `_shared/caller-auth.ts` (primeiro)
    - Criar `supabase/functions/_shared/caller-auth.ts` com `resolveCaller(req, admin)` e `assertOwnership(caller, target, admin)` conforme contrato do design
    - `resolveCaller`: header `x-service-secret` == `SERVICE_SHARED_SECRET` (comparação em **tempo constante**) → `{ mode: "service" }`; senão `Authorization: Bearer <jwt>` válido via `anonClient.auth.getUser` + `has_role` → `{ mode: "jwt", consultantId, isAdmin }`; senão `Response 401` (sem efeito colateral)
    - `assertOwnership`: `service` → ok; admin → ok; `customerId` → busca `customers.consultant_id` (inexistente/malformado → 400; outro consultor → 403; bate → ok); `consultantId` → diverge → 403, ausente/malformado → 400, igual → ok
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 5.4 Aplicar a guarda em `capture-extract`
    - No topo do handler de `supabase/functions/capture-extract/index.ts`: `const caller = await resolveCaller(req, admin); if (caller instanceof Response) return caller;` seguido de `const deny = await assertOwnership(caller, { customerId/consultantId }, admin); if (deny) return deny;` **antes** de qualquer leitura/gravação/efeito colateral
    - Preservar o comportamento funcional atual para chamadas legítimas
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6, 5.7_

  - [x] 5.5 Aplicar a guarda em `upload-documents-minio`
    - Mesmo padrão em `supabase/functions/upload-documents-minio/index.ts`, antes de qualquer efeito colateral
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6, 5.7_

  - [x] 5.6 Aplicar a guarda em `ai-agent-router`
    - Mesmo padrão em `supabase/functions/ai-agent-router/index.ts`; a chamada interna do `evolution-webhook` (5.2) passa `x-service-secret` → resolve como `mode: "service"` e é aceita
    - Depende de 5.1 (segredo) e 5.2 (header na chamada interna) já estarem prontos
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 5.7 Aplicar a guarda em `ai-sales-agent`
    - Mesmo padrão em `supabase/functions/ai-sales-agent/index.ts`, antes de qualquer efeito colateral
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6, 5.7_

  - [x] 5.8 Aplicar a guarda em `facebook-capi`
    - Mesmo padrão em `supabase/functions/facebook-capi/index.ts`, antes de qualquer efeito colateral
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6, 5.7_

  - [x]* 5.9 Escrever property test para `resolveCaller`
    - **Property 5: resolveCaller classifica o chamador corretamente**
    - **Validates: Requirements 5.1, 5.4**
    - Mockar `auth.getUser` e `has_role`; gerar combinações de header (token presente/ausente/válido/inválido × segredo presente/ausente/correto/incorreto)
    - Afirmar classificação `service`/`jwt`/`401` e **ausência de efeito colateral** no ramo 401
    - fast-check + Vitest, ≥100 iterações; tag `// Feature: evolution-multiconsultor-pronto, Property 5`
    - _Properties: 5_

  - [x]* 5.10 Escrever property test para `assertOwnership`
    - **Property 6: assertOwnership autoriza apenas dono, admin ou serviço**
    - **Validates: Requirements 5.2, 5.3, 5.5, 5.6**
    - Mockar o lookup de `customers.consultant_id`; gerar pares chamador/alvo (`service`, admin, dono, outro dono, id ausente/malformado/inexistente)
    - Afirmar ok/403/400 conforme a regra e **nenhuma mutação** nos ramos de negação
    - fast-check + Vitest, ≥100 iterações; tag `// Feature: evolution-multiconsultor-pronto, Property 6`
    - _Properties: 6_

  - [x]* 5.11 Escrever testes de exemplo/Deno por função
    - Exemplo (5.7) por função: 1 chamada JWT legítima (dono) e 1 chamada interna com `x-service-secret` válido seguem funcionando
    - `deno test` por função verificando os códigos 401/403/400/200 e a invocação interna `evolution-webhook → ai-agent-router` com segredo
    - _Requirements: 5.7_

  - [x]* 5.12 Smoke estático do segredo (higiene)
    - Confirmar (5.8) que `SERVICE_SHARED_SECRET` é lido de `Deno.env`, sem literal no código e sem log do valor
    - _Requirements: 5.8_

- [x] 6. Checkpoint — migração REQ 2 + guardas IDOR REQ 5
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. REQ 4 — `WITH CHECK` no UPDATE de `customers` (1 migração RLS focada)
  - [x] 7.1 Backup ANTES das políticas RLS de `customers`
    - Capturar via `pg_policy` (ou `pg_policies`) as definições de **todas** as políticas de `public.customers` e anexar ao PR/rollback
    - _Requirements: 4.4, 6.1, 6.2, 6.3_

  - [x] 7.2 Criar a migração única DROP/CREATE de `Owner update customers`, NÃO auto-aplicável
    - Criar **um único** arquivo de migração em `supabase/migrations/`: `DROP POLICY "Owner update customers" ON public.customers;` seguido de `CREATE POLICY "Owner update customers" ON public.customers FOR UPDATE TO authenticated USING (consultant_id = auth.uid()) WITH CHECK (consultant_id = auth.uid());`
    - **Preservar intactas todas as outras políticas** (inclusive `Assigned consultant update customers` e os acessos de admin/líder/manager)
    - Não usar `apply_migration` automaticamente; aplicar somente após aprovação humana explícita, validando antes com roles simuladas
    - _Requirements: 4.1, 4.2, 4.3, 6.1, 6.3, 6.4_

  - [x]* 7.3 Escrever teste de integração RLS para `WITH CHECK`
    - **Property 4: UPDATE em customers não pode reatribuir consultant_id**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - Integração com roles simuladas (`set_config('request.jwt.claim.sub', ...)` / `SET ROLE authenticated`): consultor A atualiza própria linha mantendo `consultant_id=A` → sucede; A tenta `consultant_id=B` → rejeitado (0 linhas/erro); admin/líder/assigned mantêm acesso anterior
    - tag `// Feature: evolution-multiconsultor-pronto, Property 4`
    - _Properties: 4_
    - _Requirements: 4.3_

  - [x] 7.4 Documentar o rollback da migração REQ 4
    - Registrar no arquivo/PR: recriar `Owner update customers` **sem** a cláusula `WITH CHECK` (somente `USING (consultant_id = auth.uid())`)
    - _Requirements: 4.4, 6.2_

- [x] 8. Checkpoint — RLS REQ 4
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Validação final (rollout integrado, sem perturbar Rafael/Whapi)
  - [x] 9.1 Re-rodar os Supabase advisors
    - Executar os advisors de segurança/performance e revisar findings, em especial a RLS de `customers` após o REQ 4 (`WITH CHECK`)
    - _Requirements: 4.1, 4.3, 6.1, 6.4_

  - [x] 9.2 Confirmar kill switch off → zero outbound no Evolution
    - Com `bot_global_enabled=false`, confirmar via teste de integração que o `evolution-webhook` retorna sucesso neutro e produz **zero** envios outbound; com `true`, fluxo normal
    - _Requirements: 1.1, 1.2_

  - [x] 9.3 Confirmar que um novo consultor de teste nasce na variante D
    - Em banco isolado/branch, criar consultor de teste → confirmar 1 `bot_flow` ativo `variant='D'` e `active_variants` contendo `'D'`
    - _Requirements: 2.1, 2.2_

  - [x] 9.4 Confirmar que IDOR cross-consultor é bloqueado
    - Confirmar via `deno test`/integração que chamada cross-consultor às 5 funções retorna 401/403 (e 400 para id ausente/malformado), sem efeito colateral
    - _Requirements: 5.2, 5.4, 5.5, 5.6_

  - [x] 9.5 Confirmar Rafael/Whapi inalterados
    - Confirmar: nenhum arquivo de `whapi-webhook` tocado; baseline A/B/D do Rafael responde idêntico; linhas do Rafael não mudaram após a migração REQ 2; isolamento multi-tenant preservado
    - _Requirements: 6.5, 6.6_

## Notes

- Tarefas marcadas com `*` são testes opcionais (puláveis para um MVP mais rápido); tarefas de implementação principais nunca são opcionais.
- Cada tarefa referencia requisitos específicos (`_Requirements: X.Y_`); tarefas de teste referenciam propriedades (`_Properties: N_`).
- Property-based tests usam fast-check + Vitest, ≥100 iterações, com tag `// Feature: evolution-multiconsultor-pronto, Property N`; P3 e P4 são integração (banco isolado / RLS com roles simuladas) conforme o design.
- Mudanças de banco/RLS (REQ 2, REQ 4) são migrações únicas e focadas, **não auto-aplicáveis**, com backup ANTES e rollback documentado.
- Mudanças de webhook (REQ 1, REQ 3) têm validação dual-channel (Evolution + não-regressão Whapi A/B/D).
- Os checkpoints garantem validação incremental e aprovação humana entre workstreams.
- Nenhum item do spec arquivado `security-hardening-lgpd` é incluído aqui.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1", "5.1", "5.3", "7.1"] },
    { "id": 1, "tasks": ["2.1", "4.2", "5.4", "5.5", "5.7", "5.8", "7.2"] },
    { "id": 2, "tasks": ["5.2", "1.2", "1.3", "2.2", "2.3", "4.3", "4.4", "5.9", "5.10", "7.3", "7.4"] },
    { "id": 3, "tasks": ["5.6", "1.4", "2.4"] },
    { "id": 4, "tasks": ["5.11", "5.12"] },
    { "id": 5, "tasks": ["9.1", "9.2", "9.3", "9.4", "9.5"] }
  ]
}
```
