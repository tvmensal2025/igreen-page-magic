import { supabase } from "@/integrations/supabase/client";
import { validateBrazilPhone } from "@/lib/phone";
import { consultantHasConnectedWhatsAppForUi } from "@/lib/consultantWaPhone";

/** Zap conectado = chip vivo OU superadmin no canal principal (não Evolution morta). */
export async function consultantHasWhatsAppConnected(
  consultantId: string,
): Promise<boolean> {
  const id = String(consultantId || "").trim();
  if (!id) return false;
  return consultantHasConnectedWhatsAppForUi(supabase, id);
}

/** Dispara geração de áudios A2 + ligações com a identidade do consultor. */
export async function invokeConsultantIdentityBootstrap(opts: {
  consultantId: string;
  force?: boolean;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string; reason?: string }> {
  const id = String(opts.consultantId || "").trim();
  if (!id) return { ok: false, error: "consultant_id_required" };
  try {
    const { data, error } = await supabase.functions.invoke("consultant-identity-bootstrap", {
      body: { consultant_id: id, force: Boolean(opts.force) },
    });
    if (error) return { ok: false, error: error.message || String(error) };
    const body = (data || {}) as {
      ok?: boolean;
      skipped?: boolean;
      error?: string;
      reason?: string;
    };
    if (body.error) return { ok: false, error: body.error, reason: body.reason };
    return {
      ok: body.ok !== false,
      skipped: Boolean(body.skipped),
      reason: body.reason,
    };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || String(e) };
  }
}

/** Nome + IA + telefone válidos → candidato a bootstrap (ainda exige Zap). */
export function canBootstrapConsultantIdentity(opts: {
  name?: string | null;
  assistantName?: string | null;
  phone?: string | null;
}): boolean {
  const name = String(opts.name || "").trim();
  const ia = String(opts.assistantName || "").trim();
  const phoneV = validateBrazilPhone(String(opts.phone || ""));
  return name.length >= 3 && ia.length >= 2 && phoneV.valid;
}

/**
 * Só gera mídia se o consultor já tem WhatsApp conectado.
 * Usar ao conectar Zap / ao entrar no painel — nunca em massa.
 */
export async function maybeBootstrapConsultantIdentity(opts: {
  consultantId: string;
  force?: boolean;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string; reason?: string }> {
  const id = String(opts.consultantId || "").trim();
  if (!id) return { ok: false, error: "consultant_id_required" };

  const waOk = await consultantHasWhatsAppConnected(id);
  if (!waOk) {
    return { ok: true, skipped: true, reason: "whatsapp_not_connected" };
  }

  const { data: cons } = await supabase
    .from("consultants")
    .select("name, assistant_name, phone")
    .eq("id", id)
    .maybeSingle();

  if (
    !canBootstrapConsultantIdentity({
      name: cons?.name,
      assistantName: cons?.assistant_name,
      phone: cons?.phone,
    })
  ) {
    return { ok: true, skipped: true, reason: "identity_incomplete" };
  }

  return invokeConsultantIdentityBootstrap({
    consultantId: id,
    force: Boolean(opts.force),
  });
}
