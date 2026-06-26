// Serviço de leads captados (captured_leads) + disparo e pesquisa B2B.
// Usa o cliente Supabase autenticado (RLS garante que o consultor só vê os
// próprios leads). As ações de disparo e pesquisa chamam edge functions.

import { supabase } from "@/integrations/supabase/client";

export type PersonType = "pf" | "pj";
export type LeadChannel =
  | "meta_leadads"
  | "tiktok_leadgen"
  | "ctwa"
  | "landing"
  | "research"
  | "manual";
export type LeadStatus = "new" | "enriched" | "converted" | "discarded";

export interface CapturedLead {
  id: string;
  consultant_id: string;
  channel: LeadChannel;
  person_type: PersonType;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  uf: string | null;
  product_interest: string | null;
  company_name: string | null;
  cnpj: string | null;
  status: LeadStatus;
  created_at: string;
}

export interface ListLeadsFilter {
  consultantId: string;
  channel?: LeadChannel | "all";
  personType?: PersonType | "all";
  status?: LeadStatus | "all";
  search?: string;
  limit?: number;
}

/** Lista os leads captados do consultor (RLS já restringe ao dono). */
export async function listCapturedLeads(filter: ListLeadsFilter): Promise<CapturedLead[]> {
  let q = supabase
    .from("captured_leads")
    .select(
      "id, consultant_id, channel, person_type, full_name, phone, email, city, uf, product_interest, company_name, cnpj, status, created_at",
    )
    .eq("consultant_id", filter.consultantId)
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 500);

  if (filter.channel && filter.channel !== "all") q = q.eq("channel", filter.channel);
  if (filter.personType && filter.personType !== "all") q = q.eq("person_type", filter.personType);
  if (filter.status && filter.status !== "all") q = q.eq("status", filter.status);

  const { data, error } = await q;
  if (error) throw error;

  let rows = (data as CapturedLead[]) || [];
  const s = (filter.search || "").trim().toLowerCase();
  if (s) {
    rows = rows.filter((r) =>
      [r.full_name, r.company_name, r.phone, r.email, r.city, r.cnpj]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s)),
    );
  }
  return rows;
}

/** Conta leads por canal (para os cards de resumo). */
export async function countLeadsByChannel(consultantId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("captured_leads")
    .select("channel")
    .eq("consultant_id", consultantId);
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of ((data as { channel: string }[]) || [])) {
    out[r.channel] = (out[r.channel] || 0) + 1;
  }
  return out;
}

export interface DispatchResult {
  ok: boolean;
  campaign_id?: string;
  queued?: number;
  skipped?: number;
  status?: string;
  error?: string;
}

/**
 * Cria a campanha de disparo a partir dos leads selecionados.
 * Reaproveita o motor de Disparo PRO (bulk_campaigns + bulk-scheduler).
 */
export async function dispatchLeadsToCampaign(input: {
  leadIds: string[];
  campaignName?: string;
  messageText?: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mediaFilename?: string | null;
}): Promise<DispatchResult> {
  const { data, error } = await supabase.functions.invoke("leads-to-campaign", {
    body: {
      lead_ids: input.leadIds,
      campaign_name: input.campaignName,
      message_text: input.messageText,
      media_url: input.mediaUrl ?? null,
      media_type: input.mediaType ?? null,
      media_filename: input.mediaFilename ?? null,
    },
  });
  if (error) return { ok: false, error: error.message };
  return data as DispatchResult;
}

export interface ResearchResult {
  ok: boolean;
  city?: string;
  found?: number;
  ingested?: number;
  deduped?: number;
  skipped?: number;
  error?: string;
}

/** Roda a pesquisa B2B de empresas (OpenStreetMap) por cidade + ramo. */
export async function runLeadResearch(input: {
  city: string;
  uf?: string;
  category?: string;
  limit?: number;
}): Promise<ResearchResult> {
  const { data, error } = await supabase.functions.invoke("lead-research", {
    body: input,
  });
  if (error) return { ok: false, error: error.message };
  return data as ResearchResult;
}

/** Descarta (opt-out) um lead. */
export async function discardLead(leadId: string): Promise<void> {
  const { error } = await supabase
    .from("captured_leads")
    .update({ status: "discarded" })
    .eq("id", leadId);
  if (error) throw error;
}
