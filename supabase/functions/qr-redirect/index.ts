// QR Redirect: redireciona QR impresso para o WhatsApp atual da instância do consultor
// Público (sem JWT). Sempre retorna um redirect — nunca quebra os panfletos.
//
// Formas suportadas:
//   1) Parceiro legado: /r/{licenca|igreen_id}/{short_code}  (?l=&c=)
//   2) Banner VIVO do consultor: /{iniciais}/{igreen_id}[/{spot}]
//      → bounce manda ?ig={igreen_id}&s={spot}
//      Frase/keyword vêm do banco (consultant_banner_spots / banner_default_phrase)
//      — dá para editar sem reimprimir o papel.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveQrMessage } from "../_shared/qr-phrase.ts";
import {
  normalizeWaPhoneDigits,
  resolveConsultantConnectedWaPhone,
} from "../_shared/consultant-wa-phone.ts";
import {
  isSuperAdminConsultant,
  loadChannelEnv,
} from "../_shared/attendance-channel-env.ts";

const SITE_URL = "https://igreen.institutodossonhos.com.br";
const DEFAULT_MESSAGE =
  "Oi! 👋 Vi sobre a iGreen Energy e quero saber como economizar na minha conta de luz.";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function buildWhatsappUrl(phone: string, message: string) {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

function redirectTo(url: string) {
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: url,
      "Cache-Control": "public, max-age=30",
    },
  });
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const wantsJson = url.searchParams.get("json") === "1";

    let codeParam = url.searchParams.get("c");
    let keywordParam = url.searchParams.get("k");
    let licenca = url.searchParams.get("l") || url.searchParams.get("licenca");
    // Banner vivo: ?ig=130392&s=posto-shell
    let igreenIdParam = (url.searchParams.get("ig") || "").replace(/\D/g, "");
    let spotParam = (url.searchParams.get("s") || "").trim().toLowerCase();

    if (!licenca && !igreenIdParam) {
      const parts = url.pathname.split("/").filter(Boolean);
      const rIdx = parts.indexOf("r");
      const qrIdx = parts.indexOf("qr-redirect");
      if (rIdx !== -1 && parts[rIdx + 1]) {
        licenca = parts[rIdx + 1] || null;
        if (!codeParam && parts[rIdx + 2]) codeParam = parts[rIdx + 2];
      } else if (qrIdx !== -1 && parts[qrIdx + 1]) {
        licenca = parts[qrIdx + 1] || null;
        if (!codeParam && parts[qrIdx + 2]) codeParam = parts[qrIdx + 2];
      } else if (
        parts.length >= 2 &&
        /^[a-z]{2,8}$/i.test(parts[0] || "") &&
        /^\d{3,}$/.test(parts[1] || "")
      ) {
        // /{iniciais}/{igreen_id}/{spot?}
        igreenIdParam = parts[1];
        if (parts[2]) spotParam = parts[2].toLowerCase();
      } else {
        licenca = parts[parts.length - 1] || null;
        if (licenca === "qr-redirect") licenca = null;
      }
    }

    const partnerId = url.searchParams.get("p");
    const msgParam = url.searchParams.get("msg");

    if (!licenca && !igreenIdParam) {
      if (wantsJson) return jsonResponse({ error: "missing_license" });
      return redirectTo(SITE_URL);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    type ConsultantRow = {
      id: string;
      phone: string | null;
      banner_default_phrase: string | null;
      banner_keywords: string[] | null;
    };

    let consultant: ConsultantRow | null = null;

    if (igreenIdParam) {
      const { data } = await supabase
        .from("consultants")
        .select("id, phone, banner_default_phrase, banner_keywords")
        .eq("igreen_id", igreenIdParam)
        .maybeSingle();
      if (data?.id) consultant = data as ConsultantRow;
    }

    if (!consultant && licenca) {
      const { data } = await supabase
        .from("consultants")
        .select("id, phone, banner_default_phrase, banner_keywords")
        .eq("license", licenca)
        .maybeSingle();
      if (data?.id) consultant = data as ConsultantRow;
    }

    if (!consultant && licenca && /^\d+$/.test(licenca)) {
      const { data } = await supabase
        .from("consultants")
        .select("id, phone, banner_default_phrase, banner_keywords")
        .eq("igreen_id", licenca)
        .maybeSingle();
      if (data?.id) consultant = data as ConsultantRow;
    }

    let phone: string | null = null;

    if (consultant?.id) {
      // Chip vivo do canal real (Evolution saudável / Whapi do superadmin).
      // NÃO usar connected_phone de needs_reconnect — bug Silvia (chip morto).
      const channelEnv = await loadChannelEnv(supabase);
      const channelKind = isSuperAdminConsultant(
          consultant.id,
          channelEnv.superadminConsultantId,
        )
        ? "whapi"
        : undefined;
      phone =
        (await resolveConsultantConnectedWaPhone(supabase, consultant.id, {
          channelKind,
          // Evolution: sem chip saudável → fallback consultants.phone; nunca Whapi compartilhado.
          allowSharedWhapiFallback: channelKind === "whapi",
        })) || null;

      supabase
        .from("page_events")
        .insert({
          consultant_id: consultant.id,
          event_type: "qr_scan",
          event_target: spotParam
            ? `banner_spot:${spotParam}`
            : igreenIdParam
            ? "banner_root"
            : "panfleto",
          page_type: "client",
        })
        .then(() => {});
    }

    const normalizedPhone = normalizeWaPhoneDigits(phone);
    const phoneValid = /^\d{12,13}$/.test(normalizedPhone);

    if (!normalizedPhone || !phoneValid) {
      if (consultant?.id) {
        supabase
          .from("page_events")
          .insert({
            consultant_id: consultant.id,
            event_type: "qr_broken",
            event_target: spotParam
              ? `banner_spot:${spotParam}`
              : igreenIdParam
              ? "banner_root"
              : "panfleto",
            page_type: "client",
          })
          .then(() => {});
        console.warn("[qr-redirect] phone_invalid", {
          consultant_id: consultant.id,
          phone_raw: phone,
          phone_digits: normalizedPhone,
        });
      }
      if (wantsJson) return jsonResponse({ error: "no_phone" });
      const ref = igreenIdParam || licenca || "";
      const fallback = /^\d+$/.test(ref)
        ? `${SITE_URL}?qr_error=phone_missing`
        : `${SITE_URL}/${ref}?qr_error=phone_missing`;
      return redirectTo(fallback);
    }

    let message = msgParam || DEFAULT_MESSAGE;

    let partner: {
      nome: string;
      keywords: unknown;
      qr_phrase: string | null;
      consultant_id: string;
      is_active: boolean;
      short_code: string | null;
    } | null = null;

    // Banner VIVO do consultor (sem parceiro): frase do spot / default no banco.
    let liveBannerResolved = false;
    if (consultant?.id && igreenIdParam && !partnerId && !codeParam) {
      if (spotParam) {
        const { data: spot } = await supabase
          .from("consultant_banner_spots")
          .select("keyword, phrase, is_active")
          .eq("consultant_id", consultant.id)
          .eq("code", spotParam)
          .maybeSingle();
        if (spot) {
          const kw = String(spot.keyword || "").trim();
          const custom = String(spot.phrase || "").trim();
          message = resolveQrMessage(custom || null, kw || spotParam, null);
          liveBannerResolved = true;
        } else {
          // Spot inexistente: não quebra — frase padrão + código no texto.
          message = resolveQrMessage(
            consultant.banner_default_phrase,
            spotParam,
            null,
          );
          liveBannerResolved = true;
        }
      } else {
        // Raiz /{ini}/{id}: frase default editável no banco.
        const def = String(consultant.banner_default_phrase || "").trim();
        message = def || DEFAULT_MESSAGE;
        liveBannerResolved = true;
      }
    }

    if (consultant?.id && !liveBannerResolved) {
      const baseSelect =
        "nome, keywords, qr_phrase, consultant_id, is_active, short_code";

      if (partnerId) {
        const { data } = await supabase
          .from("referral_partners")
          .select(baseSelect)
          .eq("id", partnerId)
          .maybeSingle();
        if (data && data.consultant_id === consultant.id && data.is_active) {
          partner = data as typeof partner;
        }
      }

      if (!partner && codeParam) {
        const code = decodeURIComponent(codeParam).trim();
        if (code) {
          const { data } = await supabase
            .from("referral_partners")
            .select(baseSelect)
            .eq("consultant_id", consultant.id)
            .eq("is_active", true)
            .eq("short_code", code)
            .limit(1)
            .maybeSingle();
          if (data) partner = data as typeof partner;
        }
      }

      if (!partner && keywordParam) {
        const kw = decodeURIComponent(keywordParam).trim();
        if (kw) {
          const { data } = await supabase
            .from("referral_partners")
            .select(baseSelect)
            .eq("consultant_id", consultant.id)
            .eq("is_active", true)
            .contains("keywords", [kw])
            .limit(1)
            .maybeSingle();
          if (data) partner = data as typeof partner;
        }
      }
    }

    if (partner) {
      const fromQuery = (keywordParam ?? "").trim();
      const rawKw = Array.isArray(partner.keywords)
        ? (partner.keywords[0] ?? "")
        : "";
      const fallbackKw =
        typeof rawKw === "string" && rawKw.trim()
          ? rawKw
          : (partner.nome ?? "");
      const keyword = fromQuery || fallbackKw;
      const phraseSource =
        (msgParam ?? "").trim() || (partner.qr_phrase as string | null);
      message = resolveQrMessage(phraseSource, keyword, partner.short_code);
    }

    if (wantsJson) {
      return jsonResponse({
        phone: normalizedPhone,
        message,
        live: liveBannerResolved,
        spot: spotParam || null,
      });
    }
    return redirectTo(buildWhatsappUrl(normalizedPhone, message));
  } catch (e) {
    console.error("[qr-redirect] error:", e);
    return redirectTo(SITE_URL);
  }
});
