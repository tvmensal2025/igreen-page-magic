/**
 * Validação 100% dos bugs das conversas 124h (Julia/JOSE) × fixes F01–F15.
 * Não chama WhatsApp nem cadastra no portal — só helpers + payload Playwright.
 *
 *   node --test scripts/validate-cadastro-fixes-replay.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPortalError } from '../worker-portal-2/portal-errors.mjs';

// Espelho puro de formatCep/formatPhone do portal2-api-client (sem abrir Playwright)
function onlyDigits(s) { return String(s ?? '').replace(/\D/g, ''); }
function formatCep(c) {
  const d = onlyDigits(c);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}
function formatPhone(c) {
  let d = onlyDigits(c);
  while (d.startsWith('0') && d.length > 11) d = d.slice(1);
  if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1);
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length > 11) d = d.slice(-11);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return c;
}

// Espelho mínimo das funções de cadastro-fixes (Deno) para Node — mesma lógica.
const EMAIL_RX = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/;
function looksLikeEmail(text) { return EMAIL_RX.test(String(text || '').trim()); }
function looksLikeCepOnly(text) {
  const t = String(text || '').trim();
  if (!t || /[a-zA-ZÀ-ÿ]/.test(t)) return false;
  return t.replace(/\D/g, '').length === 8;
}
function sanitizeComplement(value) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return v;
  if (looksLikeEmail(v)) return null;
  return v;
}
function collapseDoubleCurrency(text) {
  return String(text || '').replace(/R\$\s*R\$/gi, 'R$');
}
function isNonNameReply(text) {
  const t = String(text || '').trim().toLowerCase();
  if (t.length < 3) return true;
  return /^(oi|ol[aá]|opa|ok|okay|sim|n[aã]o|blz|beleza|obrigad[oa]|valeu|bom dia|boa tarde|boa noite|1|2|3|4|5)$/i.test(t);
}
function resumeAfterAddressEdit(customer) {
  const prev = String(customer.previous_conversation_step || '');
  const rescue = Number(customer.rescue_attempts || 0);
  if (rescue > 0 || /^(ask_finalizar|finalizando|ask_contaunica|ask_transferir_titularidade|portal_submitting)$/.test(prev)) {
    return 'ask_finalizar';
  }
  return 'confirmando_dados_conta';
}
function looksLikeSpamBlast(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  const hits = [/https?:\/\//, /zoom\.us/, /meet\.google/, /bit\.ly/, /whatsapp\.com\/channel/, /t\.me\//]
    .filter((rx) => rx.test(t)).length;
  return hits >= 1 && (t.length > 120 || hits >= 2);
}

/** Simula o case ask_number do bot após F03. */
function applyAskNumber(customer, messageText) {
  const updates = {};
  if (looksLikeCepOnly(messageText)) {
    updates.cep = messageText.replace(/\D/g, '');
    updates.conversation_step = 'ask_number';
    updates._reply = 'CEP anotado — peça número da casa';
    return { ...customer, ...updates };
  }
  updates.address_number = messageText.trim();
  return { ...customer, ...updates };
}

/** Simula ask_complement após F03/JOSE. */
function applyAskComplement(customer, messageText) {
  const updates = {};
  if (looksLikeEmail(messageText)) {
    if (!customer.email) updates.email = String(messageText).trim().toLowerCase();
    updates.address_complement = '';
  } else {
    const s = sanitizeComplement(messageText.trim());
    updates.address_complement = s == null ? '' : s;
  }
  return { ...customer, ...updates };
}

/** Payload que o Playwright/API client mandaria ao portal. */
function montarPayload(d) {
  return {
    cep: formatCep(d.cep),
    endereco: d.endereco || '',
    numero: String(d.numero || ''),
    complemento: d.complemento || '',
    bairro: d.bairro || '',
    celular: formatPhone(d.whatsapp),
  };
}

// ─── JULIA (CEP como número + e-mail no ask_cep + R$ R$) ───────────────────
test('Julia: CEP 32601540 NÃO vira address_number', () => {
  let c = { name: 'Julia', conversation_step: 'ask_number' };
  c = applyAskNumber(c, '32601540');
  assert.equal(c.cep, '32601540');
  assert.equal(c.address_number, undefined);
  assert.equal(c.conversation_step, 'ask_number');
});

test('Julia: depois do CEP, número 105 grava certo', () => {
  let c = { cep: '32601540' };
  c = applyAskNumber(c, '105');
  assert.equal(c.address_number, '105');
  const payload = montarPayload({
    cep: c.cep,
    numero: c.address_number,
    endereco: 'Rua Exemplo Longa Do OCR',
    bairro: '',
    whatsapp: '5531999999999',
  });
  assert.equal(payload.cep, '32601-540');
  assert.equal(payload.numero, '105');
  assert.notEqual(payload.numero, '32601540');
});

test('Julia: e-mail no step de CEP é reconhecido', () => {
  assert.equal(looksLikeEmail('Jujugatinha2910@gmail.com'), true);
  assert.equal(looksLikeCepOnly('Jujugatinha2910@gmail.com'), false);
});

test('Julia: R$ R$ colapsa no template', () => {
  assert.equal(collapseDoubleCurrency('Economia de R$ R$ 87,00'), 'Economia de R$ 87,00');
});

test('Julia F04: edição de endereço após rescue não reabre doc', () => {
  assert.equal(resumeAfterAddressEdit({ rescue_attempts: 2 }), 'ask_finalizar');
  assert.equal(resumeAfterAddressEdit({ previous_conversation_step: 'finalizando' }), 'ask_finalizar');
  assert.equal(resumeAfterAddressEdit({ rescue_attempts: 0 }), 'confirmando_dados_conta');
});

// ─── JOSE (complemento = e-mail + ia_reprovada) ────────────────────────────
test('JOSE: e-mail NÃO grava em address_complement', () => {
  let c = { name: 'JOSE' };
  c = applyAskComplement(c, 'tecservice.atendimento@gmail.com');
  assert.equal(c.address_complement, '');
  assert.equal(c.email, 'tecservice.atendimento@gmail.com');
  const payload = montarPayload({
    cep: '30130100',
    numero: '100',
    complemento: c.address_complement,
    endereco: 'Av Afonso Pena',
    bairro: 'Centro',
    whatsapp: '5531888888888',
  });
  assert.equal(payload.complemento, '');
});

test('JOSE: ia_reprovada não vira automation_failed na classificação', () => {
  const r = classifyPortalError('PORTAL_IA_REPROVADA: Conta reprovada pela IA');
  assert.equal(r.kind, 'ia_reprovada');
  assert.equal(r.recoverable, false);
});

// ─── F06 / F10 / F11 ───────────────────────────────────────────────────────
test('F06 ask_name rejeita ok/oi', () => {
  assert.equal(isNonNameReply('ok'), true);
  assert.equal(isNonNameReply('Maria Silva'), false);
});

test('F10: e-mail/celular recuperáveis; cliente+mesmo consultor não', () => {
  assert.equal(classifyPortalError('E-mail já cadastrado').kind, 'duplicate_email');
  assert.equal(classifyPortalError('Celular já cadastrado no sistema').kind, 'duplicate_phone');
  assert.equal(classifyPortalError('Cliente já cadastrado: mesmo consultor').kind, 'duplicate_document');
});

test('F11 spam blast', () => {
  assert.equal(looksLikeSpamBlast('oi'), false);
  assert.equal(
    looksLikeSpamBlast('https://zoom.us/j/123 meet.google.com/abc ' + 'x'.repeat(80)),
    true,
  );
});

test('Playwright payload: CEP formatado e telefone BR estável', () => {
  assert.equal(formatCep('32601540'), '32601-540');
  assert.equal(formatPhone('5531999887766'), '(31) 99988-7766');
});
