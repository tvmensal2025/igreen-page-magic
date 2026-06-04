import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createWhatsAppSender } from "../_shared/whatsapp-api.ts";
import { checkSendQuota, registerSend } from "../_shared/anti-ban.ts";

interface Body {
  phone: string;
  mediaUrl: string;
  caption?: string;
  mediatype?: "video" | "image" | "document";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evolutionUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");

    if (!evolutionUrl || !evolutionKey) {
      return new Response(JSON.stringify({ error: "Evolution não configurada" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate user
    const supabaseAuth = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const consultantId = userData.user.id;

    // Validate body
    const body: Body = await req.json();
    const phone = String(body.phone || "").replace(/\D/g, "");
    const mediaUrl = String(body.mediaUrl || "");
    const caption = String(body.caption || "").slice(0, 500);
    const mediatype = (body.mediatype === "image" || body.mediatype === "document" ? body.mediatype : "video") as
      | "video"
      | "image"
      | "document";

    if (phone.length < 10 || phone.length > 13) {
      return new Response(JSON.stringify({ error: "Telefone inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!/^https?:\/\//.test(mediaUrl)) {
      return new Response(JSON.stringify({ error: "URL de mídia inválida" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Lookup instance
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: inst, error: instErr } = await admin
      .from("whatsapp_instances")
      .select("instance_name")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (instErr || !inst?.instance_name) {
      return new Response(JSON.stringify({ error: "Instância WhatsApp não encontrada — conecte primeiro" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sender = createWhatsAppSender(evolutionUrl, evolutionKey, inst.instance_name);
    const ok = await sender.sendMedia(phone, mediaUrl, caption, mediatype);

    if (!ok) {
      return new Response(JSON.stringify({ error: "Evolution recusou o envio" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("admin-send-material error:", e);
    return new Response(JSON.stringify({ error: e?.message || "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
