// QR Redirect: redireciona QR impresso para o WhatsApp atual da instância do consultor
// Público (sem JWT). Recebe ?l={licenca}. Sempre retorna um redirect — nunca quebra os panfletos.
//
// PARCEIRO (?p={partnerId}): quando presente, busca o parceiro indicador, monta
// a frase curta com a keyword (resolveQrMessage) e usa essa frase no wa.me. Isso
// permite um LINK CURTO (só ?l e ?p na URL) que abre o WhatsApp já com a frase
// completa — sem carregar o texto gigante na URL que o consultor compartilha.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveQrMessage } from "../_shared/qr-phrase.ts";

const SITE_URL = "https://igreen.institutodossonhos.com.br";
const DEFAULT_MESSAGE = "Oi! 👋 Vi sobre a iGreen Energy e quero saber como economizar na minha conta de luz.";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
      "Cache-Control": "public, max-age=60",
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
    // ?json=1 → devolve { phone, message } sem redirect (usado pela página
    // intermediária no SPA que mostra os botões "WhatsApp" e "WhatsApp Business").
    const wantsJson = url.searchParams.get("json") === "1";


    // Identificadores do parceiro no link curto:
    //   • code  → short_code numérico do parceiro (forma atual: /r/{licenca}/{code}
    //             ou ?c={code}). Não expõe a keyword pessoal.
    //   • ?k    → keyword (compatibilidade com links antigos que usavam a palavra
    //             no path/query). Continua funcionando, mas é o fallback.
    let codeParam = url.searchParams.get("c");
    let keywordParam = url.searchParams.get("k");

    // Aceita ?l=LICENCA, path /functions/v1/qr-redirect/{licenca}/{code},
    // ou o link curto com marca /r/{licenca}/{code}.
    let licenca = url.searchParams.get("l") || url.searchParams.get("licenca");
    if (!licenca) {
      const parts = url.pathname.split("/").filter(Boolean);
      const rIdx = parts.indexOf("r");
      const qrIdx = parts.indexOf("qr-redirect");
      if (rIdx !== -1 && parts[rIdx + 1]) {
        // /r/{licenca}/{code?}
        licenca = parts[rIdx + 1] || null;
        if (!codeParam && parts[rIdx + 2]) codeParam = parts[rIdx + 2];
      } else if (qrIdx !== -1 && parts[qrIdx + 1]) {
        // /functions/v1/qr-redirect/{licenca}/{code?}
        licenca = parts[qrIdx + 1] || null;
        if (!codeParam && parts[qrIdx + 2]) codeParam = parts[qrIdx + 2];
      } else {
        // legado: último segmento = licença
        licenca = parts[parts.length - 1] || null;
        if (licenca === "qr-redirect") licenca = null;
      }
    }

    // ?p={partnerId}: parceiro indicador. Quando presente, a frase é montada
    // a partir da keyword/qr_phrase do parceiro (link curto). Tem prioridade
    // sobre ?msg; sem ?p nem ?msg, cai no DEFAULT_MESSAGE (comportamento atual).
    const partnerId = url.searchParams.get("p");
    const msgParam = url.searchParams.get("msg");

    if (!licenca) {
      if (wantsJson) return jsonResponse({ error: "missing_license" });
      // Sem licença → site institucional (panfleto NUNCA quebra, sem expor número pessoal)
      return redirectTo(SITE_URL);
    }


    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1) Busca consultor pelo identificador do primeiro segmento.
    //    Forma ATUAL (neutra): {igreen_id} numérico — não expõe o nome do
    //    consultor na URL (ex.: igreen.cloud/r/122160/954364).
    //    Forma LEGADA: {license} (slug com nome, ex.: rafael-ferreira).
    //    Tenta license primeiro (preserva 100% dos links antigos); se não achar
    //    e o identificador for só dígitos, resolve por igreen_id.
    let { data: consultant } = await supabase
      .from("consultants")
      .select("id, phone")
      .eq("license", licenca)
      .maybeSingle();

    if (!consultant?.id && /^\d+$/.test(licenca)) {
      const { data: byIgreenId } = await supabase
        .from("consultants")
        .select("id, phone")
        .eq("igreen_id", licenca)
        .maybeSingle();
      if (byIgreenId?.id) consultant = byIgreenId;
    }

    let phone: string | null = null;

    if (consultant?.id) {
      // 2) Telefone conectado da instância (mais recente, com phone preenchido)
      const { data: insts } = await supabase
        .from("whatsapp_instances")
        .select("connected_phone, updated_at")
        .eq("consultant_id", consultant.id)
        .not("connected_phone", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1);

      phone = (insts?.[0]?.connected_phone as string | null) || null;

      // 3) Fallback: telefone do perfil do consultor
      if (!phone && consultant.phone) {
        phone = consultant.phone;
      }

      // Tracking (não bloqueia o redirect)
      supabase.from("page_events").insert({
        consultant_id: consultant.id,
        event_type: "qr_scan",
        event_target: "panfleto",
        page_type: "client",
      }).then(() => {});
    }

    // Validação do phone: precisa ser BR (10-13 dígitos depois de prefixar 55).
    // Sem isso, `wa.me/55` abre o WhatsApp em conversa nenhuma e o usuário
    // relata "QR não abre". Cai pro site institucional com flag de erro.
    const phoneDigits = (phone ?? "").replace(/\D/g, "");
    const normalizedPhone = phoneDigits
      ? (phoneDigits.startsWith("55") ? phoneDigits : `55${phoneDigits}`)
      : "";
    const phoneValid = /^\d{12,13}$/.test(normalizedPhone);

    if (!phone || !phoneValid) {
      if (consultant?.id) {
        // Log para o operador rastrear consultores com QR quebrado.
        supabase.from("page_events").insert({
          consultant_id: consultant.id,
          event_type: "qr_broken",
          event_target: "panfleto",
          page_type: "client",
        }).then(() => {});
        console.warn("[qr-redirect] phone_invalid", {
          consultant_id: consultant.id,
          phone_raw: phone,
          phone_digits: phoneDigits,
        });
      }
      if (wantsJson) return jsonResponse({ error: "no_phone" });
      const fallback = /^\d+$/.test(licenca)
        ? `${SITE_URL}?qr_error=phone_missing`
        : `${SITE_URL}/${licenca}?qr_error=phone_missing`;
      return redirectTo(fallback);
    }



    // 5) Resolve a mensagem. Prioridade do parceiro indicador:
    //      ?p={id} → {code} (short_code, forma atual) → ?k={keyword} (legado)
    //    e, sem parceiro: ?msg → DEFAULT_MESSAGE.
    // O parceiro só é usado quando pertence ao MESMO consultor da licença
    // (evita um parceiro de outro consultor ser resolvido por uma licença
    // qualquer). A frase é montada com a keyword do parceiro para preservar a
    // atribuição (a keyword precisa aparecer no texto que chega no WhatsApp).
    let message = msgParam || DEFAULT_MESSAGE;

    let partner:
      | {
          nome: string;
          keywords: unknown;
          qr_phrase: string | null;
          consultant_id: string;
          is_active: boolean;
          short_code: string | null;
        }
      | null = null;

    if (consultant?.id) {
      const baseSelect =
        "nome, keywords, qr_phrase, consultant_id, is_active, short_code";

      if (partnerId) {
        // a) Por id explícito (?p) — maior prioridade.
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
        // b) Por short_code (forma atual do link curto: /r/{licenca}/{code}).
        // Único por consultor, então filtra pelo consultor da licença.
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
        // c) Legado: por keyword (links antigos com a palavra no path/query).
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
      // Keyword do LOCAL (?k=) tem prioridade sobre keywords[0] — permite
      // vários banners do mesmo parceiro (posto X, padaria Y) e rastrear
      // de qual ponto veio o lead. A atribuição do parceiro continua pelo
      // marcador `#R{short_code}` anexado em resolveQrMessage.
      const fromQuery = (keywordParam ?? "").trim();
      const rawKw = Array.isArray(partner.keywords) ? (partner.keywords[0] ?? "") : "";
      const fallbackKw =
        typeof rawKw === "string" && rawKw.trim() ? rawKw : (partner.nome ?? "");
      const keyword = fromQuery || fallbackKw;
      // ?msg= personaliza a frase; senão usa qr_phrase do parceiro.
      const phraseSource = (msgParam ?? "").trim() || (partner.qr_phrase as string | null);
      message = resolveQrMessage(
        phraseSource,
        keyword,
        partner.short_code,
      );
    }

    if (wantsJson) return jsonResponse({ phone: normalizedPhone, message });
    return redirectTo(buildWhatsappUrl(normalizedPhone, message));


  } catch (e) {
    console.error("[qr-redirect] error:", e);
    return redirectTo(SITE_URL);
  }
});