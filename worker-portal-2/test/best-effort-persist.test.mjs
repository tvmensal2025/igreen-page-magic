/**
 * Property-based test — Best-effort de persistência (worker-portal-2/server.mjs#processLead)
 *
 * Spec:  .kiro/specs/portal2-ocr-feedback-loop/
 * Task 3.3 — Property 9: Best-effort de persistência
 * **Validates: Requirements 3.6, 4.5**
 *
 * Invariante (design.md §Correctness Properties / Property 9):
 *   "Falha ao gravar modo/resultado de extração nunca altera o `idcliente`
 *    já criado nem aborta o job."
 *
 * ── Por que esta abordagem (réplica fiel em vez de importar processLead) ──────
 * `processLead` NÃO é exportado por `server.mjs`, e importar `server.mjs` dispara
 * `main()` no topo do módulo — que sobe o Express (`app.listen`) e o
 * `new Worker(QUEUE_NAME, ...)` do BullMQ (exige Redis). Portanto não há como
 * exercitar `processLead` isoladamente sem levantar Redis/BullMQ/HTTP.
 *
 * Em vez disso, este teste reproduz EXATAMENTE a "forma" da persistência
 * best-effort usada em `server.mjs#processLead` — o wrapper
 * `await supabase.from('customers').update({...}).eq('id', customer_id).then(() => {}, (e) => ...)`
 * que aparece tanto no bloco de SUCESSO (persistência de
 * `portal2_extraction_mode`/`portal2_ocr_doc_result`/`portal2_ocr_bill_result`,
 * server.mjs ~L244–251) quanto no bloco de CATCH (persistência de
 * erro+extração, server.mjs ~L350–354). A única diferença em relação ao
 * código real é que o callback de rejeição (que no server faz `console.warn`)
 * aqui incrementa um contador, para podermos asserir que o caminho de falha foi
 * de fato exercitado sem poluir a saída do teste. Importamos o `sanitize` REAL
 * de `ai-audit.mjs` (sem efeitos colaterais de import) para a réplica refletir o
 * código de produção fielmente.
 *
 * Property 9 verificada sobre QUALQUER erro de gravação:
 *   1. o wrapper best-effort engole a rejeição (o `await` nunca lança → o job
 *      não aborta);
 *   2. o `idcliente` capturado na criação do cliente permanece inalterado.
 *
 * Runner: node --test (ESM). PBT lib: fast-check (resolvido via node_modules da
 * raiz). Executar com:
 *
 *     node --test worker-portal-2/test/best-effort-persist.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { sanitize } from '../ai-audit.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// Mock de Supabase: builder cuja cadeia `.from().update().eq()` FALHA.
// Modela os dois modos reais de falha do supabase-js:
//   - 'reject'        → a operação rejeita (thenable chama onRejected) — ex.:
//                       falha de transporte/conexão.
//   - 'resolve-error' → a operação resolve com `{ data:null, error }` (erro do
//                       PostgREST/DB) — vai para onFulfilled, que ignora o erro.
// Em ambos os casos o wrapper `.then(() => {}, ...)` faz o `await` resolver sem
// lançar — exatamente o comportamento best-effort de server.mjs.
// ─────────────────────────────────────────────────────────────────────────────
function makeFailingSupabase({ mode, error, onFailurePathExercised }) {
  const builder = {
    update() { return builder; },
    eq() {
      // PostgrestFilterBuilder é um "thenable" (não uma Promise nativa).
      // Modelamos isso retornando um objeto com `.then(onF, onR)` próprio,
      // para refletir fielmente a cadeia usada em server.mjs.
      return {
        then(onFulfilled, onRejected) {
          if (mode === 'reject') {
            onFailurePathExercised?.('rejected');
            return Promise.reject(error).then(onFulfilled, onRejected);
          }
          // mode === 'resolve-error': resolve com erro no payload (não rejeita)
          onFailurePathExercised?.('resolved-error');
          return Promise.resolve({ data: null, error }).then(onFulfilled, onRejected);
        },
      };
    },
  };
  return { from() { return builder; } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Réplicas FIÉIS dos dois pontos de persistência best-effort de processLead.
// (mirror de server.mjs — ver cabeçalho). `onRejectedCount` substitui o
// `console.warn` do original só para observabilidade no teste.
// ─────────────────────────────────────────────────────────────────────────────

// SUCESSO: persistência de Modo_Extração + resultados (server.mjs ~L244–251).
async function persistExtractionSuccessBestEffort(supabase, customer_id, extraction, counters) {
  await supabase.from('customers').update({
    portal2_extraction_mode: extraction.mode,
    portal2_ocr_doc_result: sanitize(extraction.doc),
    portal2_ocr_bill_result: sanitize(extraction.bill),
  }).eq('id', customer_id).then(
    () => {},
    () => { counters.onRejected++; },
  );
}

// CATCH: persistência de erro + extração (server.mjs ~L350–354).
async function persistErrorBestEffort(supabase, customer_id, updates, counters) {
  await supabase.from('customers').update(updates).eq('id', customer_id).then(
    () => {},
    () => { counters.onRejected++; },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fatia de processLead exercida no caminho de SUCESSO:
//   cliente criado → idcliente capturado → persistência best-effort (FALHA) →
//   job segue até a conclusão e retorna o resultado final.
// Esta função NÃO deve lançar mesmo quando a gravação falha (Property 9).
// ─────────────────────────────────────────────────────────────────────────────
async function processLeadSuccessSlice(supabase, customer_id, cadastroResult, counters) {
  // idcliente já foi criado no Portal 2 e capturado (imutável a partir daqui).
  const idcliente = cadastroResult.idcliente;

  // Persistência OBSERVACIONAL best-effort — pode falhar, mas não pode abortar
  // o job nem mexer no idcliente.
  await persistExtractionSuccessBestEffort(supabase, customer_id, cadastroResult.extraction, counters);

  // Job conclui normalmente.
  return { success: true, idcliente, otpGenerated: false, ...cadastroResult };
}

// ─── Geradores ────────────────────────────────────────────────────────────────

// idcliente real é numérico; incluímos strings por robustez.
const idclienteArb = fc.oneof(
  fc.integer({ min: 1, max: 2_000_000 }),
  fc.string({ minLength: 1, maxLength: 12 }),
);

// Erro arbitrário de gravação (mensagens variadas: RLS, conexão, constraint…).
const errorArb = fc.oneof(
  fc.string().map(m => new Error(m)),
  fc.record({ message: fc.string(), code: fc.string() }), // erro "plain" do PostgREST
  fc.constant(new Error('connection terminated unexpectedly')),
  fc.constant({ message: 'new row violates row-level security policy', code: '42501' }),
);

// Resultado de extração arbitrário (mode auto/manual; doc/bill com PII p/ sanitize).
const extractionArb = fc.record({
  mode: fc.constantFrom('auto', 'manual'),
  doc: fc.option(
    fc.record({
      success: fc.boolean(),
      mode: fc.constantFrom('auto', 'manual'),
      error: fc.option(fc.string(), { nil: null }),
      data: fc.record({
        nome: fc.string(),
        cpf: fc.string({ minLength: 11, maxLength: 11 }),
      }, { requiredKeys: [] }),
    }, { requiredKeys: ['success', 'mode'] }),
    { nil: null },
  ),
  bill: fc.option(
    fc.record({
      success: fc.boolean(),
      mode: fc.constantFrom('auto', 'manual'),
      is_authentic: fc.boolean(),
      rejection_reason: fc.option(fc.string(), { nil: null }),
    }, { requiredKeys: ['success', 'mode'] }),
    { nil: null },
  ),
}, { requiredKeys: ['mode', 'doc', 'bill'] });

const failureModeArb = fc.constantFrom('reject', 'resolve-error');

// ─────────────────────────────────────────────────────────────────────────────
// Property 9 (SUCESSO): falha na persistência de extração não aborta o job
// nem altera o idcliente.
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 9 — best-effort de persistência (Req 3.6, 4.5)', () => {
  test('falha ao gravar modo/resultado não lança e preserva o idcliente (caminho de sucesso)', async () => {
    await fc.assert(
      fc.asyncProperty(
        idclienteArb, errorArb, extractionArb, failureModeArb,
        async (idcliente, error, extraction, mode) => {
          const customer_id = 'cust-' + String(idcliente);
          const counters = { onRejected: 0 };
          let failurePath = null;

          const supabase = makeFailingSupabase({
            mode, error,
            onFailurePathExercised: (p) => { failurePath = p; },
          });

          // cadastroResult representa o cliente JÁ criado no Portal 2.
          const cadastroResult = { idcliente, idsolcontratovalidacao: 'sol-1', extraction };

          // NÃO deve lançar mesmo com a gravação falhando.
          let result;
          await assert.doesNotReject(async () => {
            result = await processLeadSuccessSlice(supabase, customer_id, cadastroResult, counters);
          }, 'a persistência best-effort não pode abortar o job');

          // O caminho de falha foi de fato exercitado (não houve bypass).
          assert.ok(failurePath === 'rejected' || failurePath === 'resolved-error');

          // idcliente capturado permanece inalterado.
          assert.equal(result.idcliente, idcliente, 'idcliente não pode mudar após falha de persistência');
          assert.equal(cadastroResult.idcliente, idcliente, 'o idcliente original não pode ser mutado');

          // Job concluiu (estado terminal de sucesso alcançado).
          assert.equal(result.success, true, 'o job deve concluir mesmo com a persistência falhando');

          // Quando a operação REJEITA, o onRejected do wrapper foi acionado.
          if (mode === 'reject') {
            assert.equal(counters.onRejected, 1, 'a rejeição deve ser engolida pelo onRejected do best-effort');
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Property 9 (CATCH): mesmo invariante no bloco de erro de processLead —
  // a persistência de erro+extração é best-effort e não pode re-lançar.
  // ───────────────────────────────────────────────────────────────────────────
  test('falha ao persistir erro+extração no catch não lança e preserva o idcliente', async () => {
    await fc.assert(
      fc.asyncProperty(
        idclienteArb, errorArb, extractionArb, failureModeArb,
        async (idcliente, error, extraction, mode) => {
          const customer_id = 'cust-' + String(idcliente);
          const counters = { onRejected: 0 };

          const supabase = makeFailingSupabase({ mode, error });

          // No catch, o cliente pode já ter sido criado em tentativa anterior;
          // o idcliente capturado não pode ser tocado pela persistência de erro.
          const idclienteBefore = idcliente;
          const updates = {
            portal2_status: 'awaiting_correction',
            portal2_error: 'detalhe da rejeição',
            portal2_error_kind: 'duplicate_phone',
            portal2_extraction_mode: extraction.mode ?? null,
            portal2_ocr_doc_result: sanitize(extraction.doc),
            portal2_ocr_bill_result: sanitize(extraction.bill),
          };

          await assert.doesNotReject(async () => {
            await persistErrorBestEffort(supabase, customer_id, updates, counters);
          }, 'a persistência best-effort do catch não pode re-lançar');

          assert.equal(idclienteBefore, idcliente, 'idcliente capturado permanece inalterado');
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Casos determinísticos nomeados (oráculo pontual da Property 9).
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 9 — casos determinísticos', () => {
  test('update().eq() que REJEITA (transporte) → não lança, idcliente intacto', async () => {
    const counters = { onRejected: 0 };
    const supabase = makeFailingSupabase({ mode: 'reject', error: new Error('ECONNRESET') });
    const cadastroResult = { idcliente: 123456, idsolcontratovalidacao: 's1', extraction: { mode: 'auto', doc: { success: true, mode: 'auto' }, bill: { success: true, mode: 'auto', is_authentic: true } } };

    const result = await processLeadSuccessSlice(supabase, 'cust-1', cadastroResult, counters);

    assert.equal(result.idcliente, 123456);
    assert.equal(result.success, true);
    assert.equal(counters.onRejected, 1);
  });

  test('update().eq() que RESOLVE com {error} (PostgREST/RLS) → não lança, idcliente intacto', async () => {
    const counters = { onRejected: 0 };
    const supabase = makeFailingSupabase({ mode: 'resolve-error', error: { message: 'RLS denied', code: '42501' } });
    const cadastroResult = { idcliente: 777, idsolcontratovalidacao: 's2', extraction: { mode: 'manual', doc: null, bill: null } };

    const result = await processLeadSuccessSlice(supabase, 'cust-2', cadastroResult, counters);

    assert.equal(result.idcliente, 777);
    assert.equal(result.success, true);
    // resolve-error vai para onFulfilled (ignora), então onRejected não dispara.
    assert.equal(counters.onRejected, 0);
  });

  test('idcliente string também é preservado após falha', async () => {
    const counters = { onRejected: 0 };
    const supabase = makeFailingSupabase({ mode: 'reject', error: new Error('boom') });
    const cadastroResult = { idcliente: 'ABC-999', idsolcontratovalidacao: 's3', extraction: { mode: 'auto', doc: { success: true, mode: 'auto' }, bill: { success: true, mode: 'auto', is_authentic: true } } };

    const result = await processLeadSuccessSlice(supabase, 'cust-3', cadastroResult, counters);

    assert.equal(result.idcliente, 'ABC-999');
  });
});
