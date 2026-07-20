/**
 * Nome público do consultor nas mensagens ao lead (welcome, chamado, templates).
 *
 * Regra de ouro: NUNCA apresentar o lead como sendo atendido por OUTRA pessoa.
 * Bug real 2026-07-20: Rafael tinha display_name="Abel Olympio" → welcome falava Abel.
 *
 * Prioridade segura:
 * 1) Se `name` e `display_name` parecem a MESMA pessoa (overlap de tokens) → display (apelido curto)
 * 2) Se `name` é humano (tem espaço) e display NÃO overlap → usa `name` (ignora display contaminado)
 * 3) display humano sozinho → display
 * 4) name → name
 * 5) fallback "seu consultor"
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

function looksHumanName(raw: string): boolean {
  const s = String(raw || "").trim();
  if (!s || s.length < 3) return false;
  if (!/[A-Za-zÀ-ÿ]/.test(s)) return false;
  // slug/login: sem espaço, tudo minúsculo, ou com dígitos demais
  if (!/\s/.test(s) && (/^[a-z0-9._-]+$/.test(s) || /\d{3,}/.test(s))) return false;
  return true;
}

/** True se display e name compartilham ao menos 1 token significativo. */
export function displayNameMatchesOwner(name: string | null | undefined, displayName: string | null | undefined): boolean {
  const nTok = new Set(tokens(String(name || "")));
  const dTok = tokens(String(displayName || ""));
  if (nTok.size === 0 || dTok.length === 0) return false;
  return dTok.some((t) => nTok.has(t));
}

/**
 * Label seguro pra "Você será atendido por *X*" / "Consultor(a): *X*".
 */
export function resolvePublicConsultantLabel(
  name: string | null | undefined,
  displayName: string | null | undefined,
  fallback = "seu consultor",
): string {
  const n = String(name || "").trim();
  const d = String(displayName || "").trim();
  const nOk = looksHumanName(n);
  const dOk = looksHumanName(d) || (d.length >= 3 && /[A-Za-zÀ-ÿ]/.test(d));

  if (nOk && dOk) {
    if (displayNameMatchesOwner(n, d)) return shortLabel(d) || shortLabel(n) || fallback;
    // display_name de outra pessoa (ex.: Abel no cadastro do Rafael) → IGNORA
    return shortLabel(n) || fallback;
  }
  if (nOk) return shortLabel(n) || fallback;
  if (dOk) return shortLabel(d) || fallback;
  if (n) return shortLabel(n) || fallback;
  if (d) return shortLabel(d) || fallback;
  return fallback;
}
