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
  pj_data?: Record<string, unknown> | null;
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
      "id, consultant_id, channel, person_type, full_name, phone, email, city, uf, product_interest, company_name, cnpj, pj_data, status, created_at",
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

/**
 * Retorna o Set de telefones (somente dígitos, últimos 11) que o consultor
 * JÁ disparou em campanhas anteriores — usado para marcar leads já enviados
 * na tela de captação e evitar repetir o mesmo número.
 */
export async function listAlreadyDispatchedPhones(consultantId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const { data: camps, error: e1 } = await (supabase as any)
    .from("bulk_campaigns")
    .select("id")
    .eq("consultant_id", consultantId);
  if (e1 || !camps?.length) return out;
  const ids = (camps as { id: string }[]).map((c) => c.id);

  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    // Paginação manual: o supabase-js limita 1000 linhas por chamada por
    // padrão. Em consultor com muitas campanhas grandes, isso truncava o
    // anti-repetição e leads "já enviados" voltavam selecionáveis.
    const PAGE = 1000;
    let from = 0;
    // hard cap para não rodar para sempre em caso de bug
    for (let p = 0; p < 200; p++) {
      const { data, error } = await (supabase as any)
        .from("bulk_campaign_targets")
        .select("phone, status")
        .in("campaign_id", slice)
        .in("status", ["sent", "sending"])
        .range(from, from + PAGE - 1);
      if (error) break;
      const rows = (data as { phone: string }[]) || [];
      for (const r of rows) {
        const digits = String(r.phone || "").replace(/\D/g, "");
        if (digits.length >= 8) out.add(digits.slice(-11));
      }
      if (rows.length < PAGE) break;
      from += PAGE;
    }
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

export interface ResearchItem {
  osm_id?: string;
  name: string;
  phone: string | null;
  email?: string | null;
  category?: string | null;
  street?: string | null;
  housenumber?: string | null;
  neighbourhood?: string | null;
  city?: string | null;
  uf?: string | null;
  postcode?: string | null;
  website?: string | null;
  opening_hours?: string | null;
  full_address?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export interface ResearchSearchResult {
  ok: boolean;
  city?: string;
  uf?: string | null;
  category?: string | null;
  found?: number;
  with_phone?: number;
  items?: ResearchItem[];
  error?: string;
}

export interface ResearchImportResult {
  ok: boolean;
  ingested?: number;
  deduped?: number;
  skipped?: number;
  total?: number;
  error?: string;
}

/** PRÉVIA: busca empresas no OpenStreetMap sem gravar. */
export async function searchBusinesses(input: {
  city: string;
  uf?: string;
  neighbourhood?: string;
  category?: string;
  limit?: number;
}): Promise<ResearchSearchResult> {
  const { data, error } = await supabase.functions.invoke("lead-research", {
    body: { action: "search", ...input },
  });
  if (error) return { ok: false, error: error.message };
  return data as ResearchSearchResult;
}

/** Grava os itens escolhidos como leads PJ do consultor. */
export async function importBusinesses(items: ResearchItem[]): Promise<ResearchImportResult> {
  const { data, error } = await supabase.functions.invoke("lead-research", {
    body: { action: "import", items },
  });
  if (error) return { ok: false, error: error.message };
  return data as ResearchImportResult;
}

/** Descarta (opt-out) um lead. */
export async function discardLead(leadId: string): Promise<void> {
  const { error } = await supabase
    .from("captured_leads")
    .update({ status: "discarded" })
    .eq("id", leadId);
  if (error) throw error;
}

export interface CityHit {
  name: string;
  uf: string;
}

/**
 * Autocomplete de cidades a partir da tabela fb_city_cache (601 municípios).
 * Digite "cam" e recebe Campinas, Campina Grande, etc.
 */
export async function searchCityNames(query: string): Promise<CityHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase
    .from("fb_city_cache")
    .select("name, uf")
    .ilike("name", `${q}%`)
    .order("name", { ascending: true })
    .limit(12);
  if (error) return [];
  return (data as CityHit[]) || [];
}
