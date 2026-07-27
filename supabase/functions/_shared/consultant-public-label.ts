/**
 * Nome público do consultor nas mensagens ao lead (welcome, chamado, templates).
 *
 * Regra de ouro:
 *  1) NUNCA apresentar o lead como sendo atendido por OUTRA pessoa
 *     (bug 2026-07-20: Rafael com display_name="Abel Olympio").
 *  2) NUNCA vazar username/slug de login no WhatsApp
 *     (bug 2026-07-21: silviaclaudiaalmeida / tvmensal12 / elizavip4545…).
 *  3) Artigo/gênero: "Aqui é o/a …" e fallback "o consultor" / "a consultora"
 *     (nunca "Aqui é consultor" sem artigo).
 *
 * Prioridade segura:
 * 1) name + display da MESMA pessoa → display (apelido curto)
 * 2) name humano e display de outra pessoa → name (ignora display contaminado)
 * 3) só name humano → name
 * 4) só display humano → display
 * 5) slug/lixo/vazio → fallback ("seu consultor" / "sua consultora")
 */

export type ConsultantGender = "consultor" | "consultora";

/** Artigo definido: o (consultor) | a (consultora). Default: o. */
export function oAConsultor(gender?: ConsultantGender | string | null): "o" | "a" {
  return String(gender || "").trim() === "consultora" ? "a" : "o";
}

/** do (consultor) | da (consultora). Default: do. */
export function doDaConsultor(gender?: ConsultantGender | string | null): "do" | "da" {
  return String(gender || "").trim() === "consultora" ? "da" : "do";
}

/**
 * Gênero do consultor para textos (do/da, o/a).
 * Usa Dados → gender; se vazio, infere pelo primeiro nome (Sirlene → consultora).
 */
export function resolveConsultantRoleGender(
  gender: string | null | undefined,
  nameHint?: string | null,
): ConsultantGender {
  const g = String(gender || "").trim();
  if (g === "consultora" || g === "consultor") return g;
  const first = String(nameHint || "").trim().split(/\s+/)[0] || "";
  const n = first
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!n) return "consultor";
  if (/^(rene|eugene|luca|nicola|joshua|andrea)$/.test(n)) return "consultor";
  if (/(ene|ine|ane|elle|ette|ice|cia|lia|ria)$/.test(n)) return "consultora";
  if (n.endsWith("a")) return "consultora";
  return "consultor";
}

/** Nome da IA do consultor — nunca herdar "Sofia" de outro. */
export const DEFAULT_ASSISTANT_DISPLAY_NAME = "Assistente";

export function resolveAssistantDisplayName(
  assistantName: string | null | undefined,
): string {
  const n = String(assistantName || "").trim();
  return n || DEFAULT_ASSISTANT_DISPLAY_NAME;
}

/** Fallback possessivo: "seu consultor" | "sua consultora". */
export function possessiveConsultantFallback(
  gender?: ConsultantGender | string | null,
): string {
  return String(gender || "").trim() === "consultora" ? "sua consultora" : "seu consultor";
}

/**
 * Label pra "Aqui é o/a *X*": nome humano, senão substantivo "consultor"/"consultora"
 * (o artigo {{o_a_consultor}} fica no template → "é o consultor" / "é a consultora").
 */
export function resolveConsultantPresentationLabel(
  name: string | null | undefined,
  displayName: string | null | undefined,
  gender?: ConsultantGender | string | null,
): string {
  const label = resolvePublicConsultantLabel(name, displayName, "");
  if (label) return label;
  return String(gender || "").trim() === "consultora" ? "consultora" : "consultor";
}

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
  // tudo minúsculo alfanumérico/._-  OU tem 3+ dígitos (tvmensal12, elizavip4545)
  return /^[a-z0-9._-]+$/.test(s) || /\d{3,}/.test(s);
}

export function looksHumanConsultantName(raw: string | null | undefined): boolean {
  const s = String(raw || "").trim();
  if (!s || s.length < 3) return false;
  if (!/[A-Za-zÀ-ÿ]/.test(s)) return false;
  if (isSlugLikeConsultantLabel(s)) return false;
  return true;
}

/** True se display e name compartilham ao menos 1 token significativo. */
export function displayNameMatchesOwner(
  name: string | null | undefined,
  displayName: string | null | undefined,
): boolean {
  const nTok = new Set(tokens(String(name || "")));
  const dTok = tokens(String(displayName || ""));
  if (nTok.size === 0 || dTok.length === 0) return false;
  return dTok.some((t) => nTok.has(t));
}

/**
 * Label seguro pra "Você será atendido por *X*" / "Aqui é *{{consultor}}*".
 * Nunca devolve username/slug de login (ex.: silviaclaudiaalmeida).
 */
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
    // display_name de outra pessoa (ex.: Abel no cadastro do Rafael) → IGNORA
    return shortLabel(n) || fallback;
  }
  if (nOk) return shortLabel(n) || fallback;
  if (dOk) return shortLabel(d) || fallback;
  // slug/lixo → fallback. Nunca vazar login no WhatsApp.
  return fallback;
}

/** Prenome seguro pra templates/SMS/WA. Slug → "". */
export function resolvePublicConsultantFirstName(
  name: string | null | undefined,
  displayName: string | null | undefined,
): string {
  const label = resolvePublicConsultantLabel(name, displayName, "");
  if (!label) return "";
  return label.split(/\s+/)[0] || "";
}
