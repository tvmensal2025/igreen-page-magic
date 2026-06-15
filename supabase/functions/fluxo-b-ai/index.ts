// Fluxo B IA — entrypoint HTTP do simulador admin "Testar lead simulado".
//
// POST /functions/v1/fluxo-b-ai
// body: { customerId: string, consultantId: string, inboundText?: string,
//         inboundKind?: "text"|"media"|"button_click",
//         inboundMediaKind?: "image"|"audio"|"document",
//         dryRun?: boolean }
//
// dryRun=true → não persiste nada e não envia para o cliente; só retorna
// o texto que a IA produziria. Usado pelo painel admin do Fluxo B.

import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { processarTurnoFluxoB } from "../_shared/fluxo-b-ia/agent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const customerId = String(body?.customerId || "").trim();
  const consultantId = String(body?.consultantId || "").trim();
  if (!customerId || !consultantId) {
    return json({ error: "customerId and consultantId required" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const dryRun = body?.dryRun !== false; // default TRUE no simulador

  const captured: string[] = [];
  const result = await processarTurnoFluxoB({
    supabase,
    customerId,
    consultantId,
    inboundText: body?.inboundText ?? null,
    inboundKind: body?.inboundKind ?? "text",
    inboundMediaKind: body?.inboundMediaKind ?? null,
    inboundMessageId: body?.inboundMessageId ?? null,
    telefone: body?.telefone ?? null,
    enviarTexto: async (texto) => {
      captured.push(texto);
      return true;
    },
    dryRun,
  }).catch((e: any) => {
    console.error("[fluxo-b-ai] processarTurno error:", e?.message);
    return null;
  });

  if (!result) return json({ ok: false, error: "processing_failed" }, 500);

  return json({
    ok: true,
    respondeu: result.respondeu,
    texto: result.texto,
    acoes: result.acoes,
    rag: result.rag,
    modelUsed: result.modelUsed,
    sent: dryRun ? captured : undefined,
  });
});
