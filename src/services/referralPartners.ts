// Serviço de acesso a referral_partners (participantes do rodízio) pelo wizard.
// Usa o cliente Supabase autenticado direto do front: a RLS
// `consultants_own_partners` (consultant_id = auth.uid()) já garante que o
// consultor só lista/cria os próprios participantes — não precisa de edge function.
//
// Regras de negócio importantes da coluna `cli` (NOT NULL no banco):
//   - NUNCA gravamos `cli` nulo.
//   - `cli` é sempre o ID iGreen do consultor dono/abonador.
//   - `partner_igreen_id` é o ID iGreen próprio do parceiro, quando existir.
//   - Quando existem os dois, métricas/carteira somam os dois IDs sem mudar o dono.

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

/**
 * Normaliza um telefone brasileiro para o formato `55DDDNNNNNNNNN` que o
 * webhook / notify usam. Aceita máscara ("(11) 99999-8888"), com ou sem 9,
 * com ou sem DDI 55. Retorna `null` se claramente inválido (menos de 10
 * dígitos úteis, DDD fora de 11–99, ou todos os dígitos iguais).
 */
export function normalizeBrPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  // Todos iguais (11111111111) — quase sempre lixo
  if (/^(\d)\1+$/.test(digits)) return null;
  // Remove DDI 55 se presente
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length < 10 || digits.length > 11) return null;
  const ddd = parseInt(digits.slice(0, 2), 10);
  if (!Number.isFinite(ddd) || ddd < 11 || ddd > 99) return null;
  // Se tem 10 dígitos (celular sem 9), adiciona 9
  if (digits.length === 10) digits = digits.slice(0, 2) + "9" + digits.slice(2);
  return "55" + digits;
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

  const notificationPhone = normalizeBrPhone(input.notification_phone);
  if (!notificationPhone) {
    throw new Error("Telefone inválido. Use DDD + número (ex.: 11 99999-8888).");
  }

  const igreenId = (input.partner_igreen_id ?? "").trim();
  const cliInformado = (input.cli ?? "").trim();
  const { data: owner } = await supabase
    .from("consultants")
    .select("igreen_id")
    .eq("id", consultantId)
    .maybeSingle();
  const ownerIgreenId = String(owner?.igreen_id ?? "").replace(/\D/g, "");


  // Define partner_igreen_id separado do CLI. O CLI nunca é do parceiro: ele é
  // sempre o ID iGreen do consultor dono/abonador, com fallback ao informado.
  let partnerIgreenId: string | null;
  let cli: string;
  if (input.tipo === "consultor") {
    if (!igreenId) {
      throw new Error("O código iGreen é obrigatório para o tipo CONSULTOR.");
    }
    partnerIgreenId = igreenId;
    cli = ownerIgreenId || cliInformado;
  } else {
    if (!ownerIgreenId && !cliInformado) {
      throw new Error("Meu ID iGreen/CLI é obrigatório para o parceiro indicador.");
    }
    partnerIgreenId = null;
    cli = ownerIgreenId || cliInformado;
  }
  if (!cli) throw new Error("Configure seu ID iGreen em Dados antes de adicionar parceiros.");

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
