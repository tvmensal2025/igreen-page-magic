// lead-ingest.ts
// ──────────────
// Porta única de gravação de leads captados (Meta Lead Ads, TikTok, CTWA,
// landing page, pesquisa B2B). TODOS os conectores chamam `ingestLead` —
// assim a normalização, deduplicação, consentimento e atribuição vivem em um
// só lugar e um canal nunca afeta o outro.
//
// Multi-tenant: o lead é SEMPRE gravado com o consultant_id de quem captou.
//
// Idempotente: usa dedup_key (hash de person_type|cnpj|phone|email) com
// upsert por (consultant_id, dedup_key). Reentrada do mesmo lead não duplica.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { normalizePhone } from "../utils.ts";
import { logConsent } from "./consent.ts";

export type LeadChannel =
  | "meta_leadads"
  | "tiktok_leadgen"
  | "ctwa"
  | "landing"
  | "research"
  | "manual";

export type PersonType = "pf" | "pj";

export interface IngestLeadInput {
  consultantId: string;
  channel: LeadChannel;
  personType?: PersonType;

  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  uf?: string | null;
  productInterest?: string | null;

  // PJ
  companyName?: string | null;
  cnpj?: string | null;
  pjData?: Record<string, unknown>;

  // atribuição
  sourceCampaignId?: string | null;
  ctwaClid?: string | null;

  // consentimento (LGPD)
  consentText?: string | null;
  consentSource?: string | null;
  consentIp?: string | null;
  consentUserAgent?: string | null;

  rawPayload?: Record<string, unknown>;
}

export interface IngestLeadResult {
  ok: boolean;
  leadId?: string;
  deduped?: boolean;
  reason?: string;
}

/** Só dígitos; vazio se não houver. */
function digitsOnly(s?: string | null): string {
  return String(s ?? "").replace(/\D/g, "");
}

/** Hash estável (djb2) em hex — sem dependência de crypto async. */
function stableHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

/**
 * Monta a dedup_key. Prioridade: cnpj (PJ) > phone > email.
 * Inclui person_type para PF e PJ com mesmo telefone não colidirem.
 */
function buildDedupKey(input: {
  personType: PersonType;
  phone: string;
  email?: string | null;
  cnpj?: string | null;
}): string | null {
  const cnpj = digitsOnly(input.cnpj);
  const email = String(input.email ?? "").trim().toLowerCase();
  const basis = cnpj || input.phone || email;
  if (!basis) return null;
  return stableHash(`${input.personType}|${basis}`);
}

/**
 * Grava (ou deduplica) um lead captado. Nunca lança — retorna {ok:false}.
 *
 * @param supabase  Cliente com service role (edge function).
 */
export async function ingestLead(
  supabase: SupabaseClient,
  input: IngestLeadInput,
): Promise<IngestLeadResult> {
  try {
    if (!input.consultantId) {
      return { ok: false, reason: "missing_consultant_id" };
    }

    const personType: PersonType = input.personType === "pj" ? "pj" : "pf";
    const phone = input.phone ? normalizePhone(input.phone) : "";
    const email = input.email ? String(input.email).trim().toLowerCase() : null;

    // Precisa de pelo menos um identificador de contato.
    if (!phone && !email && !digitsOnly(input.cnpj)) {
      return { ok: false, reason: "missing_contact" };
    }

    const dedupKey = buildDedupKey({
      personType,
      phone,
      email,
      cnpj: input.cnpj,
    });

    const row = {
      consultant_id: input.consultantId,
      channel: input.channel,
      person_type: personType,
      full_name: input.fullName ?? null,
      phone: phone || null,
      email,
      city: input.city ?? null,
      uf: input.uf ?? null,
      product_interest: input.productInterest ?? null,
      company_name: input.companyName ?? null,
      cnpj: input.cnpj ? digitsOnly(input.cnpj) : null,
      pj_data: input.pjData ?? {},
      source_campaign_id: input.sourceCampaignId ?? null,
      ctwa_clid: input.ctwaClid ?? null,
      consent_text: input.consentText ?? null,
      consent_at: input.consentText ? new Date().toISOString() : null,
      consent_source: input.consentSource ?? null,
      dedup_key: dedupKey,
      raw_payload: input.rawPayload ?? {},
      status: "new" as const,
    };

    // Upsert idempotente por (consultant_id, dedup_key). Se a unique constraint
    // bater, mantém o lead existente e não sobrescreve (ignoreDuplicates).
    const { data, error } = await supabase
      .from("captured_leads")
      .upsert(row, {
        onConflict: "consultant_id,dedup_key",
        ignoreDuplicates: true,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      console.warn("[lead-ingest] upsert falhou:", error.message);
      return { ok: false, reason: error.message };
    }

    // ignoreDuplicates retorna null quando já existia → lead deduplicado.
    if (!data?.id) {
      return { ok: true, deduped: true };
    }

    // Trilha de consentimento (best-effort).
    if (input.consentText) {
      await logConsent(supabase, {
        leadId: data.id,
        consultantId: input.consultantId,
        consentText: input.consentText,
        channel: input.channel,
        ip: input.consentIp,
        userAgent: input.consentUserAgent,
      });
    }

    return { ok: true, leadId: data.id, deduped: false };
  } catch (e) {
    console.warn("[lead-ingest] exceção:", (e as Error)?.message);
    return { ok: false, reason: (e as Error)?.message ?? "exception" };
  }
}
