/** Formata telefone BR para rodapé do flyer (+55 (DD) …). */
export function formatFlyerPhoneDisplay(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  const noCountry = digits.startsWith("55") ? digits.slice(2) : digits;
  if (noCountry.length === 11) {
    return `+55 (${noCountry.slice(0, 2)}) ${noCountry.slice(2, 7)}-${noCountry.slice(7)}`;
  }
  if (noCountry.length === 10) {
    return `+55 (${noCountry.slice(0, 2)}) ${noCountry.slice(2, 6)}-${noCountry.slice(6)}`;
  }
  return phone || "";
}
