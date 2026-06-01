# Implementation Plan: Portal 2 OCR Feedback Loop

## Overview

Plano de implementação incremental para fechar o ciclo de cadastro automático no Portal 2, cobrindo os 4 planos do design: Worker (`worker-portal-2/`), Banco (migração `customers`), Bot (`bot-flow.ts` evolution + whapi) e Painel (`PortalStatusTracker.tsx`).

Linguagens (definidas no design, sem pseudocódigo):
- **Worker** → JavaScript ESM (`.mjs`, Node ≥18, runner nativo `node --test`).
- **Bot / shared** → TypeScript (Deno edge functions, `deno test`).
- **Painel** → TypeScript + React.

Ordem de execução: módulo puro + testes → captura no worker → persistência/classificação no worker → migração (gated, exige aprovação humana) → celular alternativo no payload → loop de correção no bot → painel. As propriedades de corretude do design viram tarefas de teste de propriedade próximas da implementação que validam.

Convenções herdadas do repositório (sem framework de teste no worker): testes do módulo puro como scripts Node (`node --test`), validação de integração via scripts no padrão `probe-extractor.mjs` / `.tmp/pg-snapshot-validate`.

## Tasks

- [x] 1. Módulo puro de classificação e extração (`worker-portal-2/portal-errors.mjs`)
  - [x] 1.1 Criar `worker-portal-2/portal-errors.mjs` (módulo puro, sem I/O)
    - Implementar o mapa fechado `ERROR_KINDS` (duplicate_phone/email/installation/missing_consumo recuperáveis; duplicate_document/no_coverage/unknown não-recuperáveis) com `recoverable` e `field`
    - Implementar `classifyPortalError(message)` → `{ kind, recoverable }`, case-insensitive, avaliando as não-recuperáveis (duplicate_document, no_coverage) **antes** das recuperáveis para garantir precedência determinística (Req 6.10)
    - Implementar `buildExtractionResult({ docResp, docBackResp, billResp, isCnh, billAlreadyExtracted })` → `{ mode, doc, bill }`: documento `auto` quando frente (e verso, se RG) têm `success===true` sem `error`; conta `auto` quando `success===true && is_authentic===true && !error`; objeto nulo/vazio/sem `success` ou `__transport_error` → `manual`; `mode='auto'` do cadastro só quando doc e conta forem ambos `auto`; respeitar `billAlreadyExtracted` (não reavaliar conta, preservar resultado)
    - Implementar helpers de normalização anti-repetição: `normalizePhone`/`normalizeInstallation` (somente dígitos) e `normalizeEmail` (trim + lowercase)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.9, 6.10, 1.2, 1.3, 1.5, 2.2, 2.3, 2.5, 3.1, 3.2, 9.1_

  - [x]* 1.2 Escrever teste de propriedade para `classifyPortalError` em `worker-portal-2/test/classify-error.test.mjs`
    - **Property 4: Classificação total e única**
    - **Validates: Requirements 6.1, 6.10**
    - Tabela com mensagens reais (`duplicatePhone`, `duplicateDocument`, `duplicateEmail`, "nenhuma cobertura ativa", "Consumo médio não informado", instalação duplicada/inválida, desconhecido) + casos de múltiplo match confirmando precedência da classe não-recuperável

  - [x]* 1.3 Escrever teste de propriedade para `buildExtractionResult` em `worker-portal-2/test/extraction-result.test.mjs`
    - **Property 1: Não-bloqueio da extração (classificação observacional)**
    - **Validates: Requirements 1.6, 3.1, 3.2**
    - Matriz de `success`/`error`/`is_authentic`/objeto nulo/verso ausente-presente → `mode` esperado; confirmar que toda combinação produz `auto` ou `manual` (nunca indefinido) e que `billAlreadyExtracted` preserva o resultado

  - [x]* 1.4 Escrever teste unitário das normalizações em `worker-portal-2/test/normalize.test.mjs`
    - Telefone/instalação reduzidos a dígitos; email com trim + lowercase; igualdade após normalização (base para a anti-repetição)
    - _Requirements: 9.1_

- [x] 2. Captura do retorno dos extractors no worker (`worker-portal-2/portal2-api-client.mjs`)
  - [x] 2.1 Alterar `cadastrarCliente` para capturar o retorno dos extractors
    - Guardar o retorno de `extractDocument` (frente + verso quando RG) e de `extractReceipt` em variáveis locais em vez de descartar; em exceção/HTTP/timeout 30s manter `manualFallback` e marcar `__transport_error`
    - Chamar `buildExtractionResult(...)` (de `portal-errors.mjs`) para derivar `{ mode, doc, bill }`
    - Respeitar `billAlreadyExtracted=true` (não repetir `extractReceipt`, preservar resultado já registrado)
    - Prosseguir para `createCustomer` independentemente do modo (extração não bloqueia)
    - Retornar `{ idcliente, idsolcontratovalidacao, extraction }`; no `createCustomer.catch`, anexar `e.extraction = extraction` antes de `throw e`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2_

  - [x]* 2.2 Escrever script de validação de integração em `worker-portal-2/probe-extraction-mode.mjs`
    - Reaproveitar o customer de referência (CNH + conta) do probe para confirmar que `cadastrarCliente` retorna `extraction.mode='auto'` no caminho feliz; sem PII em claro no output
    - _Requirements: 1.1, 2.1, 3.1_

- [x] 3. Persistência do modo/resultado e classificação de erro no worker (`worker-portal-2/server.mjs`)
  - [x] 3.1 Alterar `processLead` (sucesso + catch)
    - Sucesso: adicionar ao `updates` `portal2_extraction_mode`, `portal2_ocr_doc_result` e `portal2_ocr_bill_result`, aplicando `sanitize` de `ai-audit.mjs` (CPF/documento → 4 últimos dígitos; buffers/base64 omitidos); toda gravação de extração best-effort (`.then(()=>{},()=>{})`), sem alterar o `idcliente` nem abortar o job
    - Catch: chamar `classifyPortalError(e.message)`; persistir `portal2_error` (truncado a 2000 chars), `portal2_error_kind`, e o modo/resultados de `e.extraction` (best-effort); rotear `portal2_status`: não-recuperável → `needs_human`; recuperável com `attempts[kind] >= 3` → `needs_human`; recuperável com `attempts < 3` → `awaiting_correction`
    - Decisão de retry BullMQ: erro classificado determinístico (≠ `unknown` transitório) **não** re-lança; erro de transporte/`worker_offline`/instabilidade mantém `throw e`
    - Passar `extraction` ao `runAuditPipeline` para incluir modo + motivo (manual) no `portal2_audit_traces`, sanitizado
    - _Requirements: 3.3, 3.4, 3.6, 4.1, 4.3, 4.4, 4.5, 6.1, 6.8, 9.5, 9.6, 10.1, 10.2, 12.1, 12.2, 12.4_

  - [x]* 3.2 Escrever teste de propriedade de mascaramento de PII em `worker-portal-2/test/pii-masking.test.mjs`
    - **Property 8: PII sempre mascarada na borda de saída**
    - **Validates: Requirements 4.2, 12.1, 12.2, 12.4**
    - Aplicar `sanitize` sobre resultados de extração com CPF/documento/base64 e asserir que a saída nunca contém CPF/documento completo nem base64

  - [x]* 3.3 Escrever teste de propriedade de persistência best-effort em `worker-portal-2/test/best-effort-persist.test.mjs`
    - **Property 9: Best-effort de persistência**
    - **Validates: Requirements 3.6, 4.5**
    - Simular falha na gravação de modo/resultado e asserir que o `idcliente` já criado não é alterado e o job não aborta

  - [x]* 3.4 Escrever teste de propriedade de roteamento não-recuperável (lado worker) em `worker-portal-2/test/routing-needs-human.test.mjs`
    - **Property 7: Não-recuperável nunca entra no loop**
    - **Validates: Requirements 10.1, 10.4**
    - Para `duplicate_document`/`no_coverage`/`unknown` asserir `portal2_status='needs_human'` e ausência de transição para `awaiting_correction`

- [x] 4. Checkpoint — Garantir que os testes do módulo puro e do worker passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Migração de banco de dados (GATED — exige aprovação humana explícita)
  - [x] 5.1 Criar a migração em `supabase/migrations/` (não aplicar automaticamente)
    - Seguir o padrão idempotente de `20260526230001_portal2_routing_and_state.sql` (`ADD COLUMN IF NOT EXISTS`)
    - Adicionar `portal2_celular_alt text`, `portal2_ocr_doc_result jsonb`, `portal2_ocr_bill_result jsonb`, `portal2_extraction_mode text`, `portal2_error_kind text`, `portal2_correction_attempts jsonb NOT NULL DEFAULT '{}'::jsonb`
    - Adicionar CHECK `customers_portal2_extraction_mode_chk` aceitando apenas `auto`/`manual`/NULL; criar índice parcial em `portal2_error_kind`
    - NÃO remover/renomear/alterar colunas existentes; preservar unicidade de `phone_whatsapp` e não criar unicidade em `portal2_celular_alt`
    - **A aplicação no banco exige aprovação humana explícita registrada (Req 11.5) — esta tarefa apenas autora o arquivo; NÃO executar a migração em produção sem aprovação**
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6, 9.3_

  - [x] 5.2 Regenerar `src/integrations/supabase/types.ts` após a migração aprovada e aplicada
    - **Bloqueado pela aprovação humana e aplicação da migração (5.1)** — gerar os tipos refletindo as novas colunas
    - _Requirements: 11.1_

- [x] 6. Celular alternativo no payload do Portal 2 (Req 8)
  - [x] 6.1 Alterar `supabase/functions/_shared/portal-worker.ts#buildPortal2Payload`
    - Incluir `portal2_celular_alt` no `select` e derivar `whatsapp: c.portal2_celular_alt || c.phone_whatsapp || ""`; nunca alterar `phone_whatsapp`
    - _Requirements: 8.3, 8.4, 8.5_

  - [x] 6.2 Alterar `worker-portal-2/server.mjs#fetchDadosFromSupabase`
    - Incluir `portal2_celular_alt` no `select` e priorizá-lo sobre o telefone original ao montar o `celular`; nunca alterar `phone_whatsapp`
    - _Requirements: 8.3, 8.4, 8.5_

  - [x]* 6.3 Escrever teste de propriedade de prioridade do celular alternativo em `worker-portal-2/test/celular-alt-priority.test.mjs`
    - **Property 3: Prioridade do celular alternativo**
    - **Validates: Requirements 8.3, 8.4**
    - Asserir que com `portal2_celular_alt` preenchido o `celular` deriva dele; sem ele, deriva de `phone_whatsapp`

- [x] 7. Loop de correção no bot — evolution (`supabase/functions/evolution-webhook/handlers/bot-flow.ts`)
  - [x] 7.1 Implementar os steps de correção, o helper e a guarda de não-recuperável
    - Generalizar o disparo (espelhando o caso existente de `missing_consumo` em `portal_submitting`): ao detectar `portal2_status='awaiting_correction'`/`portal2_error_kind` recuperável, mapear classe → step + mensagem + campo
    - Adicionar steps `corrigir_celular_portal` (grava `portal2_celular_alt`, ≥10 dígitos, ≠ `phone_whatsapp`, nunca toca `phone_whatsapp`), `corrigir_email_portal` (grava `email`, valida `@` com 1+ char antes/depois) e `corrigir_instalacao_portal` (grava `numero_instalacao`, ≥7 dígitos)
    - Em valor inválido ou igual ao valor anterior (normalizado), re-perguntar indicando o formato e **não** re-despachar
    - Implementar helper `persistAndRedispatch(customer, kind)`: incrementar `portal2_correction_attempts[kind]`, persistir campo corrigido, setar `conversation_step='portal_submitting'`/`portal2_status='retry_ready'`, limpar `portal2_error` e chamar `dispatchPortalWorker`
    - Implementar guarda: se `portal2_error_kind` não-recuperável ou `attempts[kind] >= 3`, manter `needs_human` e não pedir correção
    - Extrair as funções de validação/anti-repetição/decisão de limite como helpers puros exportáveis (para teste); reutilizar `sanitize` em logs (sem PII em claro)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.1, 8.2, 8.3, 8.6, 9.2, 9.3, 9.4, 9.5, 9.6, 10.2, 10.4, 12.4_

  - [x]* 7.2 Escrever teste de propriedade `phone_whatsapp` imutável em `supabase/functions/evolution-webhook/handlers/__tests__/phone-whatsapp-immutable.test.ts`
    - **Property 2: phone_whatsapp imutável pelo loop**
    - **Validates: Requirements 8.2, 8.6**
    - Asserir que nenhum caminho de correção de telefone escreve `phone_whatsapp`; grava apenas `portal2_celular_alt`

  - [x]* 7.3 Escrever teste de propriedade de não-repetição em `supabase/functions/evolution-webhook/handlers/__tests__/no-repeat-value.test.ts`
    - **Property 5: Não-repetição do valor rejeitado**
    - **Validates: Requirements 9.1, 9.2**
    - Valor novo normalizado == valor corrente → rejeita e re-pergunta, sem re-despacho; valor diferente → segue

  - [x]* 7.4 Escrever teste de propriedade de terminação do loop em `supabase/functions/evolution-webhook/handlers/__tests__/loop-termination.test.ts`
    - **Property 6: Terminação do loop**
    - **Validates: Requirements 9.5, 9.6, 10.2**
    - No máximo 3 re-despachos por classe; ao atingir o limite → `needs_human` e bot não pede mais correção

  - [x]* 7.5 Escrever teste de propriedade de guarda não-recuperável em `supabase/functions/evolution-webhook/handlers/__tests__/guard-needs-human.test.ts`
    - **Property 7: Não-recuperável nunca entra no loop (lado bot)**
    - **Validates: Requirements 10.1, 10.4**
    - Para classe não-recuperável, o bot não abre step de correção nem pergunta nada ao cliente

- [x] 8. Loop de correção no bot — espelho whapi (`supabase/functions/whapi-webhook/handlers/bot-flow.ts`)
  - [x] 8.1 Espelhar exatamente as mudanças do 7.1 no handler whapi
    - Replicar steps `corrigir_*`, `persistAndRedispatch`, disparo e guarda; manter os dois arquivos em sincronia (mesma lógica, mesmos textos, mesmos campos)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.1, 8.2, 8.3, 8.6, 9.2, 9.3, 9.4, 9.5, 9.6, 10.2, 10.4, 12.4_

- [x] 9. Checkpoint — Garantir que os testes do worker, payload e bot passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Painel do escritório (`src/components/captacao/PortalStatusTracker.tsx`)
  - [x] 10.1 Estender o componente com badges, IA Gemini, motivo do manual e banner
    - Estender a interface `Row` e o `select` com `portal2_extraction_mode`, `portal2_error_kind`, `portal2_status`, `ocr_done`, `ocr_confianca`, `portal2_ocr_doc_result`, `portal2_ocr_bill_result` (reusando o subscribe realtime existente em `customers`)
    - Badge de extração: `auto` (verde), `manual` (âmbar), nulo/inválido ("não determinado")
    - Badge IA_Gemini: `ocr_done` → "IA analisou (confiança ...)" ou "confiança indisponível"; senão "IA não analisou"
    - Motivo do manual: ler `rejection_reason` (bill)/`error` (doc) do resultado persistido; ausente → "motivo não disponível"
    - Banner `needs_human`: vermelho com tradução de `portal2_error_kind`, mantendo o botão "Reenviar ao portal" existente
    - Estender `friendlyPortalError` com o mapa `ERROR_KIND_LABELS` por `error_kind`; exibir apenas PII já mascarada, sem reconstruir o dado em claro
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 10.3, 10.5, 12.3_

  - [x]* 10.2 Escrever teste de render do painel em `src/components/captacao/__tests__/PortalStatusTracker.test.tsx`
    - Renderizar os três estados de badge (auto/manual/indeterminado), IA Gemini (analisou/não), motivo do manual, banner `needs_human`; confirmar que só PII mascarada aparece
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.8, 12.3_

- [x] 11. Checkpoint final — Garantir que toda a suíte de testes passa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são opcionais (testes) e podem ser puladas para um MVP mais rápido; as demais são implementação central e devem ser executadas.
- Cada tarefa referencia cláusulas específicas dos requisitos para rastreabilidade; tarefas de teste anotam a Property do design que validam.
- **Migração gated (Req 11.5):** a tarefa 5.1 apenas escreve o arquivo `.sql`. A aplicação no banco de produção e a regeneração de tipos (5.2) dependem de **aprovação humana explícita** — não aplicar automaticamente. A tabela `customers` tem ~1013 linhas; a migração é não-destrutiva (`ADD COLUMN IF NOT EXISTS`, colunas anuláveis ou com default).
- **Deploy do worker (operacional, fora do escopo de código):** as mudanças em `worker-portal-2/` só entram em produção após redeploy do container na VPS. Isso é uma operação manual de infraestrutura, não automatizável por este repositório, e deve ser executada após o checkpoint final.
- **Sincronização dos espelhos:** `evolution-webhook/handlers/bot-flow.ts` (7.1) e `whapi-webhook/handlers/bot-flow.ts` (8.1) devem permanecer idênticos em lógica; qualquer ajuste em um exige o mesmo no outro.
- **Reúso:** `sanitize` de `ai-audit.mjs` (mascaramento PII), `dispatchPortalWorker` (re-despacho) e o padrão do step `portal_submitting` (auto-correção de consumo já existente) são reaproveitados, não reimplementados.
- **Validação de fluxo em staging** (duplicate_phone → celular alternativo, reenvio do mesmo número rejeitado, 3 tentativas → `needs_human`, CPF não abre correção) é operacional/manual e deve ser conduzida após o deploy, complementando os testes de propriedade automatizados.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "5.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "2.1", "5.2", "6.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "7.1", "10.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "6.2", "8.1", "7.2", "7.3", "7.4", "7.5", "10.2"] },
    { "id": 4, "tasks": ["6.3"] }
  ]
}
```
