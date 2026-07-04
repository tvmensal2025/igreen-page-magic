// Alertas específicos do Fluxo D (variante Captação Meta Ads).
//
// Tasks 6 e 7 da spec `captacao-fluxo-d-conversao` (Requirement 2.5..2.7):
//   - flow_d_ocr_failed_bill: OCR da conta de luz falhou.
//   - flow_d_ocr_failed_doc: OCR do documento (RG/CNH) falhou.
//   - flow_d_stuck: lead em Fluxo D não interage há >30s em algum step.
//
// Cada alerta vira uma linha em `bot_handoff_alerts` para que o consultor
// veja no NotificationCenter e possa intervir manualmente.
//
// Função best-effort: NUNCA lança. Falha no INSERT é loggada mas não
// interrompe o pipeline determinístico.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type FlowDAlertType =
  | "flow_d_stuck"
  | "flow_d_ocr_failed_bill"
  | "flow_d_ocr_failed_doc";

export interface FlowDAlertInput {
  supabase: SupabaseClient;
  customerId: string;
  consultantId?: string | null;
  conversationStep: string | null;
  alertType: FlowDAlertType;
  /** Mensagem opcional para o admin (até 500 chars). */
  reason?: string;
  /** Variante do fluxo do customer no momento do alerta (default 'D'). */
  flowVariant?: string;
}

/**
 * Verifica se o cliente está em Fluxo D antes de gerar o alerta. Para
 * outros fluxos (A/B/C/E), os alertas existentes (`bot_handoff_alerts`
 * com tipos legacy) continuam funcionando — não duplicamos.
 *
 * Retorna true se inseriu, false se pulou ou falhou.
 */
export async function recordFlowDAlert(input: FlowDAlertInput): Promise<boolean> {
  const variant = (input.flowVariant ?? "D").toString().toUpperCase();
  if (variant !== "D" && variant !== "M") return false;

  try {
    const { error } = await input.supabase.from("bot_handoff_alerts").insert({
      customer_id: input.customerId,
      consultant_id: input.consultantId ?? null,
      alert_type: input.alertType,
      conversation_step: input.conversationStep,
      reason: (input.reason ?? "").slice(0, 500) || null,
      severity: input.alertType === "flow_d_stuck" ? "warning" : "error",
      created_at: new Date().toISOString(),
    });
    if (error) {
      // Se a coluna `severity` ou outras não existirem, tenta novamente
      // só com os campos essenciais — preserva compat com schemas antigos.
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("column") || msg.includes("does not exist")) {
        await input.supabase.from("bot_handoff_alerts").insert({
          customer_id: input.customerId,
          alert_type: input.alertType,
          conversation_step: input.conversationStep,
          created_at: new Date().toISOString(),
        });
        return true;
      }
      console.warn("[flow-d-alerts] insert failed:", error.message);
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn("[flow-d-alerts] exception:", e?.message ?? String(e));
    return false;
  }
}
