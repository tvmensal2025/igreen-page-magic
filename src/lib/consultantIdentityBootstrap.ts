import { supabase } from "@/integrations/supabase/client";
import { consultantHasConnectedWhatsAppForUi } from "@/lib/consultantWaPhone";

/** Zap conectado = chip vivo OU superadmin no canal principal (não Evolution morta). */
export async function consultantHasWhatsAppConnected(
  consultantId: string,
): Promise<boolean> {
  const id = String(consultantId || "").trim();
  if (!id) return false;
  return consultantHasConnectedWhatsAppForUi(supabase, id);
}

function extractInvokeErrorCode(
  data: unknown,
  error: { message?: string; context?: unknown } | null,
): string | null {
  const fromData = (data as { error?: string } | null)?.error;
  if (fromData) return String(fromData);

  const ctx = error?.context as
    | { json?: () => Promise<unknown>; body?: unknown }
    | Response
    | undefined;
  if (ctx && typeof (ctx as Response).json === "function") {
    // Response assíncrona — caller já deve ter lido; aqui só body sincrono se existir
  }
  const body = (error as { context?: { body?: unknown } } | null)?.context?.body;
  if (body && typeof body === "object" && body !== null && "error" in body) {
    return String((body as { error: unknown }).error || "") || null;
  }
  return null;
}

/** Dispara geração de áudios A2 + ligações com a identidade do consultor. */
export async function invokeConsultantIdentityBootstrap(opts: {
  consultantId: string;
  force?: boolean;
}): Promise<{
  ok: boolean;
  skipped?: boolean;
  incomplete?: boolean;
  error?: string;
  reason?: string;
}> {
  const id = String(opts.consultantId || "").trim();
  if (!id) return { ok: false, error: "consultant_id_required" };
  try {
    const { data, error } = await supabase.functions.invoke("consultant-identity-bootstrap", {
      body: { consultant_id: id, force: Boolean(opts.force) },
    });

    // supabase-js: non-2xx seta `error` e às vezes ainda traz o JSON em `data`.
    let body = (data || {}) as {
      ok?: boolean;
      skipped?: boolean;
      incomplete?: boolean;
      error?: string;
      reason?: string;
      a2_ok?: number;
      call_ok?: number;
    };

    if (error && !body.error) {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const parsed = (await ctx.json()) as typeof body;
          if (parsed && typeof parsed === "object") body = { ...body, ...parsed };
        } catch {
          /* ignore */
        }
      }
    }

    if (error && !body.error) {
      const code = extractInvokeErrorCode(data, error);
      return {
        ok: false,
        error: code || error.message || String(error),
      };
    }
    if (body.error) return { ok: false, error: body.error, reason: body.reason };
    if (body.incomplete) {
      return {
        ok: false,
        incomplete: true,
        error: "media_incomplete",
        reason: `Alguns áudios falharam (${body.a2_ok ?? 0}/2 boas-vindas, ${body.call_ok ?? 0}/11 ligações). Tente Gerar minha identidade de novo.`,
      };
    }
    return {
      ok: body.ok !== false,
      skipped: Boolean(body.skipped),
      reason: body.reason,
    };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || String(e) };
  }
}

/** Nome + IA + consultor/consultora → gera áudios (WhatsApp/telefone não bloqueiam). */
export function canBootstrapConsultantIdentity(opts: {
  name?: string | null;
  assistantName?: string | null;
  gender?: string | null;
}): boolean {
  const name = String(opts.name || "").trim();
  const ia = String(opts.assistantName || "").trim();
  const gender = String(opts.gender || "").trim();
  return (
    name.length >= 3 &&
    ia.length >= 2 &&
    (gender === "consultor" || gender === "consultora")
  );
}

/**
 * Gera mídia assim que nome + IA + gênero estão prontos.
 * WhatsApp conectado não é pré-requisito (só envio operacional).
 * Se o fingerprint já existir mas faltar clip (falha antiga), força regenerar.
 */
export async function maybeBootstrapConsultantIdentity(opts: {
  consultantId: string;
  force?: boolean;
}): Promise<{ ok: boolean; skipped?: boolean; incomplete?: boolean; error?: string; reason?: string }> {
  const id = String(opts.consultantId || "").trim();
  if (!id) return { ok: false, error: "consultant_id_required" };

  const { data: cons } = await supabase
    .from("consultants")
    .select("name, assistant_name, gender")
    .eq("id", id)
    .maybeSingle();

  if (
    !canBootstrapConsultantIdentity({
      name: cons?.name,
      assistantName: cons?.assistant_name,
      gender: cons?.gender,
    })
  ) {
    return { ok: true, skipped: true, reason: "prerequisites_incomplete" };
  }

  let force = Boolean(opts.force);
  if (!force) {
    const { loadConsultantIdentityStatus } = await import("@/lib/consultantIdentityReadiness");
    const status = await loadConsultantIdentityStatus(id);
    if (status && status.canGenerate && !status.ready) {
      // Só força se ainda faltam áudios auto-gerados (não por telefone/Zap).
      const pendingAudio = status.steps.some((s) => s.autoGenerated && !s.done);
      if (pendingAudio) force = true;
    }
  }

  return invokeConsultantIdentityBootstrap({
    consultantId: id,
    force,
  });
}
