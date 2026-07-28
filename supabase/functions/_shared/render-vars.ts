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

import { discountRates } from "./discount-rates.ts";
import {
  safeFirstNameForAddress,
  safeFullNameForAddress,
  scrubEmptyNameGreeting,
} from "./customer-display-name.ts";
import { resolvePublicConsultantLabel } from "./consultant-public-label.ts";
import { scrubLegacyWelcomeRoleLeak } from "./protocol.ts";

export type RenderVars = {
  name?: string | null;
  /** Fonte do nome (`customers.name_source`). Sem fonte confiável → não chama. */
  name_source?: string | null;
  phone?: string | null;
  cpf?: string | null;
  representante?: string | null;
  /** Nome humano explícito do consultor (consultants.display_name). Quando preenchido, tem prioridade sobre `representante` — evita vazar username/slug. */
  representante_display?: string | null;
  /** Telefone do consultor/representante (E.164-BR só dígitos, ex: 5511987654321). Usado para gerar links wa.me/{{consultor_phone}}. */
  representante_phone?: string | null;
  /** Nome da IA do consultor (`consultants.assistant_name`). Ex.: Sofia, Yasmin. */
  assistente?: string | null;
  /** Gênero do consultor — resolve {{o_a_consultor}} / {{do_da_consultor}}. */
  consultor_gender?: "consultor" | "consultora" | string | null;
  valor_conta?: number | string | null;
  /** Variante do fluxo (A/B/C/D/E/M). Muda as taxas de economia — Fluxo M usa 10-28%. */
  variant?: string | null;
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
/** Nome da IA cadastrado pelo consultor (Sofia, Yasmin, Sol…). */
const ASSISTANT_KEYS = new Set([
  "assistente",
  "assistant",
  "assistant_name",
  "ia",
  "bot_name",
]);
// Telefone do consultor — só dígitos, colável direto em wa.me/{{consultor_phone}}.
const REP_PHONE_KEYS = new Set([
  "consultor_phone",
  "consultora_phone",
  "representante_phone",
  "consultant_phone",
  "phone_consultor",
  "phone_representante",
  "telefone_consultor",
  "telefone_representante",
  "whatsapp_consultor",
  "whatsapp_representante",
  "wa_consultor",
  "wa_representante",
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

/**
 * Renderiza variáveis num texto. Aceita {chave} e {{chave}} em qualquer caixa,
 * com espaços ao redor. Chaves desconhecidas são REMOVIDAS (sem deixar `{...}`
 * vazar pro cliente).
 *
 * Nome inválido (Ixi Kkk, telefone, meme) → {{nome}} vazio e limpeza de vírgula.
 */
export function renderTemplateVars(text: string | null | undefined, vars: RenderVars): string {
  if (!text) return "";
  const firstName = safeFirstNameForAddress(vars.name, vars.name_source);
  const name = safeFullNameForAddress(vars.name, vars.name_source);
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
  //
  // Prioridade segura: se display_name e name parecem pessoas DIFERENTES
  // (ex.: Rafael com display Abel), usa o name do dono — nunca vaza outro.
  const displayName = String(vars.representante_display || "").trim();
  const legacyName = String(vars.representante || "").trim();
  let rep = resolvePublicConsultantLabel(legacyName, displayName, "");
  if (!rep) {
    // slug-like legado sem display → vazio (nunca "consultora" entre *asteriscos*)
    const isSlugLike =
      legacyName.length > 0 &&
      !/\s/.test(legacyName) &&
      legacyName === legacyName.toLowerCase() &&
      (/\d/.test(legacyName) || legacyName.length >= 9);
    rep = isSlugLike ? "" : legacyName;
  }
  // Substantivo de papel NÃO é nome — deixa vazio; scrub limpa "é o  da iGreen".
  if (/^(seu |sua )?(consultor|consultora)$/i.test(rep)) rep = "";
  // Cargo grudado (legado "Nome, Gestor")
  rep = rep
    .replace(/[,–—\-]\s*(gestor|gestora|consultor|consultora)\b.*$/i, "")
    .replace(/\s+(gestor|gestora)\s*$/i, "")
    .trim();
  const oAConsultor = String(vars.consultor_gender || "").trim() === "consultora" ? "a" : "o";
  const doDaConsultor = String(vars.consultor_gender || "").trim() === "consultora" ? "da" : "do";
  // IA do consultor — cada um cadastra em Dados (`assistant_name`).
  // Guard: nomes reservados só podem ser usados pelo consultor dono.
  // Sofia = Rafael, Yasmin = Abel, Sol = Bruna, Luciana = Sirlene.
  // Se outro consultor tentar renderizar um desses, cai no fallback genérico.
  const RESERVED_ASSISTANT_OWNERS: Record<string, string> = {
    sofia: "Rafael",
    yasmin: "Abel",
    sol: "Bruna",
    luciana: "Sirlene",
  };
  const rawAssistant = String(vars.assistente || "").trim();
  const reservedOwner = RESERVED_ASSISTANT_OWNERS[rawAssistant.toLowerCase()];
  const consultantFirstToken = rep.split(/\s+/)[0] || "";
  const assistentIsReservedByOther =
    !!reservedOwner &&
    consultantFirstToken.toLowerCase() !== reservedOwner.toLowerCase();
  const assistente = assistentIsReservedByOther || !rawAssistant
    ? "assistente virtual"
    : rawAssistant;
  const billNum = typeof vars.valor_conta === "number"
    ? vars.valor_conta
    : Number(vars.valor_conta);
  const hasBill = Number.isFinite(billNum) && billNum > 0;
  const billStr = hasBill ? fmtBRL(billNum) : "";

  // Telefone do consultor — dígitos, DDI 55 e 9º dígito (celular BR).
  // Vazio → placeholder removido (não vaza `https://wa.me/` órfão).
  let repPhoneDigits = String(vars.representante_phone || "").replace(/\D/g, "").replace(/^0+/, "");
  if (repPhoneDigits && !repPhoneDigits.startsWith("55") && (repPhoneDigits.length === 10 || repPhoneDigits.length === 11)) {
    repPhoneDigits = `55${repPhoneDigits}`;
  }
  if (repPhoneDigits.length === 12 && repPhoneDigits.startsWith("55")) {
    const ddd = repPhoneDigits.slice(2, 4);
    const local = repPhoneDigits.slice(4);
    if (local.length === 8 && /^[6-9]/.test(local)) {
      repPhoneDigits = `55${ddd}9${local}`;
    }
  }

  const lookup = (rawKey: string): string | null => {
    const key = rawKey.trim().toLowerCase();
    if (NAME_KEYS.has(key)) {
      if (key === "nome_completo" || key === "name") return name;
      return firstName;
    }
    if (PHONE_KEYS.has(key)) return phoneFmt;
    if (CPF_KEYS.has(key)) return cpfFmt;
    if (REP_PHONE_KEYS.has(key)) return repPhoneDigits;
    if (key === "link_wa" || key === "wa_link" || key === "link_whatsapp") {
      return repPhoneDigits ? `https://wa.me/${repPhoneDigits}` : "";
    }
    if (ASSISTANT_KEYS.has(key)) return assistente;
    if (REP_KEYS.has(key)) return rep;
    if (key === "o_a_consultor") return oAConsultor;
    if (key === "do_da_consultor") return doDaConsultor;
    if (BILL_KEYS.has(key)) return billStr;
    const rates = discountRates(vars.variant);
    if (key === "economia_mensal") return hasBill ? fmtBRL(billNum * rates.max) : "";
    if (key === "economia_anual") return hasBill ? fmtBRL(billNum * rates.max * 12) : "";
    if (key === "economia_range" || key === "economia_faixa") {
      if (!hasBill) return "";
      const min = Math.max(1, Math.floor(billNum * rates.min));
      const max = Math.max(min + 1, Math.ceil(billNum * rates.max));
      return `R$ ${min} a R$ ${max}`;
    }
    if (vars.extra && Object.prototype.hasOwnProperty.call(vars.extra, key)) {
      const v = vars.extra[key];
      return v == null ? "" : String(v);
    }
    return null;
  };

  let working = text;
  // Sem nome usável: tira bloco "Olá, {{nome}}." e vai só o corpo.
  if (!firstName) {
    working = scrubEmptyNameGreeting(working);
  }

  // Substitui {{ chave }} e { chave } (1-2 chaves, espaços tolerados, qualquer caixa).
  // Só substitui chaves conhecidas — chaves desconhecidas ficam intactas para debug.
  const replaced = working.replace(/\{\{?\s*([a-zA-ZÀ-ÿ_][\w\sÀ-ÿ-]{0,40})\s*\}?\}/g, (match, rawKey: string) => {
    const v = lookup(rawKey);
    if (v == null) return match; // chave desconhecida → mantém literal
    return v;
  });

  // Limpa formatação WhatsApp órfã (negrito/itálico/strike) que ficou vazia
  // porque a variável veio "" — evita aparecer "* *", "__", "~~" no cliente.
  // Também remove link `wa.me/` órfão (sem número atrás) — caso o consultor
  // não tenha telefone cadastrado, não vaza "Responda: wa.me/" quebrado.
  let out = replaced
    .replace(/\*\s*\*/g, "")
    .replace(/_\s*_/g, "")
    .replace(/~\s*~/g, "")
    // SMS/WA: protocolo obrigatório para o celular abrir o link.
    .replace(/(?:https?:\/\/)?wa\.me\/(?=[\d+])/gi, "https://wa.me/")
    .replace(/(?:https?:\/\/)?wa\.me\/(?![\d+])/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1");

  if (!firstName) {
    out = scrubEmptyNameGreeting(out);
  }
  // Nunca vazar ", *Gestor*" nem "*consultora*" no lugar do nome (welcome/cadência).
  return scrubLegacyWelcomeRoleLeak(out);
}
