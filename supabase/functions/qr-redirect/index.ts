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
import {
  normalizeWaPhoneDigits,
  resolveConsultantConnectedWaPhone,
} from "../_shared/consultant-wa-phone.ts";
import {
  isSuperAdminConsultant,
  loadChannelEnv,
} from "../_shared/attendance-channel-env.ts";

const SITE_URL = "https://igreen.institutodossonhos.com.br";
const QR_REDIRECT_VERSION = "2026-08-05-ctwa-safe-phrase-v6";
const DEFAULT_MESSAGE =
  "Oi! 👋 Vi sobre a iGreen Energy e quero saber como economizar na minha conta de luz.";
const QR_PHRASE_MAX = 600;

function tidyPhrase(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePhrase(value: string): string {
  return tidyPhrase(value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^\w\s]/g, " "));
}

/** Teto usado só para montar a frase PADRÃO (espelho de `_shared/qr-phrase.ts`). */
const QR_DEFAULT_PHRASE_MAX = 90;

/**
 * Frase padrão local — espelho de `buildDefaultQrPhrase` em `_shared/qr-phrase.ts`.
 * Mantém a keyword INTEIRA (é ela que atribui o lead ao parceiro no webhook).
 *
 * ⚠️ Nenhuma variante pode casar com `matchesMetaCtwaPhrase` (autofill Meta):
 * a frase antiga usava "quero saber mais", que é frase-âncora de CTWA, e por
 * isso o webhook tratava o lead do QR do parceiro como lead Meta e pulava a
 * atribuição — o parceiro nunca recebia o lead.
 */
function buildDefaultPhrase(keyword: string): string {
  const kw = tidyPhrase(keyword ?? "");
  if (!kw) return "Oi! Quero garantir meu desconto na energia.";
  const withKw = tidyPhrase(`Oi! Vim pelo ${kw} e quero garantir meu desconto na energia.`);
  if (withKw.length <= QR_DEFAULT_PHRASE_MAX) return withKw;
  const short = tidyPhrase(`Oi! Vim pelo ${kw}, quero meu desconto na energia.`);
  if (short.length <= QR_DEFAULT_PHRASE_MAX) return short;
  const minimal = tidyPhrase(`Oi! Vim pelo ${kw}.`);
  if (minimal.length <= QR_DEFAULT_PHRASE_MAX) return minimal;
  const prefix = "Oi! Vim pelo ";
  const budget = Math.max(0, QR_DEFAULT_PHRASE_MAX - prefix.length - 1);
  return tidyPhrase(`${prefix}${kw.slice(0, budget)}`);
}

/**
 * Resolver local para o deploy não depender de bundle compartilhado em cache.
 *
 * ATRIBUIÇÃO = SOMENTE KEYWORD (decisão 2026-08-03). O marcador `#R{short_code}`
 * foi removido do texto: cada consultor/parceiro atende em instância própria
 * (Whapi do superadmin ou Evolution do consultor), então a keyword não colide
 * entre canais. O webhook ainda entende `#R` de QR antigo já impresso.
 */
function resolveQrMessage(
  qrPhrase: string | null | undefined,
  keyword: string | null | undefined,
): string {
  const custom = tidyPhrase(qrPhrase ?? "");
  const kw = tidyPhrase(keyword ?? "");
  let message = custom
    ? tidyPhrase(custom.slice(0, QR_PHRASE_MAX))
    : buildDefaultPhrase(kw);
  if (kw && !normalizePhrase(message).includes(normalizePhrase(kw))) {
    const withKeyword = tidyPhrase(`${message} ${kw}`);
    if (withKeyword.length <= QR_PHRASE_MAX) message = withKeyword;
  }
  return message;
}

/**
 * Banner próprio já chega ao WhatsApp do consultor correto pelo `igreen_id` do
 * link vivo. Portanto, a frase salva deve aparecer exatamente como foi escrita:
 * o código/keyword do local serve para telemetria do clique, não para poluir a
 * primeira mensagem do lead. Parceiros continuam usando apenas a keyword.
 */
function resolveConsultantBannerMessage(
  spotPhrase: string | null | undefined,
  consultantDefaultPhrase: string | null | undefined,
): string {
  const custom = tidyPhrase(spotPhrase ?? "");
  if (custom) return tidyPhrase(custom.slice(0, QR_PHRASE_MAX));
  const fallback = tidyPhrase(consultantDefaultPhrase ?? "");
  return fallback
    ? tidyPhrase(fallback.slice(0, QR_PHRASE_MAX))
    : DEFAULT_MESSAGE;
}

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
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
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
      // Telemetria qr_scan fica DEPOIS de resolver parceiro/spot (event_target fino).
    }

    const normalizedPhone = normalizeWaPhoneDigits(phone);
    const phoneValid = /^\d{12,13}$/.test(normalizedPhone);

    if (!normalizedPhone || !phoneValid) {
      if (consultant?.id) {
        try {
          const { error: brokenErr } = await supabase.from("page_events").insert({
            consultant_id: consultant.id,
            event_type: "qr_broken",
            event_target: spotParam
              ? `banner_spot:${spotParam}`
              : igreenIdParam
              ? "banner_root"
              : "panfleto",
            page_type: "client",
          });
          if (brokenErr) {
            console.warn("[qr-redirect] qr_broken insert failed", brokenErr.message);
          }
        } catch (e) {
          console.warn("[qr-redirect] qr_broken insert exception", e);
        }
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

    // Tipo NOMEADO de propósito: com `let partner: {...} | null = null`, o
    // `data as typeof partner` era resolvido como `as null` (o CFA já tinha
    // narrowado `partner` para null), o que apagava a tipagem e deixava 20+
    // erros `Property ... does not exist on type 'never'` neste arquivo — em
    // pleno caminho do QR de parceiro.
    type PartnerRow = {
      id?: string;
      nome: string;
      keywords: unknown;
      qr_phrase: string | null;
      consultant_id: string;
      is_active: boolean;
      short_code: string | null;
    };
    let partner: PartnerRow | null = null;

    let eventTarget = "panfleto";
    let partnerSpotCode: string | null = null;

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
          const custom = String(spot.phrase || "").trim();
          message = resolveConsultantBannerMessage(
            custom || null,
            consultant.banner_default_phrase,
          );
          liveBannerResolved = true;
          eventTarget = `banner_spot:${spotParam}`;
        } else {
          // Spot inexistente: não quebra nem expõe o código interno no texto.
          message = resolveConsultantBannerMessage(
            null,
            consultant.banner_default_phrase,
          );
          liveBannerResolved = true;
          eventTarget = `banner_spot:${spotParam}`;
        }
      } else {
        // Raiz /{ini}/{id}: frase default editável no banco.
        const def = String(consultant.banner_default_phrase || "").trim();
        message = def || DEFAULT_MESSAGE;
        liveBannerResolved = true;
        eventTarget = "banner_root";
      }
    }

    if (consultant?.id && !liveBannerResolved) {
      const baseSelect =
        "id, nome, keywords, qr_phrase, consultant_id, is_active, short_code";

      if (partnerId) {
        const { data } = await supabase
          .from("referral_partners")
          .select(baseSelect)
          .eq("id", partnerId)
          .maybeSingle();
        if (data && data.consultant_id === consultant.id && data.is_active) {
          partner = data as PartnerRow;
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
          if (data) partner = data as PartnerRow;
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
          if (data) partner = data as PartnerRow;
        }
      }
    }

    if (partner) {
      const short = String(partner.short_code || codeParam || "").trim();
      eventTarget = short ? `partner:${short}` : "partner";

      // Local nomeado do parceiro: ?s=posto-shell (ou keyword casando spot).
      // Tipo nomeado pelo mesmo motivo de `PartnerRow` (ver comentário acima).
      type PartnerSpotRow = {
        code: string;
        keyword: string;
        phrase: string | null;
      };
      let partnerSpot: PartnerSpotRow | null = null;
      if (partner.id && spotParam) {
        const { data: spot } = await supabase
          .from("referral_partner_banner_spots")
          .select("code, keyword, phrase")
          .eq("partner_id", partner.id)
          .eq("code", spotParam)
          .maybeSingle();
        if (spot) partnerSpot = spot as PartnerSpotRow;
      }
      if (!partnerSpot && partner.id && keywordParam) {
        const kw = decodeURIComponent(keywordParam).trim();
        if (kw) {
          const { data: spot } = await supabase
            .from("referral_partner_banner_spots")
            .select("code, keyword, phrase")
            .eq("partner_id", partner.id)
            .eq("keyword", kw)
            .eq("is_active", true)
            .maybeSingle();
          if (spot) partnerSpot = spot as PartnerSpotRow;
        }
      }

      if (partnerSpot) {
        partnerSpotCode = partnerSpot.code;
        eventTarget = short
          ? `partner:${short}:${partnerSpot.code}`
          : `partner_spot:${partnerSpot.code}`;
        const kw = String(partnerSpot.keyword || "").trim();
        const custom = String(partnerSpot.phrase || "").trim();
        message = resolveQrMessage(
          custom || (msgParam ?? "").trim() || partner.qr_phrase,
          kw || keywordParam || partner.nome,
        );
      } else {
        const fromQuery = (keywordParam ?? "").trim();
        const rawKw = Array.isArray(partner.keywords)
          ? (partner.keywords[0] ?? "")
          : "";
        const fallbackKw =
          typeof rawKw === "string" && rawKw.trim()
            ? rawKw
            : (partner.nome ?? "");
        const keyword = fromQuery || fallbackKw;
        // O banco é a fonte viva e sempre vence. `msg` fica apenas como
        // compatibilidade para QR antigo quando ainda não existe frase salva.
        const phraseSource =
          (partner.qr_phrase as string | null) || (msgParam ?? "").trim();
        message = resolveQrMessage(phraseSource, keyword);
      }
    }

    // Telemetria fina (consultor Geral / spot / parceiro / parceiro+local).
    if (consultant?.id) {
      try {
        const { error: scanErr } = await supabase.from("page_events").insert({
          consultant_id: consultant.id,
          event_type: "qr_scan",
          event_target: eventTarget,
          page_type: "client",
        });
        if (scanErr) {
          console.warn("[qr-redirect] qr_scan insert failed", scanErr.message);
        }
      } catch (e) {
        console.warn("[qr-redirect] qr_scan insert exception", e);
      }
    }

    if (wantsJson) {
      return jsonResponse({
        phone: normalizedPhone,
        message,
        live: liveBannerResolved,
        spot: spotParam || partnerSpotCode || null,
        event_target: eventTarget,
        partner: partner?.short_code || null,
        // Diagnóstico: confirma que a frase salva no banco chegou ao runtime.
        phrase_db: partner?.qr_phrase ?? null,
        phrase_limit: 600,
        version: QR_REDIRECT_VERSION,

      });
    }
    return redirectTo(buildWhatsappUrl(normalizedPhone, message));
  } catch (e) {
    console.error("[qr-redirect] error:", e);
    return redirectTo(SITE_URL);
  }
});
