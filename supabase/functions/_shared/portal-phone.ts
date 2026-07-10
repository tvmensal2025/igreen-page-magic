/**
 * Telefone BR (energia só no Brasil) — DDI 55 é fixo.
 *
 * Fonte única da regra de prioridade do Portal 2:
 *   1) portal2_celular_alt  — digitado em ask_phone / correção
 *   2) phone_landline       — confirmado (phone_contact_confirmed)
 *   3) phone_whatsapp       — chave da conversa (fallback; NÃO sobrescrever)
 *
 * Espelhos (manter em sync):
 *   - worker-portal-2/portal-phone.mjs
 *   - src/lib/captacao/portalPhone.ts
 *
 * BUG Osmar (2026-07-10): `slice(-11)` em WA com 12 dígitos (55+DDD+8)
 * corrompia o DDD (5534… → 53…). Sempre use toNationalPhoneDigits /
 * toWhatsappCanonical — nunca slice(-11) em número com DDI.
 */

export const BR_DDI = "55";

export function digitsOnlyPhone(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/**
 * DDD+número (10–11 dígitos), sem DDI 55.
 * Aceita: 5511999…, 11999…, 034999… (zero à esquerda), (11) 99999-8888.
 */
export function toNationalPhoneDigits(raw: string | null | undefined): string {
  let d = digitsOnlyPhone(raw);
  // Remove zeros à esquerda comuns ao digitar "034 9…"
  while (d.startsWith("0") && d.length > 11) d = d.slice(1);
  if (d.startsWith("0") && (d.length === 11 || d.length === 12)) d = d.slice(1);
  // DDI 55 fixo (Brasil)
  if (d.startsWith(BR_DDI) && d.length >= 12) d = d.slice(BR_DDI.length);
  // Ainda com lixo à esquerda (ex.: DDI duplicado 5555…)
  if (d.startsWith(BR_DDI) && d.length >= 12) d = d.slice(BR_DDI.length);
  if (d.length > 11) d = d.slice(-11);
  return d;
}

/** Formato canônico com DDI 55 (como phone_whatsapp no banco). */
export function toWhatsappCanonical(raw: string | null | undefined): string {
  const national = toNationalPhoneDigits(raw);
  if (national.length < 10) return digitsOnlyPhone(raw);
  return national.startsWith(BR_DDI) ? national : `${BR_DDI}${national}`;
}

/** Formata DDD+número para phone_landline: (DD) XXXXX-XXXX ou (DD) XXXX-XXXX. */
export function formatBrLandline(raw: string | null | undefined): string | null {
  const n = toNationalPhoneDigits(raw);
  if (n.length === 11) return n.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (n.length === 10) return n.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return null;
}

/** True se parece telefone BR válido (10–11 dígitos nacionais). */
export function isValidBrNationalPhone(raw: string | null | undefined): boolean {
  const n = toNationalPhoneDigits(raw);
  if (n.length < 10 || n.length > 11) return false;
  const ddd = Number(n.slice(0, 2));
  return ddd >= 11 && ddd <= 99;
}

/**
 * Resolve o `whatsapp`/`celular` do payload Portal 2.
 */
export function resolvePortalWhatsapp(c: {
  portal2_celular_alt?: string | null;
  phone_landline?: string | null;
  phone_contact_confirmed?: boolean | null;
  phone_whatsapp?: string | null;
}): string {
  const alt = toNationalPhoneDigits(c.portal2_celular_alt);
  if (alt.length >= 10) return toWhatsappCanonical(alt);

  if (c.phone_contact_confirmed === true) {
    const land = toNationalPhoneDigits(c.phone_landline);
    if (land.length >= 10) return toWhatsappCanonical(land);
  }

  return String(c.phone_whatsapp || "");
}
