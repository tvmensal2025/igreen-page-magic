import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PORTAL_FIELDS, validateForPortal, type ValidationResult } from "@/lib/captacao/portalValidation";
import {
  validateForClub,
  type ClubFieldKey,
  type ClubValidationResult,
} from "@/lib/captacao/clubValidation";
import { resolvePortalWhatsapp, toWhatsappCanonical } from "@/lib/captacao/portalPhone";
import { lookupViaCep } from "@/lib/captacao/viaCep";

/**
 * Lista canônica usada pela ficha + barra de progresso.
 * É a MESMA lista que o portal iGreen exige no POST /customers — não tem
 * mais "RG" nem "Telefone fixo" inventados que sempre ficavam vermelhos.
 * Inclui media_consumo (obrigatório no Portal 2) e ID opcional no final.
 */
const PORTAL_CAPTURE_FIELDS = PORTAL_FIELDS
  // Documentos (uploads) ficam num módulo separado (CaptureDocumentTiles)
  .filter((f) => f.group !== "docs")
  .map((f) => ({ key: f.key, label: f.label } as const));

/** Campo opcional na ficha: sobrescreve idconsultor no Portal 2. */
export const ID_OVERRIDE_FIELD = {
  key: "portal_idconsultor_override" as const,
  label: "ID",
};

export const CAPTURE_FIELDS = [
  ...PORTAL_CAPTURE_FIELDS,
  ID_OVERRIDE_FIELD,
] as const;

export type CaptureFieldKey =
  | typeof PORTAL_FIELDS[number]["key"]
  | typeof ID_OVERRIDE_FIELD.key
  | ClubFieldKey;

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
  media_consumo?: number | null;
  /** Preferência de fatura (bot ask_contaunica). Unificado ⇔ transferir titularidade. */
  contaunica?: boolean | null;
  contaunica_answered?: boolean | null;
  transferir_titularidade?: boolean | null;
  transferir_titularidade_answered?: boolean | null;
  /** Se preenchido, sobrescreve idconsultor no Portal 2. */
  portal_idconsultor_override?: number | null;
  referral_partner_id?: string | null;
  /** Join: parceiro indicador (cli / partner_igreen_id). */
  referral_partners?: {
    nome?: string | null;
    cli?: string | number | null;
    partner_igreen_id?: string | number | null;
  } | null;
  /** Join: consultor dono da página. */
  consultants?: {
    igreen_id?: string | number | null;
    name?: string | null;
  } | null;
  /** Telefone de contato do portal (edição da ficha). phone_whatsapp = chave do chat. */
  portal2_celular_alt?: string | null;
  document_front_url: string | null;
  document_back_url: string | null;
  electricity_bill_photo_url: string | null;
  electricity_boleto_photo_url?: string | null;
  last_inbound_media_url?: string | null;
  last_inbound_media_kind?: string | null;
  last_inbound_media_message_id?: string | null;
  last_inbound_media_at?: string | null;
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
  ocr_review_pending?: "bill" | "doc" | null;
  ocr_review_started_at?: string | null;
  created_at: string;
}

function isFieldFilled(c: CaptureCustomer | null | undefined, key: CaptureFieldKey): boolean {
  if (!c) return false;
  if (key === "phone_whatsapp") return !!resolvePortalWhatsapp(c);
  if (key === "address_complement") {
    const v = c.address_complement;
    return v !== null && v !== undefined && String(v).trim() !== "";
  }
  if (key === "rg") {
    const v = c.rg;
    return v !== null && v !== undefined && String(v).trim().length >= 5;
  }
  const v = (c as any)[key];
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && !v.trim()) return false;
  if (key === "electricity_bill_value" || key === "media_consumo") {
    if (Number(v) <= 0) return false;
  }
  if (key === "portal_idconsultor_override" && Number(v) <= 0) return false;
  return true;
}

/** Mesma regra do worker-portal-2: override > partner_igreen_id > cli > consultor da página. */
export type IdconsultorSource = "override" | "parceiro" | "pagina" | "none";

export function resolveEffectiveIdconsultor(customer: CaptureCustomer | null | undefined): {
  id: number | null;
  source: IdconsultorSource;
  partnerName: string | null;
} {
  if (!customer) return { id: null, source: "none", partnerName: null };
  const overrideRaw = Number(customer.portal_idconsultor_override || 0);
  if (Number.isFinite(overrideRaw) && overrideRaw > 0) {
    return {
      id: overrideRaw,
      source: "override",
      partnerName: customer.referral_partners?.nome ?? null,
    };
  }
  const partner = customer.referral_partners;
  const partnerIgreen = Number(partner?.partner_igreen_id || 0);
  const partnerCli = Number(partner?.cli || 0);
  const partnerId =
    Number.isFinite(partnerIgreen) && partnerIgreen > 0
      ? partnerIgreen
      : (Number.isFinite(partnerCli) && partnerCli > 0 ? partnerCli : 0);
  if (partnerId > 0) {
    return {
      id: partnerId,
      source: "parceiro",
      partnerName: partner?.nome ?? null,
    };
  }
  const dono = Number(customer.consultants?.igreen_id || 0);
  if (Number.isFinite(dono) && dono > 0) {
    return { id: dono, source: "pagina", partnerName: null };
  }
  return { id: null, source: "none", partnerName: null };
}

export function useCaptureSession(customerId: string | null) {
  const [customer, setCustomer] = useState<CaptureCustomer | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!customerId) { setCustomer(null); return; }
    setLoading(true);
    const { data } = await supabase
      .from("customers")
      .select("id, consultant_id, name, cpf, rg, data_nascimento, nome_mae, phone_whatsapp, phone_landline, portal2_celular_alt, phone_contact_confirmed, email, cep, address_street, address_number, address_complement, address_neighborhood, address_city, address_state, distribuidora, numero_instalacao, media_consumo, contaunica, contaunica_answered, transferir_titularidade, transferir_titularidade_answered, portal_idconsultor_override, referral_partner_id, bill_holder_name, doc_holder_name, bill_data_confirmed_at, bill_data_confirmation_by, doc_data_confirmed_at, doc_data_confirmation_by, name_mismatch_flag, name_mismatch_reason, name_mismatch_acknowledged_at, bill_owner_relationship, electricity_bill_value, document_front_url, document_back_url, electricity_bill_photo_url, electricity_boleto_photo_url, last_inbound_media_url, last_inbound_media_kind, last_inbound_media_message_id, last_inbound_media_at, capture_mode, capture_started_at, conversation_step, flow_variant, name_source, bot_paused, do_not_contact, ocr_review_pending, ocr_review_started_at, created_at, referral_partners:referral_partner_id(nome, cli, partner_igreen_id), consultants:consultant_id(igreen_id, name)")
      .eq("id", customerId)
      .maybeSingle();
    setCustomer((data as CaptureCustomer) || null);
    setLoading(false);
  }, [customerId]);

  useEffect(() => { void load(); }, [load]);

  // Anexar do feed/WhatsApp → força reload da ficha (OCR + URLs dos tiles)
  useEffect(() => {
    if (!customerId) return;
    const onDocs = (e: Event) => {
      const id = (e as CustomEvent<{ customerId?: string }>).detail?.customerId;
      if (id && id !== customerId) return;
      void load();
    };
    window.addEventListener("captacao:docs-updated", onDocs as EventListener);
    return () => window.removeEventListener("captacao:docs-updated", onDocs as EventListener);
  }, [customerId, load]);

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

  // Validação canônica do Portal — fonte ÚNICA de verdade pra "X/Y" e
  // "Faltam N". Antes tinha dois contadores (card vs ficha) que divergiam
  // porque o card só olhava presença e a ficha somava inválidos também.
  const validation: ValidationResult = useMemo(() => validateForPortal(customer as any), [customer]);

  // Validação Club — independente; não altera contadores do Portal 2.
  const clubValidation: ClubValidationResult = useMemo(
    () => validateForClub(customer as any),
    [customer],
  );

  const totalFields = validation.totalFields;
  // filledCount = só presença (missing). Inválidos NÃO descontam — senão um
  // único campo torto (ex: email com formato errado, name_mismatch, distrib
  // fora da allow-list) jogava o "X/Y" de 18/18 pra 2/18 mesmo com a ficha
  // toda preenchida.
  const filledCount = Math.max(0, totalFields - validation.missing.length);
  const progress = Math.round((filledCount / totalFields) * 100);

  const clubFilledCount = clubValidation.filledCount;
  const clubTotalFields = clubValidation.totalFields;
  const clubProgress = Math.round((clubFilledCount / Math.max(1, clubTotalFields)) * 100);
  const clubMissing = useMemo(
    () =>
      clubValidation.pendingItems.map((p) =>
        p.kind === "invalid" && p.reason
          ? `${p.label} (${p.reason.slice(0, 60)}${p.reason.length > 60 ? "…" : ""})`
          : p.label,
      ),
    [clubValidation],
  );
  const clubIsComplete = clubValidation.ok && !!customer;

  if (typeof window !== "undefined" && (import.meta as any)?.env?.DEV && customer) {
    // eslint-disable-next-line no-console
    console.debug("[useCaptureSession]", {
      customerId: customer.id,
      filledCount,
      totalFields,
      missing: validation.missing.map((m) => m.key),
      invalid: validation.invalid.map((i) => `${i.field}: ${i.reason}`),
      ok: validation.ok,
    });
  }


  // Lista descritiva pra UI: presença + inválidos no mesmo array, mesma ordem
  // que aparece pro consultor — sem desencontro entre card e sheet.
  const missing = useMemo(
    () =>
      validation.pendingItems.map((p) =>
        p.kind === "invalid" && p.reason ? `${p.label} (${p.reason.slice(0, 60)}${p.reason.length > 60 ? "…" : ""})` : p.label,
      ),
    [validation],
  );

  const isComplete = validation.ok && !!customer;

  const idconsultor = useMemo(() => resolveEffectiveIdconsultor(customer), [customer]);

  const updateField = useCallback(async (field: CaptureFieldKey, value: any) => {
    if (!customerId || !customer) return;
    let nextValue = value;
    // media_consumo: número positivo (kWh)
    if (field === "media_consumo") {
      const n = Number(String(value ?? "").replace(",", "."));
      nextValue = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    }
    // ID iGreen: só dígitos; vazio → NULL (usa consultor da página).
    if (field === "portal_idconsultor_override") {
      const digitsOnly = String(value ?? "").replace(/\D/g, "");
      nextValue = digitsOnly ? Number(digitsOnly) : null;
      if (nextValue !== null && (!Number.isFinite(nextValue) || nextValue <= 0)) {
        nextValue = null;
      }
    }
    // WhatsApp da ficha = telefone do PORTAL, não a chave da conversa.
    // phone_whatsapp tem índice único e identifica o chat — NÃO sobrescrever.
    // Grava em portal2_celular_alt (mesma regra do bot ask_phone / resolvePortalWhatsapp).
    if (field === "phone_whatsapp") {
      const canonical = toWhatsappCanonical(value);
      nextValue = canonical.length >= 12 ? canonical : null;
      const prevAlt = customer.portal2_celular_alt ?? null;
      const wasFilled = isFieldFilled(customer, field);
      setCustomer((c) => c
        ? ({ ...c, portal2_celular_alt: nextValue } as CaptureCustomer)
        : c);
      const { error } = await supabase
        .from("customers")
        .update({ portal2_celular_alt: nextValue } as never)
        .eq("id", customerId);
      if (error) {
        setCustomer((c) => c
          ? ({ ...c, portal2_celular_alt: prevAlt } as CaptureCustomer)
          : c);
        throw error;
      }
      const nowFilled = !!nextValue;
      if (!wasFilled && nowFilled) {
        await supabase.from("capture_field_events").insert({
          consultant_id: customer.consultant_id,
          customer_id: customerId,
          field: "portal2_celular_alt",
          source: "manual",
        });
      }
      return;
    }
    const prevValue = (customer as any)[field];
    const wasFilled = isFieldFilled(customer, field);
    // optimistic
    setCustomer((c) => c ? ({ ...c, [field]: nextValue } as CaptureCustomer) : c);
    const { error } = await supabase
      .from("customers")
      .update({ [field]: nextValue } as never)
      .eq("id", customerId);
    if (error) {
      // rollback
      setCustomer((c) => c ? ({ ...c, [field]: prevValue } as CaptureCustomer) : c);
      throw error;
    }
    const nowFilled = nextValue !== null && nextValue !== undefined && String(nextValue).trim() !== ""
      && (field !== "portal_idconsultor_override" || Number(nextValue) > 0)
      && (field !== "media_consumo" || Number(nextValue) > 0)
      && (field !== "electricity_bill_value" || Number(nextValue) > 0);
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

  /**
   * Preferência de boleto (espelha ask_contaunica do bot).
   * Unificado ⇔ contaunica + transferir_titularidade; separado ⇔ ambos false.
   */
  const updateBoletoPreference = useCallback(async (preference: "unificado" | "separado") => {
    if (!customerId || !customer) return;
    const unificado = preference === "unificado";
    const patch = {
      contaunica: unificado,
      transferir_titularidade: unificado,
      contaunica_answered: true,
      transferir_titularidade_answered: true,
    };
    const prev = {
      contaunica: customer.contaunica ?? null,
      transferir_titularidade: customer.transferir_titularidade ?? null,
      contaunica_answered: customer.contaunica_answered ?? null,
      transferir_titularidade_answered: customer.transferir_titularidade_answered ?? null,
    };
    const wasAnswered = customer.contaunica_answered === true;
    setCustomer((c) => (c ? ({ ...c, ...patch } as CaptureCustomer) : c));
    const { error } = await supabase
      .from("customers")
      .update(patch as never)
      .eq("id", customerId);
    if (error) {
      setCustomer((c) => (c ? ({ ...c, ...prev } as CaptureCustomer) : c));
      throw error;
    }
    if (!wasAnswered) {
      await supabase.from("capture_field_events").insert({
        consultant_id: customer.consultant_id,
        customer_id: customerId,
        field: "boleto_preference",
        source: "manual",
      });
    }
  }, [customerId, customer]);

  /**
   * CEP → ViaCEP → grava rua/bairro/cidade/UF (+ cep).
   * Número da residência permanece manual.
   * Retorna null se CEP inválido / não encontrado.
   */
  const applyCepAutofill = useCallback(async (cepRaw: string) => {
    if (!customerId || !customer) return null;
    const addr = await lookupViaCep(cepRaw);
    if (!addr) return null;

    const patch = {
      cep: addr.cep,
      address_street: addr.address_street || customer.address_street || null,
      address_neighborhood: addr.address_neighborhood || customer.address_neighborhood || null,
      address_city: addr.address_city || customer.address_city || null,
      address_state: addr.address_state || customer.address_state || null,
    };
    const prev = {
      cep: customer.cep ?? null,
      address_street: customer.address_street ?? null,
      address_neighborhood: customer.address_neighborhood ?? null,
      address_city: customer.address_city ?? null,
      address_state: customer.address_state ?? null,
    };

    setCustomer((c) => (c ? ({ ...c, ...patch } as CaptureCustomer) : c));
    const { error } = await supabase
      .from("customers")
      .update(patch as never)
      .eq("id", customerId);
    if (error) {
      setCustomer((c) => (c ? ({ ...c, ...prev } as CaptureCustomer) : c));
      throw error;
    }

    const cepWasEmpty = !isFieldFilled(customer, "cep");
    if (cepWasEmpty) {
      await supabase.from("capture_field_events").insert({
        consultant_id: customer.consultant_id,
        customer_id: customerId,
        field: "cep",
        source: "viacep",
      });
    }
    return addr;
  }, [customerId, customer]);

  return {
    customer,
    loading,
    filledCount,
    totalFields,
    progress,
    missing,
    isComplete,
    validation,
    clubValidation,
    clubFilledCount,
    clubTotalFields,
    clubProgress,
    clubMissing,
    clubIsComplete,
    idconsultor,
    updateField,
    updateBoletoPreference,
    applyCepAutofill,
    reload: load,
  };
}
