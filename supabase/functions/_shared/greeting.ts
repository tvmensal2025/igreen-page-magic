// Saudação por horário (America/Sao_Paulo) e utilidades de iniciais.

export function greetingForNow(now: Date = new Date()): string {
  // BRT = UTC-3 (sem horário de verão desde 2019).
  const sp = new Date(now.getTime() - 3 * 3600 * 1000);
  const h = sp.getUTCHours();
  if (h >= 5 && h < 12) return "Muito Bom Dia";
  if (h >= 12 && h < 18) return "Muita Boa Tarde";
  return "Muita Boa Noite";
}

export function partnerInitials(name: string | null | undefined): string {
  const clean = String(name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .trim();
  if (!clean) return "IGR";
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return (words[0].slice(0, 3) + "XX").slice(0, 3);
  }
  const first = words[0][0] ?? "";
  const mid = words[1]?.[0] ?? "";
  const last = words[2]?.[0] ?? words[words.length - 1]?.[0] ?? "";
  const ini = (first + mid + last).replace(/[^A-Z]/g, "");
  return (ini + "XXX").slice(0, 3);
}
