// lead-intake
// ───────────
// Porta ÚNICA de entrada de leads via HTTP (landing pages, formulários
// próprios). Recebe o lead + texto de consentimento, resolve o consultor
// dono pela licença/slug, e grava via lead-ingest (dedup + consent + PF/PJ).
//
// Público (verify_jwt=false): a landing não tem sessão de usuário. A posse é
// resolvida pelo identificador do consultor enviado no corpo (license) e
// validado contra a tabela consultants. Sem isso, rejeita.
//
// NÃO dispara mensagem aqui — só captura. O envio é decisão do consultor
// depois (via leads-to-campaign). Isso respeita opt-in e anti-ban.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { ingestLead, type LeadChannel, type PersonType } from "../_shared/captation/lead-ingest.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface IntakeBody {
  /** Licença do consultor dono (resolve consultant_id). */
  license?: string;
  /** Alternativa: consultant_id direto (uuid). */
  consultant_id?: string;
  channel?: LeadChannel;
  person_type?: PersonType;
  full_name?: string;
  phone?: string;
  email?: string;
  city?: string;
  uf?: string;
  product_interest?: string;
  company_name?: string;
  cnpj?: string;
  pj_data?: Record<string, unknown>;
  /** Texto exato do opt-in que o lead aceitou (obrigatório p/ base legal). */
  consent_text?: string;
  consent_source?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: IntakeBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  // Consentimento é obrigatório nesta porta (landing = opt-in explícito).
  if (!body.consent_text || body.consent_text.trim().length < 3) {
    return json(400, { error: "consent_required" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Resolve o consultor dono.
  let consultantId: string | null = null;
  if (body.consultant_id && UUID_RE.test(body.consultant_id)) {
    const { data } = await supabase
      .from("consultants")
      .select("id")
      .eq("id", body.consultant_id)
      .maybeSingle();
    consultantId = data?.id ?? null;
  } else if (body.license) {
    const { data } = await supabase
      .from("consultants")
      .select("id")
      .eq("license", body.license)
      .maybeSingle();
    consultantId = data?.id ?? null;
  }

  if (!consultantId) {
    return json(400, { error: "consultant_not_found" });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const result = await ingestLead(supabase, {
    consultantId,
    channel: body.channel ?? "landing",
    personType: body.person_type,
    fullName: body.full_name,
    phone: body.phone,
    email: body.email,
    city: body.city,
    uf: body.uf,
    productInterest: body.product_interest,
    companyName: body.company_name,
    cnpj: body.cnpj,
    pjData: body.pj_data,
    consentText: body.consent_text,
    consentSource: body.consent_source,
    consentIp: ip,
    consentUserAgent: userAgent,
    rawPayload: { ...body, consent_text: undefined },
  });

  if (!result.ok) {
    return json(422, { ok: false, reason: result.reason });
  }
  return json(200, { ok: true, deduped: result.deduped ?? false });
});
