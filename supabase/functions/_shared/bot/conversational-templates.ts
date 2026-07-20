// Template loader — reads bot_messages from DB with hardcoded fallback.
// FONTE ÚNICA (Etapa 3a unificação): superset Whapi + Evolution.

import { parseMoneyBR } from "../parse-money.ts";
import { safeFirstNameForAddress, scrubEmptyNameGreeting } from "../customer-display-name.ts";

const FALLBACK: Record<string, string> = {
  "welcome:saudacao": "Oi! Aqui é o {{representante}} 👋",
  "menu_inicial:reforco": "{{nome}}, ainda quer entender como funciona o desconto?",
  "qualificacao:pergunta_conta": "Qual o valor médio da sua conta de luz hoje?",
  "pos_video:checkin": "E aí, {{nome}}, ficou alguma dúvida?",
  "checkin_pos_video:reforco_checkin": "{{nome}}, ficou alguma dúvida ou podemos ir para o cadastro?",
  "checkin_pos_video:pedir_conta": "Perfeito! Me manda uma foto ou PDF da sua conta de luz 📸",
  "pitch_conexao_club:apresentar": "Olha que legal, {{nome}} — vou te mostrar 👇",
  "duvidas_pos_club:pode_perguntar": "Pode perguntar à vontade, {{nome}} 🤝",
  "duvidas_pos_club:rumo_cadastro": "Ótimo! Envie uma foto da sua conta de luz 📸",
  "aguardando_humano:avisado": "Já avisei o {{representante}}. Em breve te chama 👍",
  "fallback:nao_entendi": "Desculpa, não captei. Pode reformular?",
};

export interface TemplateVars {
  nome?: string | null;
  /** customers.name_source — sem fonte confiável não chama. */
  nome_source?: string | null;
  representante?: string | null;
  /** Alias de representante em alguns templates do painel. */
  consultor?: string | null;
  /** Protocolo de atendimento (IGR-XXX-####). Nunca enviar placeholder vazio. */
  protocolo?: string | null;
  valor_conta?: number | string | null;
  telefone?: string | null;
  cpf?: string | null;
}

function parseValor(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  return parseMoneyBR(v);
}

function fmtValor(v: number | string | null | undefined): string {
  const n = parseValor(v);
  if (n === null) {
    // Se já veio formatado com R$, devolve só o número p/ o template dono do "R$"
    if (typeof v === "string") return v.replace(/^R\$\s*/i, "").trim();
    return "";
  }
  // Sem prefixo R$ — templates DB já usam "R$ {{valor_conta}}" (F08)
  return n.toFixed(2).replace(".", ",");
}

const DESCONTO_PCT = 0.20;

function fmtEconomiaMensal(v: number | string | null | undefined): string {
  const n = parseValor(v);
  if (n === null || n <= 0) return "";
  return `R$ ${(n * DESCONTO_PCT).toFixed(2).replace(".", ",")}`;
}

function fmtEconomiaAnual(v: number | string | null | undefined): string {
  const n = parseValor(v);
  if (n === null || n <= 0) return "";
  return `R$ ${(n * DESCONTO_PCT * 12).toFixed(2).replace(".", ",")}`;
}

function fmtEconomiaRange(v: number | string | null | undefined): string {
  const n = parseValor(v);
  if (n === null || n <= 0) return "";
  const min = Math.max(1, Math.floor(n * 0.08));
  const max = Math.max(min + 1, Math.ceil(n * DESCONTO_PCT));
  return `R$ ${min} a R$ ${max}`;
}

export function renderTemplate(tpl: string, vars: TemplateVars): string {
  const nome = safeFirstNameForAddress(vars.nome, vars.nome_source);
  const rep =
    (String(vars.representante || vars.consultor || "").trim()) || "iGreen Energy";
  const protocolo = String(vars.protocolo || "").trim();
  const valor = fmtValor(vars.valor_conta);
  const econMensal = fmtEconomiaMensal(vars.valor_conta);
  const econAnual = fmtEconomiaAnual(vars.valor_conta);
  const econRange = fmtEconomiaRange(vars.valor_conta);
  const tel = vars.telefone || "";
  const cpf = vars.cpf || "";
  const replaceVar = (str: string, key: string, value: string) =>
    str.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi"), value);
  let out = tpl;
  if (!nome) {
    out = scrubEmptyNameGreeting(out);
  }
  out = replaceVar(out, "nome", nome);
  out = replaceVar(out, "representante", rep);
  out = replaceVar(out, "consultor", rep);
  out = replaceVar(out, "protocolo", protocolo);
  out = replaceVar(out, "valor_conta", valor);
  out = replaceVar(out, "economia_mensal", econMensal);
  out = replaceVar(out, "economia_anual", econAnual);
  out = replaceVar(out, "economia_range", econRange);
  // F08: template "R$ {{valor_conta}}" + fmtValor com "R$" → "R$ R$"
  out = out.replace(/R\$\s*R\$/gi, "R$");
  out = replaceVar(out, "economia_faixa", econRange);
  out = replaceVar(out, "telefone", tel);
  out = replaceVar(out, "cpf", cpf);
  // Sem número: remove linha de protocolo (evita "Protocolo —" / "Protocolo: *").
  if (!protocolo) {
    out = out
      .replace(/^.*📋\s*\*?Protocolo.*$/gmi, "")
      .replace(/^.*\bProtocolo\b\s*[—–:-]?\s*\*?.*$/gmi, (line) => {
        const t = line.replace(/\*+/g, "").trim();
        return /^(📋\s*)?Protocolo\b/i.test(t) ? "" : line;
      })
      .replace(/\n{3,}/g, "\n\n");
  }
  out = out
    .replace(/\*\s*\*/g, "")
    .replace(/_\s*_/g, "")
    .replace(/~\s*~/g, "")
    .replace(/([,;:])\s*([,;:!?.])/g, "$2")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/\s+([)\]])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[\s,;:]+/gm, (s) => s.replace(/[,;:]/g, ""))
    .trim();
  // Não silenciar a mensagem inteira por placeholder residual — remove o
  // {{var}} e segue. Antes: return "" fazia o lead travar sem resposta (ex.: a3).
  if (/\{\{\s*\w+\s*\}\}/.test(out)) {
    out = out
      .replace(/\{\{\s*[^}]+\s*\}\}/g, "")
      .replace(/\*\s*\*/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  if (!nome) {
    out = scrubEmptyNameGreeting(out);
  }
  return out;
}

export async function getTemplate(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  step_key: string,
  template_key: string,
  vars: TemplateVars,
  variant = "default",
): Promise<string> {
  try {
    const { data } = await supabase
      .from("bot_messages")
      .select("text")
      .eq("step_key", step_key)
      .eq("template_key", template_key)
      .eq("variant", variant)
      .eq("active", true)
      .maybeSingle();
    const tpl = data?.text || FALLBACK[`${step_key}:${template_key}`] || FALLBACK["fallback:nao_entendi"];
    return renderTemplate(tpl, vars);
  } catch {
    return renderTemplate(FALLBACK[`${step_key}:${template_key}`] || FALLBACK["fallback:nao_entendi"], vars);
  }
}
