// Closer — verifica checklist e chama finalize-capture.
// Centraliza a lógica que transforma a v1 numa vendedora que fecha a venda
// de verdade, em vez de só conversar.

import type { SupabaseClient } from "./types.ts";

const REQUIRED_FOR_AI = [
  "name",
  "email",
  "phone_whatsapp",
  "electricity_bill_value",
  "electricity_bill_photo_url",
  "document_front_url",
] as const;

const MEDIA_PLACEHOLDERS = new Set(["evolution-media:pending", "collected", "nao_aplicavel", ""]);

export interface ChecklistResult {
  pronto: boolean;
  faltantes: Array<{ campo: string; razao: string }>;
}

export function checklistMinimo(customer: any): ChecklistResult {
  const faltantes: Array<{ campo: string; razao: string }> = [];

  for (const key of REQUIRED_FOR_AI) {
    const v = customer?.[key];
    if (key === "electricity_bill_value") {
      if (!v || Number(v) <= 0) faltantes.push({ campo: key, razao: "valor da conta ausente" });
      continue;
    }
    const s = String(v ?? "").trim();
    if (!s) {
      faltantes.push({ campo: key, razao: "vazio" });
      continue;
    }
    if (key === "electricity_bill_photo_url" || key === "document_front_url") {
      if (MEDIA_PLACEHOLDERS.has(s)) {
        faltantes.push({ campo: key, razao: "mídia ainda não consolidada" });
      }
      continue;
    }
    if (key === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      faltantes.push({ campo: key, razao: "formato inválido" });
    }
    if (key === "name" && s.split(/\s+/).length < 2) {
      faltantes.push({ campo: key, razao: "nome incompleto" });
    }
  }
  return { pronto: faltantes.length === 0, faltantes };
}

export interface CloseResult {
  acionou: boolean;
  ok: boolean;
  mode?: string;
  faltantes?: Array<{ campo: string; razao: string }>;
  portalMissing?: string[];
  portalInvalid?: Array<{ field: string; label: string; reason: string }>;
  erro?: string;
}

/**
 * Tenta fechar o cadastro:
 * 1. Checa checklist mínimo do que a IA é responsável por coletar.
 * 2. Se ok, chama finalize-capture que valida o checklist completo do portal.
 * 3. Se finalize-capture retorna incomplete, devolve a lista pra v1 pedir.
 */
export async function tentarFechar(
  supabase: SupabaseClient,
  customerId: string,
): Promise<CloseResult> {
  const { data: customer } = await supabase
    .from("customers")
    .select("name, email, phone_whatsapp, electricity_bill_value, electricity_bill_photo_url, document_front_url, document_back_url, document_type, conversation_step, status")
    .eq("id", customerId)
    .maybeSingle();
  if (!customer) return { acionou: false, ok: false, erro: "customer não encontrado" };

  // Já está rolando no portal? não faz nada
  const step = String(customer.conversation_step || "");
  const status = String(customer.status || "");
  if (
    ["portal_submitting", "awaiting_otp", "validating_otp", "cadastro_concluido", "registered_igreen", "approved", "active"].includes(step) ||
    ["portal_submitting", "registered_igreen", "approved", "active"].includes(status)
  ) {
    return { acionou: false, ok: true, mode: "already_dispatched" };
  }

  const check = checklistMinimo(customer);
  if (!check.pronto) {
    return { acionou: false, ok: false, faltantes: check.faltantes };
  }

  // Chama finalize-capture
  try {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/finalize-capture`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      },
      body: JSON.stringify({ customerId, sendNotice: true }),
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok && body?.ok !== false) {
      return { acionou: true, ok: true, mode: body?.mode || "submitted" };
    }
    if (body?.error === "incomplete") {
      return {
        acionou: true,
        ok: false,
        portalMissing: Array.isArray(body.missing) ? body.missing : [],
        portalInvalid: Array.isArray(body.invalid) ? body.invalid : [],
      };
    }
    return { acionou: true, ok: false, erro: body?.error || `http ${r.status}` };
  } catch (e) {
    return { acionou: true, ok: false, erro: (e as Error).message };
  }
}

/**
 * Lê o customer e decide se mídia nova foi recebida desde o último turno da v1.
 * Compara com o snapshot em state.midia_recebida.
 */
export function detectarMidiaNova(
  customer: any,
  state: { midia_recebida?: { conta?: boolean; doc_frente?: boolean; doc_verso?: boolean } },
): { conta: boolean; doc_frente: boolean; doc_verso: boolean } {
  const has = (v: any) => {
    const s = String(v ?? "").trim();
    return s.length > 0 && !MEDIA_PLACEHOLDERS.has(s);
  };
  const agora = {
    conta: has(customer?.electricity_bill_photo_url),
    doc_frente: has(customer?.document_front_url),
    doc_verso: has(customer?.document_back_url),
  };
  const antes = state.midia_recebida || {};
  return {
    conta: agora.conta && !antes.conta,
    doc_frente: agora.doc_frente && !antes.doc_frente,
    doc_verso: agora.doc_verso && !antes.doc_verso,
  };
}
