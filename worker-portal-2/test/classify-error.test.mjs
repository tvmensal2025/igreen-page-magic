/**
 * Property-based + table tests para `classifyPortalError` (worker-portal-2/portal-errors.mjs)
 *
 * Property 4 — Classificação total e única (design.md §Correctness Properties):
 *   `classifyPortalError` mapeia QUALQUER mensagem para EXATAMENTE UMA
 *   Classe_de_Erro do conjunto fechado ERROR_KINDS; mensagens ambíguas
 *   (que casam com mais de uma classe) resolvem para a classe NÃO-recuperável
 *   de maior precedência.
 *
 * Validates: Requirements 6.1, 6.10
 *
 * Runner: node --test (ESM). PBT lib: fast-check (resolvido via node_modules
 * da raiz do repositório).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { classifyPortalError, ERROR_KINDS } from '../portal-errors.mjs';

const KINDS = Object.keys(ERROR_KINDS);
const RECOVERABLE_KINDS = KINDS.filter(k => ERROR_KINDS[k].recoverable);
const NON_RECOVERABLE_KINDS = KINDS.filter(k => !ERROR_KINDS[k].recoverable);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Tabela com mensagens reais conhecidas (Req 6.2–6.7, 6.9)
//    Mensagens de detalhe que o POST /customers (ou pré-validações) retorna.
// ─────────────────────────────────────────────────────────────────────────────
const REAL_MESSAGE_TABLE = [
  // marcador cru                                            kind esperado          recuperável
  ['duplicatePhone',                                         'duplicate_phone',        true],
  ['{"celular":"duplicatePhone"}',                           'duplicate_phone',        true],
  ['Celular já cadastrado no sistema',                       'duplicate_phone',        true],
  ['telefone já existe para outro cliente',                  'duplicate_phone',        true],

  ['duplicateEmail',                                         'duplicate_email',        true],
  ['{"email":"duplicateEmail"}',                             'duplicate_email',        true],
  ['E-mail já cadastrado',                                   'duplicate_email',        true],

  ['número de instalação inválido',                          'duplicate_installation', true],
  ['Instalação já existe na base',                           'duplicate_installation', true],
  ['POST /customers/check-installation 400',                'duplicate_installation', true],

  ['Consumo médio não informado',                            'missing_consumo',        true],
  ['erro: consumo médio nao informado',                      'missing_consumo',        true],

  ['duplicateDocument',                                      'duplicate_document',     false],
  ['{"documento":"duplicateDocument"}',                      'duplicate_document',     false],
  ['CPF já cadastrado no iGreen',                            'duplicate_document',     false],
  ['documento já existe',                                    'duplicate_document',     false],
  ['Cliente já cadastrado: mesmo consultor',                 'duplicate_document',     false],
  ['Cliente ja cadastrado no portal',                        'duplicate_document',     false],

  ['nenhuma cobertura ativa',                                'no_coverage',            false],
  ['Não há nenhuma cobertura ativa para o estado',           'no_coverage',            false],
  ['sem cobertura na região informada',                      'no_coverage',            false],
  ['UF não atendida',                                        'no_coverage',            false],
  ['sem regra ativa para a distribuidora',                   'no_coverage',            false],

  ['POST /customers -> 400: Erro de validação | detail=Too small: expected string to have >=14 characters', 'validation_error', false],
  ['Erro de validação',                                      'validation_error',       false],
  ['Too small: expected string to have >=14 characters',     'validation_error',       false],
  ['expected string, received number',                       'validation_error',       false],
  ['validation failed for field celular',                    'validation_error',       false],

  ['internal server error 500',                              'unknown',                false],
  ['timeout ao conectar no portal',                          'unknown',                false],
  ['',                                                       'unknown',                false],
];

describe('classifyPortalError — tabela de mensagens reais (Req 6.2–6.7, 6.9)', () => {
  for (const [message, expectedKind, expectedRecoverable] of REAL_MESSAGE_TABLE) {
    test(`"${message}" → ${expectedKind}`, () => {
      const result = classifyPortalError(message);
      assert.equal(result.kind, expectedKind, `kind para "${message}"`);
      assert.equal(
        result.recoverable,
        expectedRecoverable,
        `recoverable para "${message}"`,
      );
      // recoverable retornado é sempre coerente com o mapa fechado.
      assert.equal(result.recoverable, ERROR_KINDS[result.kind].recoverable);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Casos de múltiplo match — precedência da classe NÃO-recuperável (Req 6.10)
//    Quando a mensagem casa com mais de uma classe, a não-recuperável de maior
//    precedência (duplicate_document > no_coverage > recuperáveis) vence.
// ─────────────────────────────────────────────────────────────────────────────
const MULTI_MATCH_TABLE = [
  // mensagem ambígua                                                kind vencedor esperado
  ['duplicateDocument duplicatePhone',                               'duplicate_document'],
  ['duplicatePhone duplicateDocument',                               'duplicate_document'], // ordem textual não importa
  ['duplicateDocument duplicateEmail',                               'duplicate_document'],
  ['CPF já cadastrado e celular já cadastrado',                      'duplicate_document'],
  ['duplicateDocument nenhuma cobertura ativa',                      'duplicate_document'], // doc precede coverage
  ['nenhuma cobertura ativa duplicatePhone',                         'no_coverage'],
  ['nenhuma cobertura ativa e email já cadastrado',                  'no_coverage'],
  ['nenhuma cobertura ativa, instalação já existe',                  'no_coverage'],
  ['Consumo médio não informado e duplicateDocument',               'duplicate_document'],
];

describe('classifyPortalError — múltiplo match: precedência não-recuperável (Req 6.10)', () => {
  for (const [message, expectedKind] of MULTI_MATCH_TABLE) {
    test(`"${message}" → ${expectedKind}`, () => {
      const result = classifyPortalError(message);
      assert.equal(result.kind, expectedKind, `kind para "${message}"`);
      assert.equal(result.recoverable, false, 'classe vencedora deve ser não-recuperável');
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Property 4 — Totalidade e unicidade (fast-check)
//    Para QUALQUER entrada, classifyPortalError retorna EXATAMENTE UMA classe
//    do conjunto fechado, com `recoverable` coerente com o mapa, e de forma
//    determinística.
// ─────────────────────────────────────────────────────────────────────────────

// Fragmentos que disparam cada classe de forma realista (usados nos geradores).
const MARKER_FRAGMENTS = [
  'duplicatePhone', 'celular já cadastrado', 'telefone já existe',
  'duplicateEmail', 'email já cadastrado',
  'número de instalação inválido', 'instalação já existe', 'check-installation',
  'Consumo médio não informado', 'consumo médio nao informado',
  'duplicateDocument', 'CPF já cadastrado', 'documento já existe',
  'nenhuma cobertura ativa', 'sem cobertura', 'UF não atendida', 'sem regra ativa',
  'erro interno', 'status 500', 'timeout', '',
];

// Gerador de entradas: strings arbitrárias, marcadores realistas, ruído,
// e até entradas não-string (a função normaliza via String(message ?? '')).
const messageArb = fc.oneof(
  fc.string(),
  fc.constantFrom(...MARKER_FRAGMENTS),
  // mistura de marcador + ruído arbitrário (case aleatório incluso)
  fc.tuple(fc.constantFrom(...MARKER_FRAGMENTS), fc.string(), fc.string())
    .map(([m, a, b]) => `${a} ${m} ${b}`),
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
);

describe('Property 4 — classificação total e única (Req 6.1, 6.10)', () => {
  test('toda entrada mapeia para exatamente uma classe do conjunto fechado', () => {
    fc.assert(
      fc.property(messageArb, (message) => {
        const result = classifyPortalError(message);

        // Retorno bem-formado: objeto com { kind, recoverable }.
        assert.ok(result && typeof result === 'object');
        assert.equal(typeof result.kind, 'string');
        assert.equal(typeof result.recoverable, 'boolean');

        // TOTAL: o kind é sempre membro do conjunto fechado ERROR_KINDS.
        assert.ok(KINDS.includes(result.kind), `kind inesperado: ${result.kind}`);

        // COERÊNCIA: recoverable bate com o mapa fechado.
        assert.equal(result.recoverable, ERROR_KINDS[result.kind].recoverable);
      }),
      { numRuns: 1000 },
    );
  });

  test('classificação é determinística (mesma entrada → mesma classe)', () => {
    fc.assert(
      fc.property(messageArb, (message) => {
        const a = classifyPortalError(message);
        const b = classifyPortalError(message);
        assert.deepEqual(a, b);
      }),
      { numRuns: 500 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Property 4 (cont.) — precedência determinística por construção (fast-check)
//    Combinando um fragmento NÃO-recuperável com um RECUPERÁVEL em qualquer
//    ordem, o resultado é SEMPRE a classe não-recuperável (Req 6.10).
// ─────────────────────────────────────────────────────────────────────────────

// Fragmentos que, isolados, classificam como NÃO-recuperável.
const NON_RECOVERABLE_FRAGMENTS = [
  'duplicateDocument', 'CPF já cadastrado', 'documento já existe',
  'nenhuma cobertura ativa', 'sem cobertura', 'UF não atendida', 'sem regra ativa',
];

// Fragmentos que, isolados, classificam como RECUPERÁVEL (e não disparam
// nenhum gatilho não-recuperável).
const RECOVERABLE_FRAGMENTS = [
  'duplicatePhone', 'celular já cadastrado', 'telefone já existe',
  'duplicateEmail', 'email já cadastrado',
  'número de instalação inválido', 'instalação já existe',
  'Consumo médio não informado',
];

// Ruído "seguro": dígitos, espaços e pontuação que NÃO formam nenhum marcador
// de classificação (evita falsos gatilhos ao concatenar fragmentos). Mantém o
// teste de precedência determinístico sem perder generalidade.
const safeNoiseArb = fc
  .array(fc.constantFrom(...'0123456789 -_#.,/!?:;()[]'.split('')), { maxLength: 20 })
  .map(chars => chars.join(''));

describe('Property 4 — precedência não-recuperável sobre recuperável (Req 6.10)', () => {
  test('fragmentos isolados classificam conforme esperado (pré-condição do teste)', () => {
    for (const f of NON_RECOVERABLE_FRAGMENTS) {
      assert.equal(classifyPortalError(f).recoverable, false, `"${f}" deveria ser não-recuperável`);
    }
    for (const f of RECOVERABLE_FRAGMENTS) {
      assert.equal(classifyPortalError(f).recoverable, true, `"${f}" deveria ser recuperável`);
    }
  });

  test('NR + R em qualquer ordem → vence a classe não-recuperável', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NON_RECOVERABLE_FRAGMENTS),
        fc.constantFrom(...RECOVERABLE_FRAGMENTS),
        fc.boolean(), // ordem da concatenação
        safeNoiseArb, // ruído interno sem falsos gatilhos
        (nrFrag, rFrag, nrFirst, noise) => {
          const message = nrFirst
            ? `${nrFrag} ${noise} ${rFrag}`
            : `${rFrag} ${noise} ${nrFrag}`;
          const result = classifyPortalError(message);

          assert.equal(result.recoverable, false, `esperado não-recuperável para "${message}"`);
          assert.ok(
            NON_RECOVERABLE_KINDS.includes(result.kind),
            `kind "${result.kind}" deveria ser não-recuperável para "${message}"`,
          );
        },
      ),
      { numRuns: 1000 },
    );
  });
});
