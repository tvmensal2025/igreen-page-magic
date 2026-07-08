// Resolve o número WhatsApp para publicar CTWA.
// Preferência: lista viva de phone_numbers da WABA vinculada à Página.
// Fallback: quando a Graph não expõe WABA mas há número salvo/conectado, usa o
// número salvo e deixa a própria Marketing API validar no AdSet (mesmo caminho
// que o Ads Manager usa visualmente). Nunca adivinha 9º dígito no publish.

import { adminClient, loadPlatformAccount } from "./fb-graph.ts";
import { decryptToken } from "./fb-crypto.ts";

const FB_VERSION = "v21.0";
const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;

export interface WabaPhone {
  id: string;                    // phone_number_id (imutável)
  display: string;               // ex.: "+55 34 8431-4317"
  digits: string;                // ex.: "553484314317"
  verified_name?: string;
  quality?: string;
  source?: "waba" | "saved_fallback";
}

export interface WabaResolution {
  ok: boolean;
  reason?:
    | "no_platform_page"
    | "no_platform_token"
    | "no_waba"
    | "no_numbers"
    | "no_match"
    | "detect_failed";
  waba_id?: string | null;
  page_id?: string | null;
  numbers: WabaPhone[];
  chosen?: WabaPhone | null;     // o número atualmente usado por este consultor
  hint?: string;
  detected_paths_tried?: string[]; // debug: quais caminhos Graph testamos
  discovered_via?: string | null;  // qual caminho retornou a WABA
  next_steps?: string[];
}

function digitsOf(s: string | null | undefined): string {
  return String(s || "").replace(/\D/g, "");
}

// Gera todas as variantes plausíveis BR (com/sem 55, com/sem 9). Usado só para MATCHING,
// não para publicar.
function brVariants(s: string | null | undefined): Set<string> {
  const d = digitsOf(s);
  const out = new Set<string>();
  if (!d) return out;
  out.add(d);
  const national = d.startsWith("55") ? d.slice(2) : d;
  if (national.length < 10) return out;
  out.add(national);
  out.add(`55${national}`);
  const ddd = national.slice(0, 2);
  const local = national.slice(2);
  if (local.length === 9 && local.startsWith("9")) {
    out.add(`${ddd}${local.slice(1)}`);
    out.add(`55${ddd}${local.slice(1)}`);
  } else if (local.length === 8) {
    out.add(`${ddd}9${local}`);
    out.add(`55${ddd}9${local}`);
  }
  return out;
}

// Descobre a WABA vinculada à Página. Testa 3 campos em cascata porque
// nem todas as Páginas expõem o mesmo (Graph tem histórico bagunçado).
async function discoverWabaId(pageId: string, token: string): Promise<string | null> {
  const tries = [
    `${FB_GRAPH}/${pageId}?fields=whatsapp_business_account&access_token=${token}`,
    `${FB_GRAPH}/${pageId}?fields=connected_whatsapp_business_account&access_token=${token}`,
  ];
  for (const url of tries) {
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (r.ok) {
        const id =
          j?.whatsapp_business_account?.id ||
          j?.connected_whatsapp_business_account?.id ||
          null;
        if (id) return String(id);
      }
    } catch { /* try next */ }
  }
  // Fallback: percorre Businesses do usuário do token.
  try {
    const r = await fetch(`${FB_GRAPH}/me/businesses?fields=id&access_token=${token}`);
    const j = await r.json();
    for (const biz of (j?.data || [])) {
      for (const kind of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
        const wr = await fetch(`${FB_GRAPH}/${biz.id}/${kind}?access_token=${token}`);
        const wj = await wr.json();
        const first = (wj?.data || [])[0];
        if (first?.id) return String(first.id);
      }
    }
  } catch { /* ignore */ }
  return null;
}

async function fetchWabaNumbers(wabaId: string, token: string): Promise<WabaPhone[]> {
  const r = await fetch(
    `${FB_GRAPH}/${wabaId}/phone_numbers?fields=display_phone_number,verified_name,quality_rating&access_token=${token}`,
  );
  const j = await r.json();
  if (!r.ok) return [];
  return (j?.data || []).map((n: any) => ({
    id: String(n.id),
    display: String(n.display_phone_number || ""),
    digits: digitsOf(n.display_phone_number),
    verified_name: n.verified_name,
    quality: n.quality_rating,
  })).filter((n: WabaPhone) => n.id && n.digits);
}

/**
 * Resolve o número WhatsApp autoritativo para publicar anúncio deste consultor.
 * Se persist=true, grava id/display em consultant_ad_settings quando conseguir
 * casar 1-1 (ou quando existe só 1 número na WABA).
 */
export async function resolveWabaPhone(
  consultantId: string,
  opts: { persist?: boolean } = {},
): Promise<WabaResolution> {
  const admin = adminClient();
  const { data: platformRow } = await admin
    .from("platform_facebook_account")
    .select("page_id, access_token_encrypted")
    .eq("id", true)
    .maybeSingle();

  if (!platformRow?.page_id) {
    return { ok: false, reason: "no_platform_page", numbers: [], hint: "Conta Facebook da plataforma não configurada." };
  }
  if (!platformRow.access_token_encrypted) {
    return { ok: false, reason: "no_platform_token", numbers: [], hint: "Token da conta plataforma ausente — peça reconexão ao super admin." };
  }

  let token: string;
  try {
    token = await decryptToken(platformRow.access_token_encrypted);
  } catch {
    return { ok: false, reason: "no_platform_token", numbers: [], hint: "Falha ao descriptografar token da plataforma." };
  }

  const pageId = platformRow.page_id as string;

  // Carrega o que está salvo pro consultor antes da descoberta WABA. Assim,
  // se a Graph não expõe a WABA, ainda conseguimos seguir com o mesmo número
  // usado no Ads Manager e deixar a criação do AdSet validar oficialmente.
  const { data: settings } = await admin
    .from("consultant_ad_settings")
    .select("whatsapp_phone_number_id, whatsapp_destination_number, whatsapp_phone_number_display")
    .eq("consultant_id", consultantId)
    .maybeSingle();

  const savedDigits = digitsOf(settings?.whatsapp_destination_number);
  const savedDisplay = settings?.whatsapp_phone_number_display || (savedDigits ? `+${savedDigits}` : "");

  const wabaId = await discoverWabaId(pageId, token);
  if (!wabaId) {
    if (savedDigits) {
      const fallback: WabaPhone = {
        id: settings?.whatsapp_phone_number_id || `saved:${savedDigits}`,
        display: savedDisplay,
        digits: savedDigits,
        source: "saved_fallback",
      };
      if (opts.persist) {
        await admin.from("consultant_ad_settings")
          .update({ whatsapp_last_verified_at: new Date().toISOString() })
          .eq("consultant_id", consultantId);
      }
      return {
        ok: true,
        reason: undefined,
        page_id: pageId,
        numbers: [],
        chosen: fallback,
        hint: "A Graph não expôs a WABA da Página; usando o número salvo e deixando a Meta validar no AdSet.",
      };
    }
    return {
      ok: false,
      reason: "no_waba",
      page_id: pageId,
      numbers: [],
      hint: "A Página da plataforma não tem WhatsApp Business (WABA) vinculado. Vincule em Meta Business Suite → WhatsApp → Contas.",
    };
  }

  const numbers = await fetchWabaNumbers(wabaId, token);
  if (numbers.length === 0) {
    if (savedDigits) {
      const fallback: WabaPhone = {
        id: settings?.whatsapp_phone_number_id || `saved:${savedDigits}`,
        display: savedDisplay,
        digits: savedDigits,
        source: "saved_fallback",
      };
      if (opts.persist) {
        await admin.from("consultant_ad_settings")
          .update({ whatsapp_last_verified_at: new Date().toISOString() })
          .eq("consultant_id", consultantId);
      }
      return {
        ok: true,
        waba_id: wabaId,
        page_id: pageId,
        numbers: [],
        chosen: fallback,
        hint: "A WABA foi encontrada, mas a Graph não retornou telefones; usando o número salvo e deixando a Meta validar no AdSet.",
      };
    }
    return {
      ok: false,
      reason: "no_numbers",
      waba_id: wabaId,
      page_id: pageId,
      numbers: [],
      hint: "Nenhum telefone registrado na WABA. Registre um número em Meta Business Suite → WhatsApp Manager.",
    };
  }

  // 1) match por phone_number_id salvo (fonte imutável)
  let chosen: WabaPhone | null = null;
  if (settings?.whatsapp_phone_number_id) {
    chosen = numbers.find((n) => n.id === settings.whatsapp_phone_number_id) || null;
  }
  // 2) match por variantes do número digitado
  if (!chosen && settings?.whatsapp_destination_number) {
    const savedVariants = brVariants(settings.whatsapp_destination_number);
    for (const n of numbers) {
      const numberVariants = brVariants(n.digits);
      const hit = [...numberVariants].some((v) => savedVariants.has(v));
      if (hit) { chosen = n; break; }
    }
  }
  // 3) se só há UM número na WABA, escolhe ele automaticamente
  if (!chosen && numbers.length === 1) {
    chosen = numbers[0];
  }

  if (chosen && opts.persist) {
    const needsUpdate =
      settings?.whatsapp_phone_number_id !== chosen.id ||
      settings?.whatsapp_phone_number_display !== chosen.display ||
      digitsOf(settings?.whatsapp_destination_number) !== chosen.digits;
    if (needsUpdate) {
      await admin.from("consultant_ad_settings").upsert(
        {
          consultant_id: consultantId,
          whatsapp_phone_number_id: chosen.id,
          whatsapp_phone_number_display: chosen.display,
          whatsapp_destination_number: chosen.digits,
          whatsapp_last_verified_at: new Date().toISOString(),
        },
        { onConflict: "consultant_id" },
      );
    } else {
      // marca só o timestamp de verificação
      await admin.from("consultant_ad_settings")
        .update({ whatsapp_last_verified_at: new Date().toISOString() })
        .eq("consultant_id", consultantId);
    }
  }

  return {
    ok: !!chosen,
    reason: chosen ? undefined : "no_match",
    waba_id: wabaId,
    page_id: pageId,
    numbers,
    chosen,
    hint: chosen
      ? undefined
      : `Seu número não bate com nenhum registrado na WABA. Escolha um dos ${numbers.length} disponíveis.`,
  };
}
