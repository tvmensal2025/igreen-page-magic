/**
 * Property-based test — Roteamento não-recuperável (lado worker)
 *
 * Spec: .kiro/specs/portal2-ocr-feedback-loop/
 * Task 3.4 — Property 7: Não-recuperável nunca entra no loop
 * **Validates: Requirements 10.1, 10.4**
 *
 * Property 7 (design.md §Correctness Properties):
 *   `duplicate_document`, `no_coverage` e `unknown` levam direto a
 *   `needs_human`, sem solicitar dado ao cliente (nunca `awaiting_correction`),
 *   independentemente do contador de tentativas.
 *
 * ─── Superfície testada / decisão de design do teste ────────────────────────
 * A decisão de roteamento de `portal2_status` vive INLINE no catch block de
 * `processLead` (`worker-portal-2/server.mjs`), fortemente acoplada à leitura
 * do contador via Supabase e à atualização do registro — não é exportada como
 * função pura. Para testar a INVARIANTE de roteamento de forma isolada e
 * determinística, replicamos AQUI a regra EXATA de `processLead` num helper
 * puro `routePortalStatus(message, attempts)`, mantendo-o um espelho 1:1 do
 * código de produção:
 *
 *     // server.mjs#processLead (catch):
 *     const { kind, recoverable } = classifyPortalError(e.message);
 *     let nextStatus;
 *     if (!recoverable) {
 *       nextStatus = 'needs_human';                                  // Req 10.1
 *     } else {
 *       nextStatus = attempts >= 3 ? 'needs_human' : 'awaiting_correction';
 *     }
 *
 * A classificação em si (`classifyPortalError`) é importada do MÓDULO REAL
 * `portal-errors.mjs` — não é reescrita — de modo que o teste exercita o
 * mesmo mapeamento mensagem → classe usado em produção. Só a árvore de decisão
 * de status (3 linhas) é espelhada.
 *
 * Runner: node --test (ESM). PBT lib: fast-check (resolvido via node_modules
 * da raiz do repositório, como nos demais testes do worker). Executar com:
 *
 *     node --test worker-portal-2/test/routing-needs-human.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { classifyPortalError, ERROR_KINDS } from '../portal-errors.mjs';

// ─── Espelho 1:1 da decisão de roteamento de processLead (server.mjs) ────────
// Mantém a MESMA regra do catch block. Mudou lá? Muda aqui.
const NON_RECOVERABLE_STATUS = 'needs_human';
const RECOVERABLE_LOOP_STATUS = 'awaiting_correction';

/**
 * Decide o `portal2_status` terminal a partir da mensagem de rejeição e do
 * contador de tentativas da classe correspondente — espelho exato de
 * `processLead`.
 *
 * @param {string} message  mensagem de detalhe da rejeição do POST /customers
 * @param {number} attempts tentativas já feitas para a classe (>= 0)
 * @returns {{ kind: string, recoverable: boolean, status: string }}
 */
function routePortalStatus(message, attempts = 0) {
  const { kind, recoverable } = classifyPortalError(message);
  let status;
  if (!recoverable) {
    status = NON_RECOVERABLE_STATUS;                                  // Req 10.1
  } else {
    status = attempts >= 3 ? NON_RECOVERABLE_STATUS : RECOVERABLE_LOOP_STATUS;
  }
  return { kind, recoverable, status };
}

// ─── Conjuntos de classes derivados do mapa fechado real ─────────────────────
const NON_RECOVERABLE_KINDS = Object.keys(ERROR_KINDS).filter(k => !ERROR_KINDS[k].recoverable);
const RECOVERABLE_KINDS = Object.keys(ERROR_KINDS).filter(k => ERROR_KINDS[k].recoverable);

// As três classes que o Property 7 exige que vão SEMPRE a needs_human.
// (duplicate_document, no_coverage, unknown — confirmado contra o mapa real.)
assert.deepEqual(
  [...NON_RECOVERABLE_KINDS].sort(),
  ['duplicate_document', 'no_coverage', 'unknown'],
  'pré-condição: o conjunto não-recuperável do mapa real deve ser exatamente {duplicate_document, no_coverage, unknown}',
);

// Contadores de tentativas a varrer: 0,1,2 (abaixo do limite), 3 (no limite),
// e valores grandes — a invariante não-recuperável deve valer para TODOS.
const ATTEMPT_SAMPLES = [0, 1, 2, 3, 4, 10, 99, 1000];

// ─────────────────────────────────────────────────────────────────────────────
// 1. Marcadores reais por classe não-recuperável (mensagens de detalhe reais).
//    `unknown` usa strings arbitrárias que não casam com nenhum marcador.
// ─────────────────────────────────────────────────────────────────────────────
const NON_RECOVERABLE_MESSAGES = {
  duplicate_document: [
    'duplicateDocument',
    '{"documento":"duplicateDocument"}',
    'CPF já cadastrado no iGreen',
    'documento já existe',
  ],
  no_coverage: [
    'nenhuma cobertura ativa',
    'Não há nenhuma cobertura ativa para o estado',
    'sem cobertura na região informada',
    'UF não atendida',
    'sem regra ativa para a distribuidora',
  ],
  unknown: [
    'internal server error 500',
    'timeout ao conectar no portal',
    'erro genérico não mapeado',
    'xyzzy plugh',
    '',
  ],
};

describe('Property 7 — não-recuperável → needs_human (tabela de mensagens reais, Req 10.1)', () => {
  for (const [expectedKind, messages] of Object.entries(NON_RECOVERABLE_MESSAGES)) {
    for (const message of messages) {
      for (const attempts of ATTEMPT_SAMPLES) {
        test(`[${expectedKind}] "${message}" (attempts=${attempts}) → needs_human`, () => {
          const { kind, recoverable, status } = routePortalStatus(message, attempts);
          // A mensagem realmente classifica na classe não-recuperável esperada.
          assert.equal(kind, expectedKind, `kind para "${message}"`);
          assert.equal(recoverable, false, 'classe deve ser não-recuperável');
          // INVARIANTE central da Property 7.
          assert.equal(status, 'needs_human', `status para "${message}" @${attempts}`);
          // Nunca entra no loop de correção.
          assert.notEqual(status, 'awaiting_correction');
        });
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Property 7 (fast-check) — invariante sobre kind × attempts.
//    Para QUALQUER mensagem que classifique como não-recuperável e QUALQUER
//    contador de tentativas (incluindo 0,1,2 e >=3), o status é needs_human e
//    NUNCA awaiting_correction.
// ─────────────────────────────────────────────────────────────────────────────

// Fragmentos que, isolados, classificam como NÃO-recuperável (doc/coverage).
const NON_RECOVERABLE_FRAGMENTS = [
  'duplicateDocument', 'CPF já cadastrado', 'documento já existe',
  'nenhuma cobertura ativa', 'sem cobertura', 'UF não atendida', 'sem regra ativa',
];

// Ruído "seguro": dígitos, espaços e pontuação que NÃO formam marcadores de
// classificação — não introduz falsos gatilhos ao concatenar.
const safeNoiseArb = fc
  .array(fc.constantFrom(...'0123456789 -_#.,/!?:;()[]'.split('')), { maxLength: 24 })
  .map(chars => chars.join(''));

// Contador arbitrário não-negativo (cobre abaixo, no, e acima do limite 3).
const attemptsArb = fc.nat({ max: 5000 });

describe('Property 7 — invariante não-recuperável sobre kind × attempts (Req 10.1, 10.4)', () => {
  test('mensagem não-recuperável + qualquer attempts → SEMPRE needs_human, NUNCA awaiting_correction', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NON_RECOVERABLE_FRAGMENTS),
        safeNoiseArb,
        safeNoiseArb,
        attemptsArb,
        (frag, pre, post, attempts) => {
          const message = `${pre} ${frag} ${post}`;
          const { recoverable, status } = routePortalStatus(message, attempts);

          // Pré-condição: o fragmento garante classe não-recuperável.
          assert.equal(recoverable, false, `"${message}" deveria ser não-recuperável`);
          // Property 7: roteia direto pra intervenção humana...
          assert.equal(status, 'needs_human', `status para "${message}" @${attempts}`);
          // ...e NUNCA entra no loop de correção (Req 10.4).
          assert.notEqual(status, 'awaiting_correction');
        },
      ),
      { numRuns: 1000 },
    );
  });

  test('strings arbitrárias (sem marcador) → unknown → needs_human, para qualquer attempts', () => {
    fc.assert(
      fc.property(fc.string(), attemptsArb, (message, attempts) => {
        const { kind, recoverable } = classifyPortalError(message);
        // Só exercita o ramo unknown: descarta entradas que casem com algum marcador.
        fc.pre(kind === 'unknown');

        const { status } = routePortalStatus(message, attempts);
        assert.equal(recoverable, false, `unknown deve ser não-recuperável ("${message}")`);
        assert.equal(status, 'needs_human', `unknown @${attempts} deve ir a needs_human`);
        assert.notEqual(status, 'awaiting_correction');
      }),
      { numRuns: 1000 },
    );
  });

  test('entradas não-string (null/undefined/número) classificam unknown → needs_human', () => {
    for (const message of [null, undefined, 123, NaN, {}, []]) {
      for (const attempts of ATTEMPT_SAMPLES) {
        const { kind, status } = routePortalStatus(message, attempts);
        assert.equal(kind, 'unknown', `entrada ${String(message)} deve ser unknown`);
        assert.equal(status, 'needs_human', `entrada ${String(message)} @${attempts} → needs_human`);
        assert.notEqual(status, 'awaiting_correction');
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Contraste — classes RECUPERÁVEIS PODEM ir a awaiting_correction.
//    Necessário para provar que a invariante da Property 7 é específica das
//    não-recuperáveis (não um artefato de o helper retornar needs_human sempre).
// ─────────────────────────────────────────────────────────────────────────────
const RECOVERABLE_MESSAGES = {
  duplicate_phone: 'duplicatePhone',
  duplicate_email: 'duplicateEmail',
  duplicate_installation: 'número de instalação inválido',
  missing_consumo: 'Consumo médio não informado',
};

describe('Contraste — recuperável com attempts<3 → awaiting_correction; >=3 → needs_human (Req 9.5/10.2)', () => {
  // Sanidade: o mapeamento de contraste cobre exatamente as classes recuperáveis.
  test('pré-condição: mensagens de contraste cobrem todas as classes recuperáveis', () => {
    assert.deepEqual(
      Object.keys(RECOVERABLE_MESSAGES).sort(),
      [...RECOVERABLE_KINDS].sort(),
    );
  });

  for (const [expectedKind, message] of Object.entries(RECOVERABLE_MESSAGES)) {
    test(`[${expectedKind}] attempts<3 → awaiting_correction (PODE entrar no loop)`, () => {
      for (const attempts of [0, 1, 2]) {
        const { kind, recoverable, status } = routePortalStatus(message, attempts);
        assert.equal(kind, expectedKind, `kind para "${message}"`);
        assert.equal(recoverable, true, 'classe deve ser recuperável');
        assert.equal(status, 'awaiting_correction', `"${message}" @${attempts} deve abrir o loop`);
      }
    });

    test(`[${expectedKind}] attempts>=3 → needs_human (limite esgotado)`, () => {
      for (const attempts of [3, 4, 99]) {
        const { status } = routePortalStatus(message, attempts);
        assert.equal(status, 'needs_human', `"${message}" @${attempts} deve esgotar o loop`);
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Property forte — para QUALQUER classe não-recuperável, NENHUM valor de
//    attempts produz awaiting_correction (a invariante é total no domínio).
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 7 — totalidade: não-recuperável jamais produz awaiting_correction', () => {
  test('varredura kind não-recuperável × attempts (incluindo limite e além)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.keys(NON_RECOVERABLE_MESSAGES)),
        attemptsArb,
        (targetKind, attempts) => {
          // Escolhe uma mensagem real determinística para a classe alvo.
          const [message] = NON_RECOVERABLE_MESSAGES[targetKind];
          const { kind, status } = routePortalStatus(message, attempts);
          assert.equal(kind, targetKind);
          assert.equal(status, 'needs_human');
          assert.notEqual(status, 'awaiting_correction');
        },
      ),
      { numRuns: 500 },
    );
  });
});
