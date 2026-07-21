/**
 * Nome público do consultor nas mensagens ao lead (espelho de
 * supabase/functions/_shared/consultant-public-label.ts).
 *
 * NUNCA apresentar outra pessoa (bug Abel no cadastro do Rafael).
 * NUNCA vazar username/slug (bug silviaclaudiaalmeida).
 */

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function tokens(s: string): string[] {
  return stripDiacritics(String(s || "").toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function shortLabel(raw: string): string {
  return String(raw || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
}

/** Login/slug: sem espaço, minúsculo, tipo username. Nunca vai pro lead. */
export function isSlugLikeConsultantLabel(raw: string | null | undefined): boolean {
  const s = String(raw || "").trim();
  if (!s) return false;
  if (/\s/.test(s)) return false;
  return /^[a-z0-9._-]+$/.test(s) || /\d{3,}/.test(s);
}

export function looksHumanConsultantName(raw: string | null | undefined): boolean {
  const s = String(raw || "").trim();
  if (!s || s.length < 3) return false;
  if (!/[A-Za-zÀ-ÿ]/.test(s)) return false;
  if (isSlugLikeConsultantLabel(s)) return false;
  return true;
}

export function displayNameMatchesOwner(
  name: string | null | undefined,
  displayName: string | null | undefined,
): boolean {
  const nTok = new Set(tokens(String(name || "")));
  const dTok = tokens(String(displayName || ""));
  if (nTok.size === 0 || dTok.length === 0) return false;
  return dTok.some((t) => nTok.has(t));
}

/** Label seguro: "Você será atendido por *X*". Nunca username/slug. */
export function resolvePublicConsultantLabel(
  name: string | null | undefined,
  displayName: string | null | undefined,
  fallback = "seu consultor",
): string {
  const n = String(name || "").trim();
  const d = String(displayName || "").trim();
  const nOk = looksHumanConsultantName(n);
  const dOk = looksHumanConsultantName(d);

  if (nOk && dOk) {
    if (displayNameMatchesOwner(n, d)) return shortLabel(d) || shortLabel(n) || fallback;
    return shortLabel(n) || fallback;
  }
  if (nOk) return shortLabel(n) || fallback;
  if (dOk) return shortLabel(d) || fallback;
  return fallback;
}

/** Prenome a partir do label público seguro. */
export function firstNameFromPublicConsultant(
  name: string | null | undefined,
  displayName: string | null | undefined,
): string {
  const label = resolvePublicConsultantLabel(name, displayName, "");
  if (!label || label === "seu consultor") return "";
  return label.split(/\s+/)[0] || label;
}
