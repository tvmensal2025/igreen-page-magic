/**
 * Property-based test — sanitize / mascaramento de PII (worker-portal-2/ai-audit.mjs)
 *
 * Spec: .kiro/specs/portal2-ocr-feedback-loop/
 * Task 3.2 — Property 8: PII sempre mascarada na borda de saída.
 * **Validates: Requirements 4.2, 12.1, 12.2, 12.4**
 *
 * Property 8 (design.md §Correctness Properties):
 *   Nenhum valor gravado em `portal2_ocr_*` / `portal2_audit_traces` nem emitido
 *   em log contém CPF/documento COMPLETO ou base64. O `sanitize` de
 *   `ai-audit.mjs` é a borda de saída reaproveitada por `server.mjs` (Task 3.1)
 *   antes de persistir os resultados de extração.
 *
 * Comportamento REAL observado em `sanitize` (asserido aqui, não suposto):
 *   - chaves `cpf` / `cpf_cnpj` / `document` / `documento` com valor string →
 *     reduzidas a `***` + os 4 últimos dígitos (CPF/documento completo nunca sai).
 *   - chaves `bill_base64` / `document_front_base64` / `fileB64` / `buffer` →
 *     SEMPRE descartadas (drop-list), independentemente do tamanho.
 *   - demais strings "tipo base64" com mais de 1500 chars e charset base64 nos
 *     primeiros 200 chars → substituídas por `[base64 omitted: N chars]`. É por
 *     essa heurística (NÃO pela drop-list) que `document_back_base64` é omitido.
 *     Imagens reais de documento/conta em base64 têm centenas de KB, logo caem
 *     sempre nessa heurística — os geradores deste teste usam blobs realistas
 *     (grandes) por isso. Ver nota de gap no final do arquivo.
 *
 * Escopo da Property 8: CPF/documento + base64. O campo `nome` é PII pelo
 * glossário, mas `sanitize` não o mascara e a Property 8 não o exige; portanto
 * NÃO asserimos mascaramento de `nome` (evita testar comportamento inexistente).
 *
 * Runner nativo do Node (ESM) — não há framework de teste no worker:
 *     node --test worker-portal-2/test/pii-masking.test.mjs
 * PBT lib: fast-check (resolvido via node_modules da raiz do repositório).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { sanitize } from '../ai-audit.mjs';

// ─── Geradores ───────────────────────────────────────────────────────────────

const digit = fc.integer({ min: 0, max: 9 });

// CPF: exatamente 11 dígitos. Gera as formas crua ("12345678904") e formatada
// ("123.456.789-04") — ambas devem desaparecer da saída.
const cpfArb = fc.array(digit, { minLength: 11, maxLength: 11 }).map((arr) => {
  const raw = arr.join('');
  const formatted = `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}-${raw.slice(9)}`;
  return { raw, formatted };
});

// Documento genérico (CPF/CNPJ/RG): 8 a 14 dígitos. Mascarado a ***+4 últimos.
const documentoArb = fc
  .array(digit, { minLength: 8, maxLength: 14 })
  .map((arr) => arr.join(''));

// Base64 REALISTA: blob grande derivado de bytes aleatórios (como uma imagem de
// documento/conta). minLength 1300 bytes → ~1736 chars de base64 (> 1500), o que
// garante o disparo da heurística para chaves fora da drop-list.
const base64Arb = fc
  .uint8Array({ minLength: 1300, maxLength: 3000 })
  .map((bytes) => Buffer.from(bytes).toString('base64'));

const bufferArb = fc
  .uint8Array({ minLength: 16, maxLength: 512 })
  .map((bytes) => Buffer.from(bytes));

// Campos não-PII plausíveis (sem runs longos de dígitos que poluiriam o oráculo).
const nomeArb = fc.constantFrom(
  'VIVIANE TESTE', 'JOÃO DA SILVA', 'MARIA SOUZA', 'CARLOS A. PEREIRA', 'ANA LÚCIA',
);
const tipoDocArb = fc.constantFrom('CNH', 'RG', 'CPF');
const tipoCompArb = fc.constantFrom('BOLETO', 'FATURA', 'CONTA');
const beneficiarioArb = fc.constantFrom('CPFL', 'ENEL SP', 'LIGHT', 'CEMIG', 'COPEL');
const nascimentoArb = fc.constantFrom('1974', '1985', '1990', '2001');
const validadeArb = fc.constantFrom('31/08/2031', '15/02/2029', '01/12/2030');
const valorArb = fc.constantFrom('150,50', '89,90', '230,00', '1.024,99');
const idArb = fc.constantFrom('val-abc', 'sol-XYZ', 'idval-7', 'corr-99');

// Resultado de extração de DOCUMENTO (shape de design.md), pré-sanitização —
// inclui CPF/documento (top-level e aninhado) e blobs base64.
const docResultArb = fc.record({
  cpf: cpfArb,
  documento: documentoArb,
  nome: nomeArb,
  nascimento: nascimentoArb,
  validade: validadeArb,
  tipoDoc: tipoDocArb,
  id: idArb,
  frontB64: base64Arb,
  backB64: base64Arb,
  fileB64: base64Arb,
  buf: bufferArb,
}).map((g) => ({
  obj: {
    success: true,
    mode: 'auto',
    error: null,
    corrections: [],
    idsolcontratovalidacao: g.id,
    // chaves de imagem cruas, como vêm do extractor antes do sanitize:
    document_front_base64: g.frontB64,
    document_back_base64: g.backB64, // NÃO está na drop-list → depende da heurística
    fileB64: g.fileB64,
    buffer: g.buf,
    cpf: g.cpf.formatted, // top-level também
    data: {
      nome: g.nome,
      cpf: g.cpf.raw,
      documento: g.documento,
      data_nascimento: g.nascimento,
      validade: g.validade,
      tipo_documento: g.tipoDoc,
    },
  },
  cpf: g.cpf,
  documento: g.documento,
  base64s: [g.frontB64, g.backB64, g.fileB64],
}));

// Resultado de extração de CONTA (shape de design.md), pré-sanitização.
const billResultArb = fc.record({
  cpf: cpfArb,
  documento: documentoArb,
  nome: nomeArb,
  valor: valorArb,
  tipoComp: tipoCompArb,
  beneficiario: beneficiarioArb,
  id: idArb,
  billB64: base64Arb,
  fileB64: base64Arb,
  buf: bufferArb,
}).map((g) => ({
  obj: {
    success: true,
    mode: 'auto',
    is_authentic: true,
    rejection_reason: null,
    error: null,
    corrections: [],
    idsolcontratovalidacao: g.id,
    bill_base64: g.billB64,
    fileB64: g.fileB64,
    buffer: g.buf,
    data: {
      nome: g.nome,
      documento: g.documento,
      cpf: g.cpf.raw,
      valor_pago: g.valor,
      tipo_comprovante: g.tipoComp,
      beneficiario: g.beneficiario,
    },
  },
  cpf: g.cpf,
  documento: g.documento,
  base64s: [g.billB64, g.fileB64],
}));

// ─── Asserção central da Property 8 ──────────────────────────────────────────
function assertNoPiiLeak(sanitized, { cpf, documento, base64s }) {
  const json = JSON.stringify(sanitized);

  // 1) CPF completo nunca sai (forma crua de 11 dígitos e forma formatada).
  assert.equal(json.includes(cpf.raw), false, `CPF cru vazou: ${cpf.raw}`);
  assert.equal(json.includes(cpf.formatted), false, `CPF formatado vazou: ${cpf.formatted}`);

  // 2) Documento completo nunca sai.
  assert.equal(json.includes(documento), false, `documento completo vazou: ${documento}`);

  // 3) Nenhum payload base64 sai.
  for (const b64 of base64s) {
    assert.equal(json.includes(b64), false, `payload base64 vazou (len=${b64.length})`);
  }

  // 4) Invariante forte: nenhuma corrida de 11+ dígitos consecutivos permanece
  //    (CPF/documento foram mascarados a ≤4 dígitos; base64 foram omitidos).
  assert.equal(
    /\d{11,}/.test(json),
    false,
    `restou uma sequência de 11+ dígitos consecutivos na saída: ${json.match(/\d{11,}/)?.[0]}`,
  );

  return json;
}

// ─── Property 8 — documento ──────────────────────────────────────────────────
describe('Property 8 — PII mascarada na borda de saída (sanitize)', () => {
  test('resultado de extração de DOCUMENTO: nunca vaza CPF/documento/base64', () => {
    fc.assert(
      fc.property(docResultArb, ({ obj, cpf, documento, base64s }) => {
        const out = sanitize(obj);
        const json = assertNoPiiLeak(out, { cpf, documento, base64s });

        // Mascaramento positivo: CPF/documento aparecem como ***+4 últimos
        // (provando que foram MASCARADOS, não apenas removidos da estrutura).
        assert.equal(out.data.cpf, `***${cpf.raw.slice(-4)}`);
        assert.equal(out.data.documento, `***${documento.slice(-4)}`);
        assert.equal(out.cpf, `***${cpf.raw.slice(-4)}`);

        // Estrutura não-PII preservada (sanitize não destrói o resultado).
        assert.equal(out.success, true);
        assert.equal(out.mode, 'auto');
        assert.equal(out.data.nome, obj.data.nome);
        assert.ok(typeof json === 'string' && json.length > 0);
      }),
      { numRuns: 250 },
    );
  });

  test('resultado de extração de CONTA: nunca vaza CPF/documento/base64', () => {
    fc.assert(
      fc.property(billResultArb, ({ obj, cpf, documento, base64s }) => {
        const out = sanitize(obj);
        assertNoPiiLeak(out, { cpf, documento, base64s });

        assert.equal(out.data.documento, `***${documento.slice(-4)}`);
        assert.equal(out.data.cpf, `***${cpf.raw.slice(-4)}`);
        assert.equal(out.is_authentic, true);
        assert.equal(out.success, true);
      }),
      { numRuns: 250 },
    );
  });
});

// ─── Exemplos determinísticos com as shapes exatas de design.md ───────────────
describe('Property 8 — exemplos com shapes de design.md', () => {
  test('doc result (CNH) — masca CPF/documento e omite base64', () => {
    const bigB64 = Buffer.alloc(2000, 7).toString('base64'); // ~2668 chars
    const input = {
      success: true,
      mode: 'auto',
      error: null,
      corrections: [],
      document_front_base64: bigB64,
      document_back_base64: bigB64,
      fileB64: bigB64,
      buffer: Buffer.from('conteudo binario do documento'),
      data: {
        nome: 'VIVIANE TESTE DA SILVA',
        cpf: '123.456.789-04',
        documento: '98765432100',
        cpf_cnpj: '12345678904',
        document: '11122233344',
        data_nascimento: '1974',
        validade: '31/08/2031',
        tipo_documento: 'CNH',
      },
    };
    const out = sanitize(input);
    const json = JSON.stringify(out);

    // CPF/documento completos ausentes
    assert.equal(json.includes('12345678904'), false);
    assert.equal(json.includes('123.456.789-04'), false);
    assert.equal(json.includes('98765432100'), false);
    assert.equal(json.includes('11122233344'), false);
    // Mascarados aos 4 últimos
    assert.equal(out.data.cpf, '***8904');
    assert.equal(out.data.documento, '***2100');
    assert.equal(out.data.cpf_cnpj, '***8904');
    assert.equal(out.data.document, '***3344');
    // base64/buffer omitidos
    assert.equal(json.includes(bigB64), false);
    assert.equal(out.document_front_base64, `[${bigB64.length}B]`);
    assert.equal(out.fileB64, `[${bigB64.length}B]`);
    assert.equal(out.buffer, '[omitted]');
    assert.match(out.document_back_base64, /^\[base64 omitted: \d+ chars\]$/);
    // nome (fora do escopo da Property 8) é preservado
    assert.equal(out.data.nome, 'VIVIANE TESTE DA SILVA');
  });

  test('bill result — masca documento/cpf e omite bill_base64', () => {
    const bigB64 = Buffer.alloc(1800, 3).toString('base64');
    const input = {
      success: true,
      mode: 'auto',
      is_authentic: true,
      rejection_reason: null,
      error: null,
      corrections: [],
      bill_base64: bigB64,
      fileB64: bigB64,
      buffer: Buffer.from('imagem da conta'),
      data: {
        nome: 'CPFL CLIENTE',
        documento: '55566677788',
        cpf: '999.888.777-66',
        valor_pago: '230,00',
        tipo_comprovante: 'BOLETO',
        beneficiario: 'CPFL PAULISTA',
      },
    };
    const out = sanitize(input);
    const json = JSON.stringify(out);

    assert.equal(json.includes('55566677788'), false);
    assert.equal(json.includes('99988877766'), false);
    assert.equal(json.includes('999.888.777-66'), false);
    assert.equal(out.data.documento, '***7788');
    assert.equal(out.data.cpf, '***7766');
    assert.equal(json.includes(bigB64), false);
    assert.equal(out.bill_base64, `[${bigB64.length}B]`);
    assert.equal(out.is_authentic, true);
  });
});

/*
 * NOTA / GAP REPORTADO (não enfraquece o teste):
 *   `sanitize` só lista 4 chaves na drop-list: bill_base64, document_front_base64,
 *   fileB64, buffer (conforme design.md). `document_back_base64` NÃO está nessa
 *   lista — ele só é omitido pela heurística de tamanho (string > 1500 chars com
 *   charset base64). Para imagens reais de documento isso sempre se aplica (são
 *   grandes), então a Property 8 vale na prática e este teste usa blobs realistas.
 *   PORÉM, um base64 PEQUENO (≤1500 chars) sob `document_back_base64` (ou outra
 *   chave fora da drop-list) NÃO seria mascarado. Se a equipe quiser robustez
 *   independente de tamanho, `document_back_base64` deveria ser adicionado à
 *   drop-list de `ai-audit.mjs#sanitize`.
 */
