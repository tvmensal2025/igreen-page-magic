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
  customer_id?: string | null;
}

export interface ListLeadsFilter {
  consultantId: string;
  channel?: LeadChannel | "all";
  personType?: PersonType | "all";
  status?: LeadStatus | "all";
  search?: string;
  /** Página 0-based. */
  page?: number;
  /** Itens por página (default 50, máx 200). */
  pageSize?: number;
}

export interface ListLeadsResult {
  rows: CapturedLead[];
  total: number;
  page: number;
  pageSize: number;
}

const LEAD_SELECT =
  "id, consultant_id, channel, person_type, full_name, phone, email, city, uf, product_interest, company_name, cnpj, pj_data, status, created_at, customer_id";

function escapeIlike(s: string): string {
  return s.replace(/[%_,]/g, " ").trim();
}

/** Lista paginada no servidor (não baixa 95k no browser). */
export async function listCapturedLeads(filter: ListLeadsFilter): Promise<ListLeadsResult> {
  const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 50));
  const page = Math.max(0, filter.page ?? 0);
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let q = supabase
    .from("captured_leads")
    .select(LEAD_SELECT, { count: "exact" })
    .eq("consultant_id", filter.consultantId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filter.channel && filter.channel !== "all") q = q.eq("channel", filter.channel);
  if (filter.personType && filter.personType !== "all") q = q.eq("person_type", filter.personType);
  if (filter.status && filter.status !== "all") q = q.eq("status", filter.status);

  const s = escapeIlike(filter.search || "");
  if (s.length >= 2) {
    const pat = `"%${s.replace(/"/g, "")}%"`;
    q = q.or(
      [
        `full_name.ilike.${pat}`,
        `company_name.ilike.${pat}`,
        `phone.ilike.${pat}`,
        `email.ilike.${pat}`,
        `city.ilike.${pat}`,
        `cnpj.ilike.${pat}`,
      ].join(","),
    );
  }

  const { data, error, count } = await q;
  if (error) throw error;
  return {
    rows: (data as CapturedLead[]) || [],
    total: count ?? 0,
    page,
    pageSize,
  };
}

/** Conta leads por canal via RPC (GROUP BY no Postgres). */
export async function countLeadsByChannel(consultantId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc("count_captured_leads_by_channel", {
    p_consultant_id: consultantId,
  });
  if (error) throw error;
  const raw = (data || {}) as Record<string, number>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = Number(v) || 0;
  return out;
}

/**
 * Interseção: quais telefones da página atual já foram disparados.
 * Não varre todas as campanhas — só cruza com a lista da página.
 */
export async function filterAlreadyDispatchedPhones(
  consultantId: string,
  phones: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const cleaned = phones
    .map((p) => String(p || "").replace(/\D/g, ""))
    .filter((p) => p.length >= 8);
  if (cleaned.length === 0) return out;
  const { data, error } = await supabase.rpc("filter_dispatched_phones", {
    p_consultant_id: consultantId,
    p_phones: cleaned,
  });
  if (error) return out;
  for (const p of (data as string[]) || []) {
    if (p) out.add(p);
  }
  return out;
}

/**
 * @deprecated Preferir filterAlreadyDispatchedPhones(página).
 * Mantido para compat — NÃO usar no load da lista (trava com 95k).
 */
export async function listAlreadyDispatchedPhones(consultantId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const { data: camps, error: e1 } = await (supabase as any)
    .from("bulk_campaigns")
    .select("id")
    .eq("consultant_id", consultantId)
    .limit(50);
  if (e1 || !camps?.length) return out;
  const ids = (camps as { id: string }[]).map((c) => c.id);
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const PAGE = 1000;
    let from = 0;
    for (let p = 0; p < 20; p++) {
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
 * Enfileira disparo no servidor (bulk_campaigns + bulk-scheduler).
 * NÃO envia no browser — o worker assume.
 */
export async function dispatchLeadsToCampaign(input: {
  leadIds: string[];
  campaignName?: string;
  messageText?: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mediaFilename?: string | null;
}): Promise<DispatchResult> {
  if (!input.leadIds.length) return { ok: false, error: "Nenhum lead selecionado." };
  if (input.leadIds.length > 5000) {
    return { ok: false, error: "Máximo 5.000 leads por disparo. Selecione menos ou filtre." };
  }
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
  if (error) {
    try {
      const ctx = (error as { context?: Response })?.context;
      if (ctx && typeof ctx.json === "function") {
        const body = (await ctx.json()) as { error?: string; max?: number };
        return {
          ok: false,
          error: body.error === "too_many_leads"
            ? `Máximo ${body.max ?? 5000} leads por disparo.`
            : (body.error || error.message),
        };
      }
    } catch { /* ignore */ }
    return { ok: false, error: error.message };
  }
  const r = (data || {}) as DispatchResult;
  if (r.ok === false) return r;
  return { ok: true, ...r };
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
  neighbourhood_note?: string | null;
  strategy?: string;
  error?: string;
  detail?: string;
}

function humanizeResearchError(code?: string, detail?: string): string {
  switch (code) {
    case "overpass_indisponivel":
      return "Fonte de dados temporariamente indisponível. Tente de novo em alguns segundos.";
    case "city_not_found":
      return detail || "Cidade não encontrada. Escolha uma sugestão da lista.";
    case "city_required":
      return "Informe a cidade.";
    case "uf_required_for_state_scope":
      return "Informe a UF para buscar o estado inteiro.";
    case "no_items":
      return "Nenhum item selecionado.";
    default:
      return detail || code || "Falha na busca";
  }
}

/** Extrai corpo JSON de FunctionsHttpError (non-2xx) quando disponível. */
async function readInvokeErrorBody(
  error: unknown,
): Promise<Record<string, unknown> | null> {
  try {
    const ctx = (error as { context?: Response })?.context;
    if (ctx && typeof ctx.json === "function") {
      return (await ctx.json()) as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export interface ResearchImportResult {
  ok: boolean;
  ingested?: number;
  deduped?: number;
  skipped?: number;
  total?: number;
  error?: string;
}

/** PRÉVIA: busca empresas no OpenStreetMap sem gravar (sem teto de quantidade). */
export async function searchBusinesses(input: {
  city: string;
  uf?: string;
  neighbourhood?: string;
  category?: string;
  /** Omitido / 0 = sem limite (todos os matches da cidade). */
  limit?: number;
  state_scope?: boolean;
}): Promise<ResearchSearchResult> {
  const { data, error } = await supabase.functions.invoke("lead-research", {
    body: {
      action: "search",
      city: input.city,
      uf: input.uf,
      neighbourhood: input.neighbourhood,
      category: input.category,
      state_scope: input.state_scope,
      // 0 = ilimitado no backend
      limit: input.limit ?? 0,
    },
  });
  if (error) {
    const body = await readInvokeErrorBody(error);
    if (body) {
      const code = String(body.error || "");
      const detail = body.detail ? String(body.detail) : undefined;
      return {
        ok: false,
        error: humanizeResearchError(code, detail),
        detail,
      };
    }
    const msg = error.message || "Falha na busca";
    if (/Failed to send|fetch|network|aborted|timeout/i.test(msg)) {
      return {
        ok: false,
        error: "A busca demorou demais ou a conexão caiu. Tente de novo (cidade menor ou um ramo específico).",
      };
    }
    return { ok: false, error: msg };
  }
  const result = (data || {}) as ResearchSearchResult;
  if (result.ok === false) {
    return {
      ...result,
      error: humanizeResearchError(result.error, result.detail),
    };
  }
  return result;
}

const IMPORT_CHUNK = 80;

/** Grava os itens escolhidos como leads PJ — em lotes (sem teto; evita timeout da edge). */
export async function importBusinesses(items: ResearchItem[]): Promise<ResearchImportResult> {
  if (!items.length) return { ok: false, error: "Nenhum item selecionado." };

  let ingested = 0;
  let deduped = 0;
  let skipped = 0;
  const total = items.length;

  for (let i = 0; i < items.length; i += IMPORT_CHUNK) {
    const chunk = items.slice(i, i + IMPORT_CHUNK);
    const { data, error } = await supabase.functions.invoke("lead-research", {
      body: { action: "import", items: chunk },
    });
    if (error) {
      const body = await readInvokeErrorBody(error);
      if (body) {
        return {
          ok: false,
          error: humanizeResearchError(
            String(body.error || ""),
            body.detail ? String(body.detail) : undefined,
          ),
          ingested,
          deduped,
          skipped,
          total,
        };
      }
      const msg = error.message || "Falha ao salvar";
      if (/Failed to send|fetch|network|aborted|timeout/i.test(msg)) {
        return {
          ok: false,
          error: `Salvei ${ingested} até agora, mas a conexão caiu no meio. Tente de novo com os que faltam.`,
          ingested,
          deduped,
          skipped,
          total,
        };
      }
      return { ok: false, error: msg, ingested, deduped, skipped, total };
    }
    const r = (data || {}) as ResearchImportResult;
    if (r.ok === false) {
      return {
        ok: false,
        error: r.error || "Falha ao salvar",
        ingested,
        deduped,
        skipped,
        total,
      };
    }
    ingested += r.ingested ?? 0;
    deduped += r.deduped ?? 0;
    skipped += r.skipped ?? 0;
  }

  return { ok: true, ingested, deduped, skipped, total };
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

/** Normaliza query de cidade: minúsculas, sem acento, espaços colapsados. */
function normalizeCityQuery(q: string): string {
  return q
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Autocomplete de cidades a partir de br_municipios (catálogo IBGE ~5571).
 * Prefixo em name_normalized (+ UF opcional). fb_city_cache permanece só para Ads/Meta.
 */
export async function searchCityNames(query: string, uf?: string): Promise<CityHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const norm = normalizeCityQuery(q);
  let req = supabase
    .from("br_municipios")
    .select("name, uf")
    .like("name_normalized", `${norm}%`)
    .order("name", { ascending: true })
    .limit(20);
  const ufClean = (uf || "").trim().toUpperCase();
  if (ufClean.length === 2) req = req.eq("uf", ufClean);
  const { data, error } = await req;
  if (error) return [];
  return (data as CityHit[]) || [];
}

/** Lista TODOS os municípios de uma UF (paginado — sem teto artificial). */
export async function listMunicipiosByUf(uf: string): Promise<CityHit[]> {
  const ufClean = uf.trim().toUpperCase();
  if (ufClean.length !== 2) return [];
  const PAGE = 1000;
  const rows: CityHit[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("br_municipios")
      .select("name, uf")
      .eq("uf", ufClean)
      .order("name", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) break;
    const chunk = (data as CityHit[]) || [];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return rows;
}

export interface HarvestCityResult {
  ok: boolean;
  city: string;
  uf: string;
  found: number;
  ingested: number;
  deduped: number;
  skipped: number;
  error?: string;
}

export interface SweepJob {
  id: string;
  uf: string;
  category: string;
  status: string;
  total_cities: number;
  done_cities: number;
  found_phones: number;
  ingested: number;
  deduped: number;
  errors: number;
  created_at?: string;
  updated_at?: string;
}

export interface SweepCityLog {
  city: string;
  uf: string;
  status: string;
  found: number;
  ingested: number;
  deduped: number;
  error?: string | null;
  processed_at?: string | null;
}

export interface SweepStatusResult {
  ok: boolean;
  sweep: SweepJob | null;
  pending?: number;
  recent?: SweepCityLog[];
  error?: string;
}

export interface SweepStartResult {
  ok: boolean;
  sweep_id?: string;
  total_cities?: number;
  done_cities?: number;
  status?: string;
  uf?: string;
  reused?: boolean;
  resumed?: boolean;
  error?: string;
  detail?: string;
}

/** Enfileira varredura UF no servidor (cron salva telefones cidade a cidade). */
export async function startUfPhoneSweep(input: {
  uf: string;
  category?: string;
}): Promise<SweepStartResult> {
  const { data, error } = await supabase.functions.invoke("lead-research-sweep", {
    body: {
      action: "start",
      uf: input.uf.trim().toUpperCase(),
      category: input.category || "",
    },
  });
  if (error) {
    const body = await readInvokeErrorBody(error);
    return {
      ok: false,
      error: humanizeResearchError(
        String(body?.error || ""),
        body?.detail ? String(body.detail) : error.message,
      ),
    };
  }
  return (data || { ok: false, error: "Falha ao iniciar" }) as SweepStartResult;
}

/** Progresso da varredura (sweep_id opcional = job running do consultor). */
export async function getUfPhoneSweepStatus(sweepId?: string): Promise<SweepStatusResult> {
  const { data, error } = await supabase.functions.invoke("lead-research-sweep", {
    body: { action: "status", sweep_id: sweepId || undefined },
  });
  if (error) {
    return { ok: false, sweep: null, error: error.message };
  }
  return (data || { ok: false, sweep: null }) as SweepStatusResult;
}

/** Pausa a varredura (cidades pending ficam; cron para de processar). */
export async function cancelUfPhoneSweep(sweepId: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke("lead-research-sweep", {
    body: { action: "cancel", sweep_id: sweepId },
  });
  if (error) return { ok: false, error: error.message };
  return (data || { ok: false }) as { ok: boolean; error?: string };
}

/**
 * Uma cidade: busca TODOS os telefones públicos e salva na lista (nada fica de fora).
 * Só grava em captured_leads — não dispara WhatsApp.
 */
export async function harvestCityPhones(input: {
  city: string;
  uf: string;
  category?: string;
  neighbourhood?: string;
}): Promise<HarvestCityResult> {
  const city = input.city.trim();
  const uf = input.uf.trim().toUpperCase();
  const base = { city, uf, found: 0, ingested: 0, deduped: 0, skipped: 0 };
  const search = await searchBusinesses({
    city,
    uf,
    category: input.category,
    neighbourhood: input.neighbourhood,
    limit: 0,
  });
  if (!search.ok) {
    return { ...base, ok: false, error: search.error || "Falha na busca" };
  }
  const withPhone = (search.items || []).filter((i) => i.phone);
  if (withPhone.length === 0) {
    return { ...base, ok: true, found: 0 };
  }
  const imp = await importBusinesses(withPhone);
  return {
    ok: !!imp.ok,
    city: search.city || city,
    uf: String(search.uf || uf),
    found: withPhone.length,
    ingested: imp.ingested ?? 0,
    deduped: imp.deduped ?? 0,
    skipped: imp.skipped ?? 0,
    error: imp.ok ? undefined : (imp.error || "Falha ao salvar"),
  };
}

/**
 * Conta quantos `customers` recentes (WhatsApp inbound) AINDA não foram
 * espelhados em `captured_leads`. Usado pelo banner "X leads do WhatsApp
 * pendentes" no painel de Captação. Fonte da verdade: `customers` do consultor
 * com telefone, criados nos últimos 30 dias, menos os que já existem como
 * `captured_leads` para o mesmo consultor (match por telefone normalizado).
 */
export async function countPendingWhatsappLeads(consultantId: string): Promise<number> {
  try {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data: cust } = await supabase
      .from("customers")
      .select("phone_whatsapp")
      .eq("consultant_id", consultantId)
      .gte("created_at", since)
      .not("phone_whatsapp", "is", null)
      .limit(2000);
    const custPhones = new Set(
      ((cust as { phone_whatsapp: string | null }[]) || [])
        .map((c) => String(c.phone_whatsapp || "").replace(/\D/g, "").slice(-11))
        .filter((p) => p.length >= 10),
    );
    if (custPhones.size === 0) return 0;
    const { data: leads } = await supabase
      .from("captured_leads")
      .select("phone")
      .eq("consultant_id", consultantId)
      .not("phone", "is", null)
      .limit(5000);
    const leadPhones = new Set(
      ((leads as { phone: string | null }[]) || [])
        .map((l) => String(l.phone || "").replace(/\D/g, "").slice(-11))
        .filter((p) => p.length >= 10),
    );
    let missing = 0;
    for (const p of custPhones) if (!leadPhones.has(p)) missing++;
    return missing;
  } catch {
    return 0;
  }
}
