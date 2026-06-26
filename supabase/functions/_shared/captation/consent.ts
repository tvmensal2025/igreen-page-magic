// consent.ts
// ──────────
// Registro de consentimento (LGPD) para leads captados.
//
// Toda entrada de lead que tenha base legal = consentimento DEVE gravar a
// evidência aqui: o texto exato do opt-in mostrado, o canal, IP e user-agent.
// Isso é o que protege a empresa numa fiscalização da ANPD.
//
// Fail-open: falha ao gravar consentimento NUNCA derruba a captação do lead
// (o lead já tem consent_text/consent_at na própria captured_leads como
// fonte primária; lead_consent_log é a trilha de auditoria imutável).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface ConsentInput {
  leadId: string;
  consultantId?: string | null;
  consentText: string;
  channel: string;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Grava uma linha de auditoria de consentimento. Best-effort.
 * Retorna true se gravou, false se falhou (sem lançar).
 */
export async function logConsent(
  supabase: SupabaseClient,
  input: ConsentInput,
): Promise<boolean> {
  try {
    const { error } = await supabase.from("lead_consent_log").insert({
      lead_id: input.leadId,
      consultant_id: input.consultantId ?? null,
      consent_text: input.consentText,
      channel: input.channel,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
    });
    if (error) {
      console.warn("[consent] insert falhou:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[consent] exceção:", (e as Error)?.message);
    return false;
  }
}
