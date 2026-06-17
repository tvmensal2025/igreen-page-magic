/**
 * ensure-tts-bucket — Garante que o bucket público `tts-cache` exista.
 * Pode ser chamado sem autenticação. Idempotente.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, key);

  try {
    const { data: buckets } = await admin.storage.listBuckets();
    const exists = buckets?.some((b) => b.id === "tts-cache");
    if (!exists) {
      const { error } = await admin.storage.createBucket("tts-cache", {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/webm"],
      });
      if (error && !String(error.message).toLowerCase().includes("already")) {
        throw error;
      }
    } else {
      await admin.storage.updateBucket("tts-cache", {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/webm"],
      });
    }
    return new Response(JSON.stringify({ ok: true, created: !exists }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
