/**
 * Telefone BR (energia só no Brasil) — DDI 55 é fixo.
 * Espelhado em supabase/functions/_shared/portal-phone.ts — manter em sync.
 *
 * Ordem:
 *   1) portal2_celular_alt
 *   2) phone_landline (se phone_contact_confirmed)
 *   3) phone_whatsapp
 *
 * Nunca use slice(-11) em número com DDI — corrompe WA de 12 dígitos (caso Osmar).
 */

export const BR_DDI = '55';

export function digitsOnlyPhone(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

export function toNationalPhoneDigits(raw) {
  let d = digitsOnlyPhone(raw);
  while (d.startsWith('0') && d.length > 11) d = d.slice(1);
  if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1);
  if (d.startsWith(BR_DDI) && d.length >= 12) d = d.slice(BR_DDI.length);
  if (d.startsWith(BR_DDI) && d.length >= 12) d = d.slice(BR_DDI.length);
  if (d.length > 11) d = d.slice(-11);
  return d;
}

export function toWhatsappCanonical(raw) {
  const national = toNationalPhoneDigits(raw);
  if (national.length < 10) return digitsOnlyPhone(raw);
  return national.startsWith(BR_DDI) ? national : `${BR_DDI}${national}`;
}

export function formatBrLandline(raw) {
  const n = toNationalPhoneDigits(raw);
  if (n.length === 11) return n.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (n.length === 10) return n.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return null;
}

export function isValidBrNationalPhone(raw) {
  const n = toNationalPhoneDigits(raw);
  if (n.length < 10 || n.length > 11) return false;
  const ddd = Number(n.slice(0, 2));
  return ddd >= 11 && ddd <= 99;
}

export function resolvePortalWhatsapp(c = {}) {
  const alt = toNationalPhoneDigits(c.portal2_celular_alt);
  if (alt.length >= 10) return toWhatsappCanonical(alt);

  if (c.phone_contact_confirmed === true) {
    const land = toNationalPhoneDigits(c.phone_landline);
    if (land.length >= 10) return toWhatsappCanonical(land);
  }

  return String(c.phone_whatsapp || '');
}
