import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyClubError, ERROR_KINDS } from '../club-errors.mjs';

describe('classifyClubError', () => {
  it('classifica payload inválido', () => {
    const e = Object.assign(new Error('payload_invalido: cpf'), { code: 'PAYLOAD_INVALID' });
    const c = classifyClubError(e);
    assert.equal(c.kind, ERROR_KINDS.PAYLOAD_INVALID);
    assert.equal(c.retry, false);
  });

  it('classifica duplicate', () => {
    const c = classifyClubError(new Error('Cliente já cadastrado'));
    assert.equal(c.kind, ERROR_KINDS.DUPLICATE);
  });

  it('classifica transport/timeout como retry', () => {
    const c = classifyClubError(new Error('fetch in-page falhou: timeout'));
    assert.equal(c.kind, ERROR_KINDS.TRANSPORT);
    assert.equal(c.retry, true);
  });
});
