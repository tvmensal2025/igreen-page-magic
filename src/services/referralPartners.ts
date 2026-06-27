// Serviço de acesso a referral_partners (participantes do rodízio) pelo wizard.
// Usa o cliente Supabase autenticado direto do front: a RLS
// `consultants_own_partners` (consultant_id = auth.uid()) já garante que o
// consultor só lista/cria os próprios participantes — não precisa de edge function.
//
// Regras de negócio importantes da coluna `cli` (NOT NULL no banco):
//   - NUNCA gravamos `cli` nulo.
//   - CONSULTOR: `partner_igreen_id` é obrigatório; `cli` recebe o valor
//     informado OU "0" quando não informado.
//   - PARCEIRO/INDICADOR: `partner_igreen_id` fica vazio (null); `cli` é
//     obrigatório (validado pelo formulário do wizard).

import { supabase } from "@/integrations/supabase/client";

/** Tipo do participante do rodízio. */
export type RodizioPartnerType = "consultor" | "parceiro";

/**
 * Participante já carregado/criado, pronto para entrar na lista ordenada do
 * wizard. Espelha o `RodizioPartnerDraft` do design.
 */
export interface RodizioPartnerDraft {
  id: string;
  nome: string;
  tipo: RodizioPartnerType;
  partner_igreen_id: string | null;
  cli: string | null;
  notification_phone: string | null;
}

/** Dados informados no form inline para criar um participante. */
export interface CreateReferralPartnerInput {
  tipo: RodizioPartnerType;
  nome: string;
  notification_phone: string;
  /** Obrigatório quando tipo = "consultor". */
  partner_igreen_id?: string;
  /** Obrigatório quando tipo = "parceiro". */
  cli?: string;
}

/** Deriva o tipo do participante a partir das colunas do banco. */
function resolveTipo(partnerIgreenId: string | null): RodizioPartnerType {
  return partnerIgreenId && partnerIgreenId.trim() ? "consultor" : "parceiro";
}

/** Converte uma linha de `referral_partners` em `RodizioPartnerDraft`. */
function toDraft(row: {
  id: string;
  nome: string;
  partner_igreen_id: string | null;
  cli: string | null;
  notification_phone: string | null;
}): RodizioPartnerDraft {
  return {
    id: row.id,
    nome: row.nome,
    tipo: resolveTipo(row.partner_igreen_id),
    partner_igreen_id: row.partner_igreen_id,
    cli: row.cli,
    notification_phone: row.notification_phone,
  };
}

/** Obtém o id do consultor logado (dono do número central). */
async function getConsultantId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(`Sessão inválida: ${error.message}`);
  const consultantId = data?.user?.id;
  if (!consultantId) {
    throw new Error("Usuário não autenticado. Faça login novamente.");
  }
  return consultantId;
}

/**
 * Lista os participantes ativos do consultor dono (mais recentes primeiro).
 * A RLS já restringe ao dono; o filtro por `consultant_id` é defensivo.
 */
export async function listActiveReferralPartners(): Promise<RodizioPartnerDraft[]> {
  const consultantId = await getConsultantId();
  const { data, error } = await supabase
    .from("referral_partners")
    .select("id, nome, partner_igreen_id, cli, notification_phone")
    .eq("consultant_id", consultantId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toDraft);
}

/**
 * Cria um participante (CONSULTOR ou PARCEIRO/INDICADOR) e devolve o draft já
 * pronto para entrar na lista ordenada do wizard.
 */
export async function createReferralPartner(
  input: CreateReferralPartnerInput,
): Promise<RodizioPartnerDraft> {
  const consultantId = await getConsultantId();

  const nome = (input.nome ?? "").trim();
  if (!nome) throw new Error("Nome é obrigatório");

  const notificationPhone = (input.notification_phone ?? "").trim();
  if (!notificationPhone) throw new Error("Telefone de aviso é obrigatório");

  const igreenId = (input.partner_igreen_id ?? "").trim();
  const cliInformado = (input.cli ?? "").trim();

  // Define partner_igreen_id e cli conforme o tipo, garantindo cli NOT NULL.
  let partnerIgreenId: string | null;
  let cli: string;
  if (input.tipo === "consultor") {
    if (!igreenId) {
      throw new Error("O código iGreen é obrigatório para o tipo CONSULTOR.");
    }
    partnerIgreenId = igreenId;
    cli = cliInformado || "0"; // nunca null: coluna cli é NOT NULL
  } else {
    if (!cliInformado) {
      throw new Error("O cli é obrigatório para o tipo PARCEIRO/INDICADOR.");
    }
    partnerIgreenId = null;
    cli = cliInformado;
  }

  const payload = {
    consultant_id: consultantId,
    nome,
    notification_phone: notificationPhone,
    partner_igreen_id: partnerIgreenId,
    cli,
  };

  const { data, error } = await supabase
    .from("referral_partners")
    .insert(payload)
    .select("id, nome, partner_igreen_id, cli, notification_phone")
    .single();
  if (error) throw new Error(error.message || "Falha ao criar participante");
  return toDraft(data);
}
