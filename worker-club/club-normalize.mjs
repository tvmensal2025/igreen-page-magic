/**
 * Normalizers oficiais do iGreen Club (Conexão Club).
 * Espelham máscaras/Zod da SPA — ver CLUB-OFICIAL.md §4 e §6.
 *
 * Regra: o POST /cliente/club leva máscaras no body (não ISO, não só dígitos).
 */

/** IDs IBGE de UF (confirmados via /api/v1/localidades/estados). */
export const UF_IBGE = Object.freeze({
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17,
  MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29,
  MG: 31, ES: 32, RJ: 33, SP: 35,
  PR: 41, SC: 42, RS: 43,
  MS: 50, MT: 51, GO: 52, DF: 53,
});

const IBGE_TO_UF = Object.freeze(
  Object.fromEntries(Object.entries(UF_IBGE).map(([uf, id]) => [String(id), uf])),
);

export function onlyDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

export function formatCpf(raw) {
  const d = onlyDigits(raw);
  if (d.length !== 11) return null;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Valida dígitos verificadores do CPF (mesmo espírito do kf.cpf oficial). */
export function isValidCpf(raw) {
  const d = onlyDigits(raw);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i);
  let rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  if (rest !== Number(d[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d[i]) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  return rest === Number(d[10]);
}

export function formatCep(raw) {
  const d = onlyDigits(raw);
  if (d.length !== 8) return null;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/**
 * Celular BR no formato oficial: (dd) 9xxxx-xxxx
 * Zod exige min 14 chars COM máscara.
 * Normaliza DDI 55 sem corromper DDD (não usar slice(-11) cego).
 */
export function formatCelular(raw) {
  let d = onlyDigits(raw);
  while (d.startsWith('0') && d.length > 11) d = d.slice(1);
  if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1);
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length > 11) d = d.slice(-11);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return null;
}

export function isValidCelular(raw) {
  const formatted = formatCelular(raw);
  if (!formatted || formatted.length < 14) return false;
  const n = onlyDigits(formatted);
  if (n.length < 10 || n.length > 11) return false;
  const ddd = Number(n.slice(0, 2));
  return ddd >= 11 && ddd <= 99;
}

/**
 * Aceita dd/mm/aaaa, aaaa-mm-dd ou Date.
 * Oficial envia SEMPRE dd/mm/aaaa no POST.
 */
export function formatDateBr(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const dd = String(raw.getUTCDate()).padStart(2, '0');
    const mm = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = String(raw.getUTCFullYear());
    return `${dd}/${mm}/${yyyy}`;
  }
  const s = String(raw ?? '').trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    const [, dd, mm, yyyy] = br;
    if (!isValidDateParts(+yyyy, +mm, +dd)) return null;
    return `${dd}/${mm}/${yyyy}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, yyyy, mm, dd] = iso;
    if (!isValidDateParts(+yyyy, +mm, +dd)) return null;
    return `${dd}/${mm}/${yyyy}`;
  }
  const digits = onlyDigits(s);
  if (digits.length === 8) {
    // assume ddmmyyyy
    const dd = digits.slice(0, 2);
    const mm = digits.slice(2, 4);
    const yyyy = digits.slice(4);
    if (!isValidDateParts(+yyyy, +mm, +dd)) return null;
    return `${dd}/${mm}/${yyyy}`;
  }
  return null;
}

function isValidDateParts(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function normalizeUf(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toUpperCase();
  if (UF_IBGE[s]) return s;
  const asId = IBGE_TO_UF[onlyDigits(s)];
  if (asId) return asId;
  // nome por extenso comum
  const NAMES = {
    'SAO PAULO': 'SP', 'SÃO PAULO': 'SP',
    'RIO DE JANEIRO': 'RJ', 'MINAS GERAIS': 'MG',
    'DISTRITO FEDERAL': 'DF', 'ESPIRITO SANTO': 'ES', 'ESPÍRITO SANTO': 'ES',
  };
  return NAMES[s] || null;
}

export function ufToIbgeId(uf) {
  const n = normalizeUf(uf);
  return n ? UF_IBGE[n] : null;
}

export function isValidEmail(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 200) return false;
  // Oficial filtra chars com /^[a-zA-Z0-9@._-]*$/ no input; email Zod no schema.
  if (!/^[a-zA-Z0-9@._-]+$/.test(s)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Monta o body oficial do POST /cliente/club (PF).
 * Input flexível (CRM/Supabase); output = shape interceptado na SPA.
 */
export function montarPayloadClubPf(input = {}) {
  const errors = [];
  const idconsultor = Number(input.idconsultor ?? input.sponsorId ?? 0);
  if (!Number.isFinite(idconsultor) || idconsultor <= 0) errors.push('idconsultor inválido');

  const indcli = Number(input.indcli ?? input.cli ?? 0) || 0;

  const cpf_cnpj = formatCpf(input.cpf_cnpj ?? input.cpf ?? input.document);
  if (!cpf_cnpj || !isValidCpf(cpf_cnpj)) errors.push('cpf inválido');

  const nome = String(input.nome ?? input.name ?? '').trim().replace(/\s+/g, ' ');
  if (nome.length < 5) errors.push('nome min 5');

  const dtnasc = formatDateBr(input.dtnasc ?? input.dataNascimento ?? input.birthDate ?? input.birth_date);
  if (!dtnasc) errors.push('dtnasc inválida (use dd/mm/aaaa)');

  const rg = String(input.rg ?? '').trim();
  if (rg.length < 5) errors.push('rg min 5');

  const email = String(input.email ?? '').trim().toLowerCase();
  if (!isValidEmail(email)) errors.push('email inválido');

  const celular = formatCelular(input.celular ?? input.whatsapp ?? input.phone ?? input.phone_whatsapp);
  if (!celular || !isValidCelular(celular)) errors.push('celular inválido');

  const cep = formatCep(input.cep);
  if (!cep) errors.push('cep inválido');

  const endereco = String(input.endereco ?? input.logradouro ?? input.street ?? '').trim();
  if (endereco.length < 3) errors.push('endereco min 3');

  const numero = String(input.numero ?? input.number ?? '').trim();
  if (!numero) errors.push('numero obrigatório');

  const complemento = String(input.complemento ?? input.complement ?? '').trim();

  const bairro = String(input.bairro ?? input.neighborhood ?? '').trim();
  if (bairro.length < 2) errors.push('bairro min 2');

  const uf = normalizeUf(input.uf ?? input.state);
  if (!uf) errors.push('uf inválida');

  const uf_select = Number(input.uf_select ?? ufToIbgeId(uf) ?? 0);
  if (!uf_select || !IBGE_TO_UF[String(uf_select)]) errors.push('uf_select (IBGE) inválido');

  const cidade = String(input.cidade ?? input.city ?? '').trim();
  if (cidade.length < 3) errors.push('cidade min 3');

  if (errors.length) {
    const err = new Error(`payload_invalido: ${errors.join('; ')}`);
    err.code = 'PAYLOAD_INVALID';
    err.details = errors;
    throw err;
  }

  return {
    cpf_cnpj,
    nome,
    dtnasc,
    rg,
    email,
    celular,
    cep,
    endereco,
    numero,
    complemento,
    bairro,
    uf,
    uf_select,
    cidade,
    indcli,
    idconsultor,
  };
}

/** Remove PII de logs. */
export function maskPii(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  if (out.cpf_cnpj) out.cpf_cnpj = String(out.cpf_cnpj).replace(/\d(?=\d{2})/g, '*');
  if (out.celular) out.celular = String(out.celular).replace(/\d(?=\d{4})/g, '*');
  if (out.email) {
    const [u, d] = String(out.email).split('@');
    out.email = `${(u || '').slice(0, 2)}***@${d || ''}`;
  }
  if (out.rg) out.rg = '***';
  return out;
}
