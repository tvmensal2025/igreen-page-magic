// =============================================================================
// Orçamento — API pública (lado destinatário)
// =============================================================================
// A página pública /proposta/:token NÃO acessa o banco direto. Toda leitura e
// resposta passa pelas edge functions (proposal-public-get / proposal-respond),
// que usam service_role e identificam a proposta só pelo public_token.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";
import type { PublicProposalView } from "./types";

// Em desenvolvimento, o preflight das edge functions falha por CORS quando o
// dev server não está em localhost:8080 (a allowlist da function). Para testar
// localmente sem deploy, usamos o proxy do Vite (/functions-proxy → Supabase),
// que torna a chamada same-origin. Em produção, segue pelo supabase-js normal.
const DEV_FN_PROXY = import.meta.env.DEV ? "/functions-proxy" : null;

const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo";

/** Invoca uma edge function. Usa o proxy do Vite em dev (contorna CORS local). */
async function invokeFunction<T>(name: string, body: unknown): Promise<T> {
  if (DEV_FN_PROXY) {
    const res = await fetch(`${DEV_FN_PROXY}/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`);
    if (data?.error) throw new Error(data.error);
    return data as T;
  }
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as T;
}

/** Busca os dados de exibição de uma proposta pelo token público. */
export async function getPublicProposal(token: string): Promise<PublicProposalView> {
  return invokeFunction<PublicProposalView>("proposal-public-get", { token });
}

export type RespondAction = "accept" | "reject" | "counter";

export interface RespondInput {
  token: string;
  action: RespondAction;
  note?: string | null;
  /** Contraproposta: URL do anexo já enviado e valor proposto pelo cliente. */
  attachmentUrl?: string | null;
  counterAmount?: number | null;
}

/** Registra a resposta do destinatário (aceitar / recusar / contrapor). */
export async function respondToProposal(
  input: RespondInput,
): Promise<{ ok: boolean; status: string }> {
  return invokeFunction<{ ok: boolean; status: string }>("proposal-respond", {
    token: input.token,
    action: input.action,
    note: input.note ?? null,
    attachment_url: input.attachmentUrl ?? null,
    counter_amount: input.counterAmount ?? null,
  });
}
