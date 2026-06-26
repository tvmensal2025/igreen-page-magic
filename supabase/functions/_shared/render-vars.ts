/**
 * Helper único para substituir variáveis de template em mensagens enviadas ao cliente.
 *
 * Tolerante a:
 *  - Caixa: {nome}, {Nome}, {NOME}, {{Nome}}…
 *  - Chaves: {nome} ou {{nome}}
 *  - Espaços: {{  nome  }}
 *
 * Substitui também sinônimos comuns: {primeiro_nome}, {first_name}, {name}.
 *
 * IMPORTANTE: NUNCA deixar uma chave `{...}` ou `{{...}}` reconhecida ir para o cliente.
 */

export type RenderVars = {
  name?: string | null;
  phone?: string | null;
  cpf?: string | null;
  representante?: string | null;
  /** Nome humano explícito do consultor (consultants.display_name). Quando preenchido, tem prioridade sobre `representante` — evita vazar username/slug. */
  representante_display?: string | null;
  valor_conta?: number | string | null;
  extra?: Record<string, string | number | null | undefined>;
};

const NAME_KEYS = new Set([
  "nome",
  "nome_completo",
  "name",
  "first_name",
  "primeiro_nome",
  "cliente",
]);

const PHONE_KEYS = new Set(["telefone", "phone", "celular", "whatsapp", "numero", "número"]);
const CPF_KEYS = new Set(["cpf", "documento", "doc"]);
const REP_KEYS = new Set([
  "representante",
  "consultor",
  "consultora",
  "atendente",
  "vendedor",
  "vendedora",
]);
const BILL_KEYS = new Set([
  "valor",
  "valor_conta",
  "conta",
  "fatura",
]);

function fmtBRL(v: number) {
  try {
    return v.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return String(v.toFixed(2));
  }
}

function firstNameOf(full: string | null | undefined): string {
  const s = String(full || "").trim();
  if (!s) return "";
  return s.split(/\s+/)[0] || "";
}

/**
 * Renderiza variáveis num texto. Aceita {chave} e {{chave}} em qualquer caixa,
 * com espaços ao redor. Chaves desconhecidas são REMOVIDAS (sem deixar `{...}`
 * vazar pro cliente).
 */
export function renderTemplateVars(text: string | null | undefined, vars: RenderVars): string {
  if (!text) return "";
  const name = String(vars.name || "").trim();
  const firstName = firstNameOf(name);
  const phoneRaw = String(vars.phone || "").replace(/\D/g, "");
  // Telefone "humano": (11) 99999-8888 quando possível
  let phoneFmt = phoneRaw;
  const pNoCc = phoneRaw.startsWith("55") && phoneRaw.length >= 12 ? phoneRaw.slice(2) : phoneRaw;
  if (pNoCc.length === 11) phoneFmt = `(${pNoCc.slice(0,2)}) ${pNoCc.slice(2,7)}-${pNoCc.slice(7)}`;
  else if (pNoCc.length === 10) phoneFmt = `(${pNoCc.slice(0,2)}) ${pNoCc.slice(2,6)}-${pNoCc.slice(6)}`;
  const cpfRaw = String(vars.cpf || "").replace(/\D/g, "");
  const cpfFmt = cpfRaw.length === 11
    ? cpfRaw.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
    : cpfRaw;
  // Fallback duplo: cobre `null/undefined` (via ||) E string vazia depois do trim.
  // Sem o segundo guard, consultor com `name=""` no DB rendia `representante=""`,
  // e o template "Sou a *assistente virtual* do *{{representante}}*" virava
  // "Sou a *assistente virtual* do  e vou..." (espaço duplo + asterisco órfão
  // limpo abaixo). Bug confirmado em produção (cliente JOSINETE em 23/05).
  let rep = String(vars.representante || "").trim();
  // 🔧 Se o consultor não preencheu um nome humano (ficou só username/slug
  // como "abelolympio", "joaosilva123"), evita vazar o slug pro lead.
  // Heurística: 1 token só, todo minúsculo, com dígitos OU >8 chars sem espaço
  // → trata como slug e cai pro genérico "consultor".
  const isSlugLike =
    rep.length > 0 &&
    !/\s/.test(rep) &&
    rep === rep.toLowerCase() &&
    (/\d/.test(rep) || rep.length >= 9);
  if (!rep) rep = "iGreen Energy";
  else if (isSlugLike) rep = "consultor";
  const billNum = typeof vars.valor_conta === "number"
    ? vars.valor_conta
    : Number(vars.valor_conta);
  const hasBill = Number.isFinite(billNum) && billNum > 0;
  const billStr = hasBill ? fmtBRL(billNum) : "";

  const lookup = (rawKey: string): string | null => {
    const key = rawKey.trim().toLowerCase();
    if (NAME_KEYS.has(key)) {
      if (key === "nome_completo" || key === "name") return name;
      return firstName;
    }
    if (PHONE_KEYS.has(key)) return phoneFmt;
    if (CPF_KEYS.has(key)) return cpfFmt;
    if (REP_KEYS.has(key)) return rep;
    if (BILL_KEYS.has(key)) return billStr;
    if (key === "economia_mensal") return hasBill ? fmtBRL(billNum * 0.20) : "";
    if (key === "economia_anual") return hasBill ? fmtBRL(billNum * 0.20 * 12) : "";
    if (key === "economia_range" || key === "economia_faixa") {
      if (!hasBill) return "";
      const min = Math.max(1, Math.floor(billNum * 0.08));
      const max = Math.max(min + 1, Math.ceil(billNum * 0.20));
      return `R$ ${min} a R$ ${max}`;
    }
    if (vars.extra && Object.prototype.hasOwnProperty.call(vars.extra, key)) {
      const v = vars.extra[key];
      return v == null ? "" : String(v);
    }
    return null;
  };

  // Substitui {{ chave }} e { chave } (1-2 chaves, espaços tolerados, qualquer caixa).
  // Só substitui chaves conhecidas — chaves desconhecidas ficam intactas para debug.
  const replaced = text.replace(/\{\{?\s*([a-zA-ZÀ-ÿ_][\w\sÀ-ÿ-]{0,40})\s*\}?\}/g, (match, rawKey: string) => {
    const v = lookup(rawKey);
    if (v == null) return match; // chave desconhecida → mantém literal
    return v;
  });

  // Limpa formatação WhatsApp órfã (negrito/itálico/strike) que ficou vazia
  // porque a variável veio "" — evita aparecer "* *", "__", "~~" no cliente.
  return replaced
    .replace(/\*\s*\*/g, "")
    .replace(/_\s*_/g, "")
    .replace(/~\s*~/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1");
}
