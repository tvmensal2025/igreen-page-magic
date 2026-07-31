// One-shot helper: recebe { filename, content_base64, content_type } e sobe no
// bucket público `simulator-uploads` usando service role. Retorna URL pública.
// Usado pelo simulador E2E para hospedar PDFs/imagens reais sem mexer em RLS.
//
// Auth: service_role / x-service-secret / JWT admin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

    if (!isServiceRoleAuth(req)) {
      const caller = await resolveCaller(req, svc as any);
      if (caller instanceof Response) return caller;
      if (caller.mode === "jwt" && !caller.isAdmin) {
        return json({ error: "forbidden" }, 403);
      }
    }

    const body = await req.json();
    const filename = String(body?.filename || `upload-${Date.now()}.bin`).replace(/[^a-zA-Z0-9._-]/g, "_");
    const contentType = String(body?.content_type || "application/octet-stream");
    const b64 = String(body?.content_base64 || "");
    if (!b64) return json({ error: "missing_content_base64" }, 400);

    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const path = `e2e/${Date.now()}_${filename}`;
    const { error: upErr } = await svc.storage.from("simulator-uploads").upload(path, bytes, {
      contentType, upsert: true,
    });
    if (upErr) return json({ error: "upload_failed", detail: upErr.message }, 500);

    const url = `${SUPABASE_URL}/storage/v1/object/public/simulator-uploads/${path}`;
    return json({ url, path });
  } catch (e) {
    return json({ error: "internal", detail: String((e as Error)?.message || e) }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
