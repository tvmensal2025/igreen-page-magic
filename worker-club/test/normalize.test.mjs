import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCpf,
  isValidCpf,
  formatCep,
  formatCelular,
  formatDateBr,
  normalizeUf,
  ufToIbgeId,
  montarPayloadClubPf,
  isValidEmail,
} from '../club-normalize.mjs';

describe('club-normalize — máscaras oficiais', () => {
  it('formata CPF com pontuação', () => {
    assert.equal(formatCpf('11144477735'), '111.444.777-35');
    assert.equal(isValidCpf('11144477735'), true);
    assert.equal(isValidCpf('11111111111'), false);
  });

  it('formata CEP e celular como a SPA', () => {
    assert.equal(formatCep('01310100'), '01310-100');
    assert.equal(formatCelular('11987654321'), '(11) 98765-4321');
    assert.equal(formatCelular('5511987654321'), '(11) 98765-4321');
  });

  it('mantém dtnasc em dd/mm/aaaa (não ISO)', () => {
    assert.equal(formatDateBr('01/01/1990'), '01/01/1990');
    assert.equal(formatDateBr('1990-01-01'), '01/01/1990');
    assert.equal(formatDateBr('01011990'), '01/01/1990');
  });

  it('resolve UF → id IBGE', () => {
    assert.equal(normalizeUf('sp'), 'SP');
    assert.equal(normalizeUf(35), 'SP');
    assert.equal(ufToIbgeId('SP'), 35);
    assert.equal(ufToIbgeId('RJ'), 33);
  });

  it('valida email no charset da SPA', () => {
    assert.equal(isValidEmail('a@b.com'), true);
    assert.equal(isValidEmail('a+b@c.com'), false);
  });
});

describe('montarPayloadClubPf — shape oficial', () => {
  it('gera body igual ao interceptado na SPA', () => {
    const p = montarPayloadClubPf({
      idconsultor: 124170,
      cpf: '11144477735',
      nome: 'TESTE MAPEAMENTO WORKER CLUB',
      dtnasc: '01/01/1990',
      rg: '123456789',
      email: 'teste.mapeamento.worker.club@example.com',
      celular: '11987654321',
      cep: '01310100',
      endereco: 'Avenida Paulista',
      numero: '100',
      bairro: 'Bela Vista',
      cidade: 'São Paulo',
      uf: 'SP',
    });
    assert.deepEqual(p, {
      cpf_cnpj: '111.444.777-35',
      nome: 'TESTE MAPEAMENTO WORKER CLUB',
      dtnasc: '01/01/1990',
      rg: '123456789',
      email: 'teste.mapeamento.worker.club@example.com',
      celular: '(11) 98765-4321',
      cep: '01310-100',
      endereco: 'Avenida Paulista',
      numero: '100',
      complemento: '',
      bairro: 'Bela Vista',
      uf: 'SP',
      uf_select: 35,
      cidade: 'São Paulo',
      indcli: 0,
      idconsultor: 124170,
    });
  });

  it('rejeita payload incompleto', () => {
    assert.throws(() => montarPayloadClubPf({ idconsultor: 1, cpf: '111' }), /payload_invalido/);
  });
});
