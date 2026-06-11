/**
 * Nomes amigáveis das etapas (conversation_step) para o consultor — sem jargão.
 *
 * Estratégia (validada para não quebrar / não mostrar código cru):
 *  1. Está no dicionário → usa o nome amigável.
 *  2. É um UUID ou "flow:UUID" (nó do construtor visual) → resolve pelo `title`
 *     da tabela bot_flow_steps (ex: "Boas-vindas", "Como funciona").
 *  3. Qualquer outro → vira Title Case legível (ex: "novo_passo" → "Novo passo").
 *
 * Nunca retorna o código cru.
 */
import { supabase } from "@/integrations/supabase/client";

export const STEP_LABELS: Record<string, string> = {
  sem_etapa: "Sem etapa definida",
  welcome: "Início da conversa",
  menu_inicial: "Menu inicial",
  pos_video: "Depois do vídeo",
  aguardando_nome: "Esperando o nome",
  ask_name: "Esperando o nome",
  ask_for_name: "Esperando o nome",
  aguardando_valor_conta: "Perguntando o valor da conta",
  ask_valor: "Perguntando o valor da conta",
  ask_bill_value: "Perguntando o valor da conta",
  aguardando_conta: "Esperando a foto da conta",
  aguardando_foto_conta: "Esperando a foto da conta",
  coleta_conta: "Esperando a foto da conta",
  confirmando_dados_conta: "Confirmando dados da conta",
  confirmando_dados: "Confirmando dados",
  aguardando_documento: "Esperando o documento",
  aguardando_doc: "Esperando o documento",
  aguardando_doc_auto: "Esperando o documento",
  aguardando_doc_frente: "Esperando frente do documento",
  aguardando_doc_verso: "Esperando verso do documento",
  ask_doc: "Esperando o documento",
  ask_doc_frente_manual: "Esperando frente do documento",
  ask_doc_verso_manual: "Esperando verso do documento",
  ask_tipo_documento: "Escolhendo tipo de documento",
  coleta_doc: "Esperando o documento",
  confirmando_dados_doc: "Confirmando dados do documento",
  aguardando_facial: "Esperando selfie do rosto",
  ask_email: "Pedindo o e-mail",
  aguardando_email: "Pedindo o e-mail",
  ask_phone: "Pedindo o telefone",
  ask_phone_confirm: "Confirmando o telefone",
  ask_cpf: "Pedindo o CPF",
  ask_rg: "Pedindo o RG",
  ask_birth_date: "Pedindo a data de nascimento",
  ask_cep: "Pedindo o CEP",
  ask_number: "Pedindo o número do endereço",
  ask_complement: "Pedindo o complemento",
  ask_installation_number: "Pedindo o número de instalação",
  ask_distribuidora: "Escolhendo a distribuidora",
  ask_finalizar: "Confirmando para finalizar",
  ask_quero_cadastrar: "Confirmando interesse no cadastro",
  coleta_dados: "Coletando dados",
  coleta_cadastro: "Coletando dados do cadastro",
  fechamento: "Fechamento",
  objecoes: "Tratando objeções",
  finalizando: "Finalizando o cadastro",
  cadastro_portal: "Enviando ao portal",
  portal_submitting: "Enviando ao portal",
  portal_submitted: "Enviado ao portal",
  validando_otp: "Validando código (OTP)",
  aguardando_otp: "Validando código (OTP)",
  registered_igreen: "Cadastrado na iGreen",
  awaiting_signature: "Aguardando assinatura",
  aguardando_assinatura: "Aguardando assinatura",
  aguardando_humano: "Esperando atendente humano",
  corrigir_celular_portal: "Corrigindo o celular no portal",
  corrigir_email_portal: "Corrigindo o e-mail no portal",
  corrigir_instalacao_portal: "Corrigindo a instalação no portal",
  editing_conta_menu: "Editando dados da conta",
  editing_conta_nome: "Editando nome (conta)",
  editing_conta_endereco: "Editando endereço (conta)",
  editing_conta_cep: "Editando CEP (conta)",
  editing_conta_distribuidora: "Editando distribuidora (conta)",
  editing_conta_instalacao: "Editando instalação (conta)",
  editing_conta_valor: "Editando valor (conta)",
  editing_doc_menu: "Editando documento",
  editing_doc_nome: "Editando nome (documento)",
  editing_doc_cpf: "Editando CPF (documento)",
  editing_doc_rg: "Editando RG (documento)",
  editing_doc_nascimento: "Editando nascimento (documento)",
  pos_venda: "Pós-venda",
  pos_cadastro: "Pós-cadastro",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Remove o prefixo "flow:" e detecta se o que sobra é um UUID de nó do construtor. */
function extractFlowId(step: string): string | null {
  const raw = step.startsWith("flow:") ? step.slice(5) : step;
  return UUID_RE.test(raw) ? raw : null;
}

/** Fallback final: transforma snake_case em texto legível (nunca código cru). */
function titleCase(step: string): string {
  const t = step.replace(/^flow:/, "").replace(/[_-]+/g, " ").trim();
  if (!t) return "Etapa";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Nome amigável SÍNCRONO (sem ir ao banco). Para UUIDs sem título carregado,
 * usa um nome genérico de "passo do fluxo".
 */
export function stepLabel(step: string | null | undefined, titleMap?: Map<string, string>): string {
  if (!step) return STEP_LABELS.sem_etapa;
  if (STEP_LABELS[step]) return STEP_LABELS[step];
  const flowId = extractFlowId(step);
  if (flowId) {
    const title = titleMap?.get(flowId);
    return title || "Passo do fluxo";
  }
  return titleCase(step);
}

/**
 * Carrega os títulos dos nós do construtor (bot_flow_steps) para os steps que
 * são UUID/flow:UUID. Retorna um Map<uuid, title> para uso com stepLabel().
 */
export async function loadFlowTitles(steps: string[]): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(steps.map(extractFlowId).filter((x): x is string => !!x)),
  );
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  try {
    const { data } = await supabase
      .from("bot_flow_steps")
      .select("id, step_key, title")
      .or(`id.in.(${ids.join(",")}),step_key.in.(${ids.join(",")})`);
    for (const row of (data as any[]) || []) {
      if (row.title) {
        if (row.id) map.set(row.id, row.title);
        if (row.step_key) map.set(row.step_key, row.title);
      }
    }
  } catch {
    /* sem títulos → stepLabel usa "Passo do fluxo" */
  }
  return map;
}
