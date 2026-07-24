/**
 * Predicados puros compartilhados Whapi ↔ Evolution (bot-flow).
 * Extraídos sem mudança de comportamento — anti-duplicação.
 */

export function isPositiveCheckinIntent(text: string): boolean {
  return /^(sim|s|ss+|joia|ok|okay|blz|beleza|perfeito|quero|pode|vamos|bora|seguir|claro|certo|tranquilo|entendi|deu|show|fechou)\b/i.test(text) || /[👍✅]/.test(text);
}

export function isClubProgressIntent(text: string): boolean {
  // ⚠️ "nao|não" sozinho NÃO conta como progresso (regressão fixed 2026-06-05) —
  // se o lead disser apenas "não", é recusa, não avanço pra documento.
  return isPositiveCheckinIntent(text) || /^(pode seguir|sem duvida|nenhuma|nao tenho|não tenho|tudo certo|partiu|segue)\b/i.test(text) || /(quero|vamos|bora).*(cadastr|seguir|finaliz)/i.test(text);
}

export function isComoFuncionaStep(row: any): boolean {
  return /(?:^|[_\s-])como[_\s-]*funciona|d_como_funciona/i.test(`${row?.step_key || ""} ${row?.slot_key || ""} ${row?.title || ""}`);
}

export function isConfidentDocDetection(det: any): boolean {
  if (!det || det.source === "fallback") return false;
  const conf = Number(det.confianca || 0);
  const tipo = String(det.tipo || "").toLowerCase();
  if (tipo === "cnh") return conf >= 0.62;
  return conf >= 0.78;
}
