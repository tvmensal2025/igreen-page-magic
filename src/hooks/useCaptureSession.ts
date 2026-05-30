import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PORTAL_FIELDS, validateForPortal, type ValidationResult } from "@/lib/captacao/portalValidation";

/**
 * Lista canônica usada pela ficha + barra de progresso.
 * É a MESMA lista que o portal iGreen exige no POST /customers — não tem
 * mais "RG" nem "Telefone fixo" inventados que sempre ficavam vermelhos.
 * Inclui media_consumo e numero_instalacao, que antes ficavam ocultos e
 * causavam falha silenciosa no worker (404 em /bonus/rules).
 */
export const CAPTURE_FIELDS = PORTAL_FIELDS
  // Documentos (uploads) ficam num módulo separado (CaptureDocumentTiles)
  .filter((f) => f.group !== "docs")
  .map((f) => ({ key: f.key, label: f.label } as const));

export type CaptureFieldKey = typeof PORTAL_FIELDS[number]["key"];

export interface CaptureCustomer {
  id: string;
  consultant_id: string;
  name: string | null;
  cpf: string | null;
  rg: string | null;
  data_nascimento: string | null;
  phone_whatsapp: string | null;
  phone_landline: string | null;
  email: string | null;
  cep: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  electricity_bill_value: number | null;
  document_front_url: string | null;
  document_back_url: string | null;
  electricity_bill_photo_url: string | null;
  capture_mode: string | null;
  capture_started_at: string | null;
  conversation_step: string | null;
  name_source?: string | null;
  flow_variant?: string | null;
  nome_mae?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  distribuidora?: string | null;
  numero_instalacao?: string | null;
  bill_holder_name?: string | null;
  doc_holder_name?: string | null;
  bill_data_confirmed_at?: string | null;
  bill_data_confirmation_by?: string | null;
  doc_data_confirmed_at?: string | null;
  doc_data_confirmation_by?: string | null;
  name_mismatch_flag?: boolean | null;
  name_mismatch_reason?: string | null;
  name_mismatch_acknowledged_at?: string | null;
  bill_owner_relationship?: string | null;
  phone_contact_confirmed?: boolean | null;
  bot_paused?: boolean | null;
  created_at: string;
}

function isFieldFilled(c: CaptureCustomer | null | undefined, key: CaptureFieldKey): boolean {
  if (!c) return false;
  const v = (c as any)[key];
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && !v.trim()) return false;
  if ((key === "electricity_bill_value" || key === "media_consumo") && Number(v) <= 0) return false;
  return true;
}

export function useCaptureSession(customerId: string | null) {
  const [customer, setCustomer] = useState<CaptureCustomer | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!customerId) { setCustomer(null); return; }
    setLoading(true);
    const { data } = await supabase
      .from("customers")
      .select("id, consultant_id, name, cpf, rg, data_nascimento, nome_mae, phone_whatsapp, phone_landline, phone_contact_confirmed, email, cep, address_street, address_number, address_complement, address_neighborhood, address_city, address_state, distribuidora, numero_instalacao, bill_holder_name, doc_holder_name, bill_data_confirmed_at, bill_data_confirmation_by, doc_data_confirmed_at, doc_data_confirmation_by, name_mismatch_flag, name_mismatch_reason, name_mismatch_acknowledged_at, bill_owner_relationship, electricity_bill_value, document_front_url, document_back_url, electricity_bill_photo_url, capture_mode, capture_started_at, conversation_step, flow_variant, name_source, bot_paused, created_at")
      .eq("id", customerId)
      .maybeSingle();
    setCustomer((data as CaptureCustomer) || null);
    setLoading(false);
  }, [customerId]);

  useEffect(() => { void load(); }, [load]);

  // Realtime subscription
  useEffect(() => {
    if (!customerId) return;
    const ch = supabase
      .channel(`capture-${customerId}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "customers", filter: `id=eq.${customerId}` },
        (payload) => setCustomer((prev) => ({ ...(prev || {}), ...(payload.new as any) })))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [customerId]);

  const filledCount = useMemo(
    () => CAPTURE_FIELDS.filter((f) => isFieldFilled(customer, f.key)).length,
    [customer]
  );
  const totalFields = CAPTURE_FIELDS.length;
  const progress = Math.round((filledCount / totalFields) * 100);

  const missing = useMemo(() => {
    const list: string[] = [];
    CAPTURE_FIELDS.forEach((f) => { if (!isFieldFilled(customer, f.key)) list.push(f.label); });
    if (!customer?.document_back_url) list.push("RG verso");
    if (!customer?.electricity_bill_photo_url) list.push("Conta de luz");
    if (customer?.name_mismatch_flag && !customer?.name_mismatch_acknowledged_at) list.push("Confirmar titularidade");
    return list;
  }, [customer]);

  const isComplete = missing.length === 0 && !!customer;

  const updateField = useCallback(async (field: CaptureFieldKey, value: any) => {
    if (!customerId || !customer) return;
    const prevValue = (customer as any)[field];
    const wasFilled = isFieldFilled(customer, field);
    // optimistic
    setCustomer((c) => c ? ({ ...c, [field]: value }) as CaptureCustomer : c);
    const { error } = await supabase
      .from("customers")
      .update({ [field]: value })
      .eq("id", customerId);
    if (error) {
      // rollback
      setCustomer((c) => c ? ({ ...c, [field]: prevValue }) as CaptureCustomer : c);
      throw error;
    }
    const nowFilled = value !== null && value !== undefined && String(value).trim() !== "";
    if (!wasFilled && nowFilled) {
      // log event for XP analytics
      await supabase.from("capture_field_events").insert({
        consultant_id: customer.consultant_id,
        customer_id: customerId,
        field,
        source: "manual",
      });
    }
  }, [customerId, customer]);

  return { customer, loading, filledCount, totalFields, progress, missing, isComplete, updateField, reload: load };
}
