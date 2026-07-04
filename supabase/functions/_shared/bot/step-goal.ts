/**
 * Resolve a "ação pendente" do passo atual para IA + re-prompt.
 * Legado (map fixo) + passos do Flow Builder (message_text / step_type / captures).
 */
import { renderTemplateVars } from "../render-vars.ts";
import { resolveFlowId } from "../resolve-flow.ts";

export const REENTRY_PREFIX = "📋 *Voltando ao seu cadastro:* ";

export function normalizeStepKey(step: string): string {
  return String(step || "").replace(/^flow:/, "").trim();
}

/** Extrai a última pergunta/instrução de um texto de passo. */
export function extractQuestionTail(text: string): string {
  if (!text) return "";
  const cleaned = String(text)
    .replace(/^📋\s*\*?Voltando ao seu cadastro:\*?\s*/i, "")
    .trim();
  const qMatches = cleaned.match(/[^.!?\n]*\?+/g);
  if (qMatches && qMatches.length > 0) return qMatches[qMatches.length - 1].trim();
  const sents = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  return (sents[sents.length - 1] || cleaned).trim();
}

function firstNameVoc(customer: any): string {
  const first = String(customer?.name || "").trim().split(/\s+/)[0] || "";
  return first ? `${first}, ` : "";
}

/** Mapa legado — passos determinísticos do cadastro. */
export function legacyStepTail(step: string, customer: any): string {
  const v = firstNameVoc(customer);
  const key = normalizeStepKey(step);
  const map: Record<string, string> = {
    ask_name: `${v}qual é o seu *nome completo*?`,
    ask_cpf: `${v}qual é o seu *CPF*? (apenas números)`,
    ask_rg: `${v}qual é o seu *RG*?`,
    ask_birth_date: `${v}qual sua *data de nascimento*? (DD/MM/AAAA)`,
    ask_phone: `${v}me confirma seu *telefone* (com DDD)?`,
    ask_phone_confirm: `${v}me confirma seu *telefone* (com DDD)?`,
    ask_email:
      `${v}me passa seu *e-mail* 📧\n_É por ele que você vai acessar o app *iGreen Club* 📱 (cashback, faturas e indicações)._`,
    ask_cep: `${v}qual o *CEP* da sua casa? (8 dígitos)`,
    ask_number: `${v}qual o *número* da sua casa?`,
    ask_complement: `${v}tem *complemento* no endereço? (apto, bloco) — ou *PULAR* / *NÃO TEM*.`,
    ask_installation_number: `${v}qual o *número da instalação* da conta?`,
    ask_distribuidora: `${v}qual a *distribuidora* da sua conta de luz? (ex: CPFL, Enel, Cemig)`,
    corrigir_celular_portal: `${v}me envia um *número de celular* diferente (com DDD) pra concluir o cadastro.`,
    corrigir_email_portal: `${v}me envia um *e-mail diferente* pra concluir o cadastro.`,
    corrigir_instalacao_portal: `${v}confere o *número de instalação* na conta e me envia de novo (7+ dígitos).`,
    ask_bill_value: `${v}qual a *média* da sua conta de luz? (ex: 350,50)`,
    ask_tipo_documento: "Me manda só uma foto da *frente do seu documento* (RG ou CNH — eu identifico sozinho).",
    aguardando_conta: `${v}me envia uma *foto ou PDF da conta de luz* pra eu seguir 📸`,
    aguardando_doc_frente: `${v}me envia a *frente* do seu documento 🪪`,
    aguardando_doc_verso: `${v}me envia o *verso* do seu documento 🪪`,
    aguardando_doc_auto: `${v}me envia o seu *documento* (RG ou CNH) 🪪`,
    editing_conta_menu:
      "Qual campo deseja editar?\n\n1️⃣ Nome\n2️⃣ Endereço\n3️⃣ CEP\n4️⃣ Distribuidora\n5️⃣ Nº Instalação\n6️⃣ Valor da conta\n0️⃣ Cancelar",
    editing_doc_menu:
      "Qual campo deseja editar?\n\n1️⃣ Nome\n2️⃣ CPF\n3️⃣ RG\n4️⃣ Data de Nascimento\n0️⃣ Cancelar",
    editing_conta_nome: "Digite o *nome completo* correto:",
    editing_conta_endereco: "Digite o *endereço completo* correto:",
    editing_conta_cep: "Digite o *CEP* correto (8 dígitos):",
    editing_conta_distribuidora: "Digite o nome da *distribuidora*:",
    editing_conta_instalacao: "Digite o *número da instalação*:",
    editing_conta_valor: "Digite o *valor da conta* (ex: 350,50):",
    editing_doc_nome: "Digite o *nome completo* correto:",
    editing_doc_cpf: "Digite o *CPF* correto (apenas números):",
    editing_doc_rg: "Digite o *RG* correto:",
    editing_doc_nascimento: "Digite a *data de nascimento* (DD/MM/AAAA):",
    confirmando_dados_conta: "Os dados da conta estão corretos? Responda *SIM*, *NÃO* ou *EDITAR*.",
    confirmando_dados_doc: "Os dados estão corretos? Responda *SIM*, *NÃO* ou *EDITAR*.",
    confirmar_titularidade:
      "Antes de finalizar: é a *mesma pessoa* da conta de luz, *outro titular* (cônjuge/pai/mãe) ou quer *corrigir*?",
  };
  return map[key] || "";
}

export function goalFromStepType(stepType: string, customer: any): string {
  const v = firstNameVoc(customer);
  switch (String(stepType || "message")) {
    case "capture_conta":
      return `${v}envie uma *foto ou PDF da conta de luz*`;
    case "capture_documento":
    case "capture_doc":
      return `${v}envie foto do seu *documento* (RG ou CNH)`;
    case "capture_email":
      return `${v}informe seu *e-mail*`;
    case "confirm_phone":
      return `${v}confirme seu *telefone* (com DDD)`;
    case "finalizar_cadastro":
      return `${v}finalize o cadastro quando estiver pronto`;
    default:
      return "";
  }
}

export function goalFromStepRow(stepRow: any, customer: any, representante?: string | null): string {
  const stype = String(stepRow?.step_type || "message");
  const typed = goalFromStepType(stype, customer);
  if (typed && stype !== "message") return typed;

  const rawMsg = String(stepRow?.message_text || "").trim();
  if (rawMsg) {
    const rendered = renderTemplateVars(rawMsg, {
      name: customer?.name,
      phone: customer?.phone_whatsapp,
      cpf: customer?.cpf,
      representante: representante ?? undefined,
      valor_conta: customer?.electricity_bill_value,
      variant: customer?.flow_variant,
    }).trim();
    const tail = extractQuestionTail(rendered);
    if (tail) return tail;
    if (rendered.length <= 280) return rendered;
    return rendered.slice(0, 280).trim() + "…";
  }

  const captures = Array.isArray(stepRow?.captures) ? stepRow.captures : [];
  const btnCap = captures.find((c: any) => c?.field === "_buttons" && Array.isArray(c?.value));
  const buttons = (btnCap?.value || [])
    .map((b: any) => String(b?.title || "").trim())
    .filter(Boolean)
    .slice(0, 4);
  if (buttons.length > 0) {
    return `escolha uma opção (${buttons.map((t: string, i: number) => `${i + 1}. ${t}`).join(" · ")})`;
  }

  return typed;
}

export type StepReentry = { full: string; tail: string };

/** Resolve re-prompt completo + tail (ação pendente) para o passo atual. */
export async function resolveStepReentry(
  supabase: any,
  customer: any,
  step: string,
  representante?: string | null,
): Promise<StepReentry> {
  const key = normalizeStepKey(step);
  const legacyTail = legacyStepTail(key, customer);
  if (legacyTail) {
    return { full: REENTRY_PREFIX + legacyTail, tail: legacyTail };
  }

  if (!customer?.consultant_id || !key) return { full: "", tail: "" };

  try {
    const flow = await resolveFlowId(
      supabase,
      customer.consultant_id,
      (customer as any)?.flow_variant || "A",
    );
    if (!flow?.id) return { full: "", tail: "" };

    const { data: stepRow } = await supabase
      .from("bot_flow_steps")
      .select("step_key, step_type, message_text, captures")
      .eq("flow_id", flow.id)
      .or(`step_key.eq.${key},id.eq.${key}`)
      .eq("is_active", true)
      .maybeSingle();

    if (stepRow) {
      const tail = goalFromStepRow(stepRow, customer, representante);
      if (tail) return { full: REENTRY_PREFIX + tail, tail };
    }
  } catch (e) {
    console.warn("[resolveStepReentry] falhou:", (e as Error).message);
  }

  return { full: "", tail: "" };
}

/** @deprecated — use resolveStepReentry().full */
export function getReentryPromptForStep(step: string, customer: any): string {
  const tail = legacyStepTail(step, customer);
  return tail ? REENTRY_PREFIX + tail : "";
}
