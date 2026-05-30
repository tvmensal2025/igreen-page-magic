// Template loader — reads bot_messages from DB with hardcoded fallback.

const FALLBACK: Record<string, string> = {
  "welcome:saudacao": "Oi! Aqui é a Camila, assistente do {{representante}} 👋",
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
  representante?: string | null;
  valor_conta?: number | string | null;
  telefone?: string | null;
  cpf?: string | null;
}

function fmtValor(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.,-]/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return String(v);
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

export function renderTemplate(tpl: string, vars: TemplateVars): string {
  // Sem nome conhecido: deixa vazio (template deve omitir vírgula/saudação sozinho)
  const nome = (vars.nome || "").split(" ")[0] || "";
  const rep = vars.representante || "consultor";
  const valor = fmtValor(vars.valor_conta);
  const tel = vars.telefone || "";
  const cpf = vars.cpf || "";
  // Substituição tolerante a espaços: {{ nome }}, {{nome}}, {{  nome  }}
  const replaceVar = (str: string, key: string, value: string) =>
    str.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi"), value);
  let out = tpl;
  out = replaceVar(out, "nome", nome);
  out = replaceVar(out, "representante", rep);
  out = replaceVar(out, "valor_conta", valor);
  out = replaceVar(out, "telefone", tel);
  out = replaceVar(out, "cpf", cpf);
  // Limpa artefatos quando uma variável ficou vazia (sem nome conhecido etc):
  // "Oi , tudo bem" -> "Oi, tudo bem" ; "Olá !" -> "Olá!" ; "  " -> " "
  out = out
    .replace(/([,;:])\s*([,;:!?.])/g, "$2")        // ", !" -> "!"
    .replace(/\s+([,.!?;:])/g, "$1")                // " ," -> ","
    .replace(/([(\[])\s+/g, "$1")
    .replace(/\s+([)\]])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[\s,;:]+/gm, (s) => s.replace(/[,;:]/g, ""))
    .trim();
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
