// =============================================================================
// Orçamento — API (lado consultor)
// =============================================================================
// Acesso à tabela `proposals` pelo consultor autenticado (RLS garante que só
// vê/edita as próprias). Mapeia o shape cru (snake_case) para o modelo da app.
// O lado público (destinatário) vive em publicApi.ts e usa edge functions.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";
import type {
  CreateProposalInput,
  Proposal,
  ProposalEvent,
  ProposalLineItem,
  ProposalRow,
} from "./types";

const SELECT_COLUMNS =
  "id, public_token, consultant_id, product_id, customer_id, recipient_name, recipient_phone, status, amount, amount_period, discount, line_items, message, valid_until, sent_at, viewed_at, responded_at, sale_id, created_at, updated_at";

function asLineItems(value: unknown): ProposalLineItem[] {
  if (Array.isArray(value)) return value as ProposalLineItem[];
  return [];
}

/** Normaliza a linha do banco para o modelo da aplicação. */
export function mapProposalRow(row: ProposalRow): Proposal {
  return {
    id: row.id,
    publicToken: row.public_token,
    consultantId: row.consultant_id,
    productId: row.product_id,
    customerId: row.customer_id,
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone,
    status: row.status,
    amount: row.amount === null ? null : Number(row.amount),
    amountPeriod: row.amount_period,
    discount: row.discount === null ? null : Number(row.discount),
    lineItems: asLineItems(row.line_items),
    message: row.message,
    validUntil: row.valid_until,
    sentAt: row.sent_at,
    viewedAt: row.viewed_at,
    respondedAt: row.responded_at,
    saleId: row.sale_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Expira propostas vencidas (RPC). Best-effort se a migration ainda não rodou. */
export async function expireOverdueProposals(): Promise<number> {
  const { data, error } = await supabase.rpc("expire_overdue_proposals" as never);
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

/** Preenche nome/telefone a partir de `customers` quando a proposta só tem customer_id. */
async function enrichProposalsWithCustomers(proposals: Proposal[]): Promise<Proposal[]> {
  const customerIds = [
    ...new Set(
      proposals
        .filter((p) => p.customerId && (!p.recipientName || !p.recipientPhone))
        .map((p) => p.customerId as string),
    ),
  ];
  if (customerIds.length === 0) return proposals;

  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone_whatsapp")
    .in("id", customerIds);

  if (error || !data) return proposals;

  const byId = new Map(
    (data as Array<{ id: string; name: string | null; phone_whatsapp: string }>).map((c) => [c.id, c]),
  );

  return proposals.map((p) => {
    if (!p.customerId) return p;
    const customer = byId.get(p.customerId);
    if (!customer) return p;
    return {
      ...p,
      recipientName: p.recipientName ?? customer.name ?? null,
      recipientPhone:
        p.recipientPhone ?? customer.phone_whatsapp.replace(/\D/g, "") ?? null,
    };
  });
}

/** Lista as propostas de um consultor (mais recentes primeiro). */
export async function fetchProposals(consultantId: string): Promise<Proposal[]> {
  const { data, error } = await supabase
    .from("proposals" as never)
    .select(SELECT_COLUMNS)
    .eq("consultant_id", consultantId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  const proposals = ((data as unknown as ProposalRow[]) || []).map(mapProposalRow);
  return enrichProposalsWithCustomers(proposals);
}

/** Cria uma proposta já no status 'sent' (link ativo) com prazo de validade. */
export async function createProposal(input: CreateProposalInput): Promise<Proposal> {
  const validUntil = new Date(
    Date.now() + input.validForDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("proposals" as never)
    .insert({
      consultant_id: input.consultantId,
      product_id: input.productId,
      customer_id: input.customerId ?? null,
      recipient_name: input.recipientName ?? null,
      recipient_phone: input.recipientPhone ?? null,
      status: "sent",
      amount: input.amount,
      amount_period: input.amountPeriod,
      discount: input.discount ?? null,
      line_items: input.lineItems,
      message: input.message ?? null,
      valid_until: validUntil,
      sent_at: new Date().toISOString(),
    } as never)
    .select(SELECT_COLUMNS)
    .single();

  if (error) throw error;

  const proposal = mapProposalRow(data as unknown as ProposalRow);

  // Registra o evento de envio (best-effort, não bloqueia o fluxo).
  await supabase
    .from("proposal_events" as never)
    .insert({
      proposal_id: proposal.id,
      type: "sent",
      actor: "consultant",
    } as never)
    .then(undefined, () => {});

  return proposal;
}

/** Lê o histórico/rodadas de uma proposta (lado consultor). */
export async function fetchProposalEvents(proposalId: string): Promise<ProposalEvent[]> {
  const { data, error } = await supabase
    .from("proposal_events" as never)
    .select("type, actor, note, counter_amount, attachment_url, created_at")
    .eq("proposal_id", proposalId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return ((data as unknown as Array<{
    type: ProposalEvent["type"];
    actor: ProposalEvent["actor"];
    note: string | null;
    counter_amount: number | null;
    attachment_url: string | null;
    created_at: string;
  }>) || []).map((e) => ({
    type: e.type,
    actor: e.actor,
    note: e.note,
    counterAmount: e.counter_amount === null ? null : Number(e.counter_amount),
    attachmentUrl: e.attachment_url,
    createdAt: e.created_at,
  }));
}

/** Consultor responde a uma contraproposta (nova rodada) ou cancela. */
export async function consultantReplyToCounter(
  proposalId: string,
  patch: { amount?: number; message?: string | null; note?: string | null },
): Promise<void> {
  const dbPatch: Record<string, unknown> = { status: "sent" };
  if (patch.amount !== undefined) dbPatch.amount = patch.amount;
  if (patch.message !== undefined) dbPatch.message = patch.message;

  const { error } = await supabase
    .from("proposals" as never)
    .update(dbPatch as never)
    .eq("id", proposalId);
  if (error) throw error;

  await supabase
    .from("proposal_events" as never)
    .insert({
      proposal_id: proposalId,
      type: "consultant_reply",
      actor: "consultant",
      note: patch.note ?? null,
    } as never)
    .then(undefined, () => {});
}

/** Remove uma proposta. */
export async function deleteProposal(proposalId: string): Promise<void> {
  const { error } = await supabase.from("proposals" as never).delete().eq("id", proposalId);
  if (error) throw error;
}
