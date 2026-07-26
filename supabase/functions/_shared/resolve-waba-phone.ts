// Resolve o número WhatsApp para publicar CTWA.
// Preferência: lista viva de phone_numbers da WABA vinculada à Página.
// Quando a Meta não entrega a permissão whatsapp_business_management no token,
// não publicamos com fallback: exigimos phone_number_id real ou WABA vinculada.

import { adminClient } from "./fb-graph.ts";
import { decryptToken } from "./fb-crypto.ts";

const FB_VERSION = "v21.0";
const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;

export interface WabaPhone {
  id: string;                    // phone_number_id (imutável)
  display: string;               // ex.: "+55 34 8431-4317"
  digits: string;                // ex.: "553484314317"
  waba_id?: string;
  waba_name?: string;
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
  missing_permissions?: string[];
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

// Descobre a WABA explicitamente vinculada à Página. Testa campos em cascata porque
// nem todas as Páginas expõem o mesmo (Graph tem histórico bagunçado):
//  - whatsapp_business_account: WABA Cloud API vinculada à Página
//  - connected_whatsapp_business_account: legado
//  - page_backed_whatsapp_business_account: WhatsApp Business App conectado
//    à Página SEM Cloud API (fluxo comum em Páginas legado/PME BR)
async function discoverWabaId(
  pageId: string,
  token: string,
  tried: string[],
): Promise<{ id: string; via: string } | null> {
  const tries: Array<{ label: string; url: string; pick: (j: any) => string | null }> = [
    { label: "page.whatsapp_business_account", url: `${FB_GRAPH}/${pageId}?fields=whatsapp_business_account&access_token=${token}`, pick: (j) => j?.whatsapp_business_account?.id || null },
    { label: "page.connected_whatsapp_business_account", url: `${FB_GRAPH}/${pageId}?fields=connected_whatsapp_business_account&access_token=${token}`, pick: (j) => j?.connected_whatsapp_business_account?.id || null },
    { label: "page.page_backed_whatsapp_business_account", url: `${FB_GRAPH}/${pageId}?fields=page_backed_whatsapp_business_account&access_token=${token}`, pick: (j) => j?.page_backed_whatsapp_business_account?.id || null },
  ];
  for (const t of tries) {
    tried.push(t.label);
    try {
      const r = await fetch(t.url);
      const j = await r.json();
      if (r.ok) {
        const id = t.pick(j);
        if (id) return { id: String(id), via: t.label };
      }
    } catch { /* try next */ }
  }
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
    waba_id: wabaId,
    verified_name: n.verified_name,
    quality: n.quality_rating,
  })).filter((n: WabaPhone) => n.id && n.digits);
}

async function scanBusinessWabaNumbers(token: string, tried: string[]): Promise<WabaPhone[]> {
  const out: WabaPhone[] = [];
  const seenWabas = new Set<string>();
  try {
    tried.push("me/businesses");
    const r = await fetch(`${FB_GRAPH}/me/businesses?fields=id,name&access_token=${token}`);
    const j = await r.json();
    for (const biz of (j?.data || [])) {
      for (const kind of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
        tried.push(`business.${biz.id}.${kind}`);
        const wr = await fetch(`${FB_GRAPH}/${biz.id}/${kind}?fields=id,name&limit=100&access_token=${token}`);
        const wj = await wr.json();
        if (!wr.ok) continue;
        for (const waba of (wj?.data || [])) {
          const wabaId = String(waba?.id || "");
          if (!wabaId || seenWabas.has(wabaId)) continue;
          seenWabas.add(wabaId);
          const nums = await fetchWabaNumbers(wabaId, token);
          out.push(...nums.map((n) => ({ ...n, waba_id: wabaId, waba_name: waba?.name })));
        }
      }
    }
  } catch { /* best effort */ }
  return out;
}

async function tokenScopes(token: string, tried: string[]): Promise<Set<string>> {
  const scopes = new Set<string>();
  const appId = Deno.env.get("FACEBOOK_APP_ID");
  const appSecret = Deno.env.get("FACEBOOK_APP_SECRET");
  if (!appId || !appSecret) return scopes;
  try {
    tried.push("debug_token.scopes");
    const r = await fetch(`${FB_GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`);
    const j = await r.json().catch(() => ({}));
    const rawScopes = Array.isArray(j?.data?.scopes) ? j.data.scopes : [];
    for (const s of rawScopes) scopes.add(String(s));
    const granular = Array.isArray(j?.data?.granular_scopes) ? j.data.granular_scopes : [];
    for (const g of granular) if (g?.scope) scopes.add(String(g.scope));
  } catch { /* best effort */ }
  return scopes;
}

function missingWhatsAppScopes(scopes: Set<string>): string[] {
  const required = ["whatsapp_business_management"];
  return required.filter((scope) => !scopes.has(scope));
}

function isRealPhoneId(id: string | null | undefined): boolean {
  return /^\d+$/.test(String(id || ""));
}

async function probePhoneNumberId(phoneNumberId: string, token: string): Promise<WabaPhone | null> {
  if (!isRealPhoneId(phoneNumberId)) return null;
  const r = await fetch(
    `${FB_GRAPH}/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating&access_token=${token}`,
  );
  const j = await r.json();
  if (!r.ok || !j?.id || !j?.display_phone_number) return null;
  const digits = digitsOf(j.display_phone_number);
  if (!digits) return null;
  return {
    id: String(j.id),
    display: String(j.display_phone_number),
    digits,
    verified_name: j.verified_name,
    quality: j.quality_rating,
    source: "waba",
  };
}

/**
 * Resolve o número WhatsApp autoritativo para publicar anúncio deste consultor.
 * Se persist=true, grava id/display em consultant_ad_settings quando conseguir
 * casar 1-1 (ou quando existe só 1 número na WABA).
 */
// Cache in-memory por consultor: evita 3 requests à Graph a cada preflight/publish.
// TTL curto (5 min) — WABA raramente muda, mas invalidação manual acontece via re-run.
const RESOLVE_CACHE = new Map<string, { at: number; value: WabaResolution }>();
const RESOLVE_TTL_MS = 5 * 60 * 1000;

export async function resolveWabaPhone(
  consultantId: string,
  opts: { persist?: boolean; noCache?: boolean } = {},
): Promise<WabaResolution> {
  if (!opts.noCache) {
    const cached = RESOLVE_CACHE.get(consultantId);
    if (cached && Date.now() - cached.at < RESOLVE_TTL_MS && cached.value.ok) {
      return cached.value;
    }
  }
  const admin = adminClient();
  const { data: platformRow } = await admin
    .from("platform_facebook_account")
    .select(
      "page_id, access_token_encrypted, whatsapp_phone_number_id, whatsapp_destination_number, whatsapp_phone_number_display, waba_id",
    )
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
  const savedPhoneId = String(settings?.whatsapp_phone_number_id || "");
  const savedPhoneIdIsReal = isRealPhoneId(savedPhoneId);

  // Número oficial da plataforma (implantado pelo SuperAdmin) — fallback se o
  // consultor não tiver override próprio.
  const platformPhoneId = String(platformRow.whatsapp_phone_number_id || "");
  const platformDigits = digitsOf(platformRow.whatsapp_destination_number);
  const platformPhoneIdIsReal = isRealPhoneId(platformPhoneId);

  const effectivePhoneId = savedPhoneIdIsReal
    ? savedPhoneId
    : (platformPhoneIdIsReal ? platformPhoneId : "");
  const effectiveDigits = savedDigits || platformDigits;
  const usingPlatformOfficial = !savedPhoneIdIsReal && !savedDigits &&
    platformPhoneIdIsReal;

  const tried: string[] = [];
  const scopes = await tokenScopes(token, tried);
  const missingPermissions = missingWhatsAppScopes(scopes);
  const wabaDiscovery = await discoverWabaId(pageId, token, tried);
  const wabaId = wabaDiscovery?.id ?? null;
  const discoveredVia = wabaDiscovery?.via ?? null;

  const nextStepsNoWaba = [
    `Meta Business Suite → Configurações → Contas do WhatsApp → vincular à Página ${pageId}`,
    "OU salvar o phone_number_id numérico real do WhatsApp Manager em Anúncios → Configurações do consultor",
    "Depois clique em Reverificar para rodar facebook-detect-waba novamente",
  ];

  // Se o admin/consultor salvou um phone_number_id real (numérico), valida direto
  // na Graph. Isso cobre casos em que a Página não expõe a WABA, mas o token tem
  // acesso ao número real. Se for inválido, não publicamos com fallback fake.
  // Também cobre o número oficial da plataforma (SuperAdmin).
  if (!wabaId && isRealPhoneId(effectivePhoneId)) {
    try {
      const probed = await probePhoneNumberId(effectivePhoneId, token);
      if (probed) {
        if (opts.persist) {
          await admin.from("consultant_ad_settings").upsert(
            {
              consultant_id: consultantId,
              whatsapp_phone_number_id: probed.id,
              whatsapp_phone_number_display: probed.display,
              whatsapp_destination_number: probed.digits,
              whatsapp_last_verified_at: new Date().toISOString(),
            },
            { onConflict: "consultant_id" },
          );
        }
        return {
          ok: true,
          page_id: pageId,
          numbers: [],
          chosen: probed,
          hint: usingPlatformOfficial
            ? "Usando número oficial da plataforma (implantado pelo SuperAdmin)."
            : "phone_number_id real validado diretamente na Graph.",
          detected_paths_tried: tried,
          discovered_via: usingPlatformOfficial
            ? "platform_official_wa"
            : "phone_number_id_probe",
        };
      }
    } catch { /* cai para descoberta WABA */ }
  }

  if (!wabaId) {
    const businessNumbers = await scanBusinessWabaNumbers(token, tried);
    let businessMatch: WabaPhone | null = null;
    if (isRealPhoneId(effectivePhoneId)) {
      businessMatch = businessNumbers.find((n) => n.id === effectivePhoneId) || null;
    }
    if (!businessMatch && effectiveDigits) {
      const savedVariants = brVariants(effectiveDigits);
      businessMatch = businessNumbers.find((n) => {
        const numberVariants = brVariants(n.digits);
        return [...numberVariants].some((v) => savedVariants.has(v));
      }) || null;
    }
    if (!businessMatch && businessNumbers.length === 1) businessMatch = businessNumbers[0];

    if (businessMatch) {
      if (opts.persist) {
        await admin.from("consultant_ad_settings").upsert(
          {
            consultant_id: consultantId,
            whatsapp_phone_number_id: businessMatch.id,
            whatsapp_phone_number_display: businessMatch.display,
            whatsapp_destination_number: businessMatch.digits,
            whatsapp_last_verified_at: new Date().toISOString(),
          },
          { onConflict: "consultant_id" },
        );
      }
      return {
        ok: true,
        waba_id: businessMatch.waba_id || null,
        page_id: pageId,
        numbers: businessNumbers,
        chosen: businessMatch,
        hint: usingPlatformOfficial
          ? "Número oficial da plataforma encontrado nas WABAs do Business."
          : "Número encontrado automaticamente nas WABAs acessíveis ao Business. A criação da campanha ainda valida se essa WABA está vinculada à Página.",
        detected_paths_tried: tried,
        discovered_via: usingPlatformOfficial
          ? "platform_official_wa"
          : "business_waba_phone_scan",
        next_steps: [
          `Se a Meta ainda recusar, vincule a WABA ${businessMatch.waba_id || "encontrada"} à Página ${pageId}`,
          "Depois clique em Validar e corrigir WhatsApp automaticamente",
        ],
      };
    }

    // App/token sem whatsapp_business_management: a Graph não deixa listar WABA
    // nem phone_numbers. Antes tentávamos publicar com fallback de dígitos, mas
    // isso cria campanhas/adsets órfãos quando a Meta recusa o vínculo Página↔WABA.
    // Agora bloqueamos cedo até existir phone_number_id real ou WABA acessível.
    if (effectiveDigits && missingPermissions.includes("whatsapp_business_management")) {
      return {
        ok: false,
        reason: "no_waba",
        page_id: pageId,
        numbers: businessNumbers,
        chosen: null,
        hint: `A conta Facebook da plataforma está conectada, mas sem a permissão whatsapp_business_management. Salve o phone_number_id numérico real do número ${effectiveDigits} ou reconecte a Meta aceitando WhatsApp Business Management.`,
        detected_paths_tried: tried,
        discovered_via: null,
        next_steps: [
          "Reconecte a conta Facebook da plataforma aceitando WhatsApp Business Management.",
          `Confirme no Meta Business Suite que o número ${effectiveDigits} está vinculado à Página ${pageId}.`,
          "Ou use SuperAdmin → Implantar número WhatsApp CTWA.",
        ],
        missing_permissions: missingPermissions,
      };
    }

    return {
      ok: false,
      reason: "no_waba",
      page_id: pageId,
      numbers: businessNumbers,
      hint: effectiveDigits
        ? missingPermissions.length
          ? `A conta Facebook da plataforma está conectada, mas sem a permissão ${missingPermissions.join(", ")}. Por isso a Meta não deixa o sistema enxergar a WABA/número ${effectiveDigits}.`
          : `O número ${effectiveDigits} está salvo, mas não foi encontrado em nenhuma WABA acessível e a Página ${pageId} não expõe WABA vinculada.`
        : `Página ${pageId} não expõe WABA via Graph e nenhuma WABA acessível trouxe um telefone selecionável.`,
      detected_paths_tried: tried,
      discovered_via: null,
      next_steps: missingPermissions.length
        ? [
          "Reconecte a conta Facebook da plataforma e aceite a permissão WhatsApp Business Management.",
          "Depois volte em Dados → WhatsApp dos anúncios Meta e clique em Validar e corrigir automático.",
        ]
        : nextStepsNoWaba,
      missing_permissions: missingPermissions,
    };
  }

  const numbers = await fetchWabaNumbers(wabaId, token);
  if (numbers.length === 0) {
    if (isRealPhoneId(effectivePhoneId)) {
      try {
        const probed = await probePhoneNumberId(effectivePhoneId, token);
        if (probed) {
          if (opts.persist) {
            await admin.from("consultant_ad_settings").upsert(
              {
                consultant_id: consultantId,
                whatsapp_phone_number_id: probed.id,
                whatsapp_phone_number_display: probed.display,
                whatsapp_destination_number: probed.digits,
                whatsapp_last_verified_at: new Date().toISOString(),
              },
              { onConflict: "consultant_id" },
            );
          }
          return {
            ok: true,
            waba_id: wabaId,
            page_id: pageId,
            numbers: [],
            chosen: probed,
            hint: usingPlatformOfficial
              ? "Número oficial da plataforma validado na Graph."
              : "A WABA foi encontrada mas não listou telefones; phone_number_id real validado diretamente na Graph.",
            detected_paths_tried: tried,
            discovered_via: usingPlatformOfficial
              ? "platform_official_wa"
              : (discoveredVia || "phone_number_id_probe"),
          };
        }
      } catch { /* bloqueia no no_numbers */ }
    }
    if (effectiveDigits && missingPermissions.includes("whatsapp_business_management")) {
      return {
        ok: false,
        reason: "no_numbers",
        waba_id: wabaId,
        page_id: pageId,
        numbers: [],
        chosen: null,
        hint: `A WABA foi detectada, mas o token não tem permissão para listar telefones. Salve o phone_number_id numérico real do número ${effectiveDigits} ou reconecte a Meta aceitando WhatsApp Business Management.`,
        detected_paths_tried: tried,
        discovered_via: discoveredVia,
        next_steps: [
          "Reconecte a conta Facebook da plataforma aceitando WhatsApp Business Management.",
          `Confirme no Meta Business Suite que o número ${effectiveDigits} está vinculado à Página ${pageId}.`,
          "Ou use SuperAdmin → Implantar número WhatsApp CTWA.",
        ],
        missing_permissions: missingPermissions,
      };
    }
    return {
      ok: false,
      reason: "no_numbers",
      waba_id: wabaId,
      page_id: pageId,
      numbers: [],
      hint: effectiveDigits
        ? `A WABA ${wabaId} foi encontrada, mas não retornou telefones. O número salvo ${effectiveDigits} não será usado sem phone_number_id real validado pela Meta.`
        : "Nenhum telefone registrado na WABA. Use SuperAdmin → Implantar número WhatsApp CTWA.",
      detected_paths_tried: tried,
      discovered_via: discoveredVia,
    };
  }

  // 1) match por phone_number_id (consultor ou oficial plataforma)
  let chosen: WabaPhone | null = null;
  if (effectivePhoneId) {
    chosen = numbers.find((n) => n.id === effectivePhoneId) || null;
  }
  // 2) match por variantes do número digitado
  if (!chosen && effectiveDigits) {
    const savedVariants = brVariants(effectiveDigits);
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
      await admin.from("consultant_ad_settings")
        .update({ whatsapp_last_verified_at: new Date().toISOString() })
        .eq("consultant_id", consultantId);
    }
  }

  const result: WabaResolution = {
    ok: !!chosen,
    reason: chosen ? undefined : "no_match",
    waba_id: wabaId,
    page_id: pageId,
    numbers,
    chosen,
    hint: chosen
      ? (usingPlatformOfficial
        ? "Usando número oficial da plataforma (implantado pelo SuperAdmin)."
        : undefined)
      : `Seu número não bate com nenhum registrado na WABA. Escolha um dos ${numbers.length} disponíveis ou implante o oficial no SuperAdmin.`,
    detected_paths_tried: tried,
    discovered_via: usingPlatformOfficial && chosen
      ? "platform_official_wa"
      : discoveredVia,
  };
  if (result.ok) RESOLVE_CACHE.set(consultantId, { at: Date.now(), value: result });
  return result;
}
