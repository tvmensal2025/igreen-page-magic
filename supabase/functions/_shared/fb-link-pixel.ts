/**
 * Vincula Pixel ↔ Ad Account via Graph (shared_accounts).
 * Também resolve e persiste business_id se estiver nulo.
 */

const GRAPH = "https://graph.facebook.com/v21.0";
export const PLATFORM_PIXEL_ID = "708759256921383"; // igreen-oficial-remarketing
export const PLATFORM_PIXEL_NAME = "igreen-oficial-remarketing";
export const LEGACY_PIXEL_ID = "1521037349653769"; // igreen-app-oficial (fora da ad account)

function actId(raw: string): string {
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

function numericAct(raw: string): string {
  return String(raw).replace(/^act_/, "");
}

async function graphJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

/** Descobre business_id a partir da ad account, do pixel ou das businesses do token. */
export async function resolveBusinessId(opts: {
  token: string;
  adAccountId: string;
  pixelId: string;
  knownBusinessId?: string | null;
}): Promise<{ businessId: string | null; debug: string[]; candidates?: string[] }> {
  const debug: string[] = [];
  if (opts.knownBusinessId) {
    return { businessId: String(opts.knownBusinessId), debug: ["known"] };
  }

  const acc = actId(opts.adAccountId);
  const a = await graphJson(
    `${GRAPH}/${acc}?fields=id,name,business{id,name}&access_token=${encodeURIComponent(opts.token)}`,
  );
  debug.push(`ad_account:${a.ok ? "ok" : a.body?.error?.message || a.status}`);
  const fromAcc = a.body?.business?.id || null;
  if (fromAcc) return { businessId: String(fromAcc), debug };

  const p = await graphJson(
    `${GRAPH}/${opts.pixelId}?fields=id,name,owner_business{id,name}&access_token=${encodeURIComponent(opts.token)}`,
  );
  debug.push(`pixel:${p.ok ? "ok" : p.body?.error?.message || p.status}`);
  const fromPix = p.body?.owner_business?.id || null;
  if (fromPix) return { businessId: String(fromPix), debug };

  const me = await graphJson(
    `${GRAPH}/me/businesses?fields=id,name&limit=25&access_token=${encodeURIComponent(opts.token)}`,
  );
  debug.push(`me_businesses:${me.ok ? (me.body?.data || []).length : me.body?.error?.message || me.status}`);
  const businesses = (me.body?.data || []) as Array<{ id: string; name: string }>;
  if (businesses.length === 1) return { businessId: businesses[0].id, debug };
  // Se houver várias, tenta achar qual possui a ad account
  for (const b of businesses) {
    const owned = await graphJson(
      `${GRAPH}/${b.id}/owned_ad_accounts?fields=id&limit=100&access_token=${encodeURIComponent(opts.token)}`,
    );
    const ids = ((owned.body?.data || []) as Array<{ id: string }>).map((x) => actId(x.id));
    if (ids.includes(acc)) {
      debug.push(`owned_match:${b.id}`);
      return { businessId: b.id, debug };
    }
    const client = await graphJson(
      `${GRAPH}/${b.id}/client_ad_accounts?fields=id&limit=100&access_token=${encodeURIComponent(opts.token)}`,
    );
    const cids = ((client.body?.data || []) as Array<{ id: string }>).map((x) => actId(x.id));
    if (cids.includes(acc)) {
      debug.push(`client_match:${b.id}`);
      return { businessId: b.id, debug };
    }
  }
  // Devolve a primeira; o caller tenta share em todas via tryShareWithBusinesses
  if (businesses.length > 0) {
    debug.push(`candidates:${businesses.map((b) => b.id).join(",")}`);
    return { businessId: businesses[0].id, debug, candidates: businesses.map((b) => b.id) };
  }
  return { businessId: null, debug };
}

export type LinkPixelResult = {
  ok: boolean;
  already_linked?: boolean;
  linked?: boolean;
  business_id?: string | null;
  ad_account_id: string;
  pixel_id: string;
  available_pixels?: Array<{ id: string; name: string }>;
  message: string;
  error?: string;
  steps?: string[];
};

/**
 * Garante que PLATFORM_PIXEL (ou pixelId) aparece em ad_account/adspixels.
 * Se não, tenta POST /{pixel}/shared_accounts.
 */
export async function ensurePixelLinkedToAdAccount(opts: {
  token: string;
  adAccountId: string;
  pixelId?: string;
  businessId?: string | null;
  // deno-lint-ignore no-explicit-any
  admin?: any;
}): Promise<LinkPixelResult> {
  const pixelId = opts.pixelId || PLATFORM_PIXEL_ID;
  const acc = actId(opts.adAccountId);
  const steps: string[] = [];

  const list = await graphJson(
    `${GRAPH}/${acc}/adspixels?fields=id,name&limit=50&access_token=${encodeURIComponent(opts.token)}`,
  );
  if (!list.ok) {
    return {
      ok: false,
      ad_account_id: acc,
      pixel_id: pixelId,
      message: `Falha ao listar pixels: ${list.body?.error?.message || list.status}`,
      error: list.body?.error?.message || `HTTP ${list.status}`,
      steps,
    };
  }
  const pixels = (list.body?.data || []) as Array<{ id: string; name: string }>;
  const found = pixels.find((p) => p.id === pixelId);
  if (found) {
    return {
      ok: true,
      already_linked: true,
      ad_account_id: acc,
      pixel_id: pixelId,
      available_pixels: pixels,
      message: `Pixel ${pixelId} (${found.name}) já vinculado à ${acc} ✅`,
      steps,
    };
  }

  steps.push("pixel_ausente_na_ad_account");
  const resolved = await resolveBusinessId({
    token: opts.token,
    adAccountId: acc,
    pixelId,
    // Não usa known como exclusão — só como candidato prioritário.
    knownBusinessId: null,
  });
  // Sempre inclui o known + candidatos descobertos
  const meBiz = await graphJson(
    `${GRAPH}/me/businesses?fields=id,name&limit=25&access_token=${encodeURIComponent(opts.token)}`,
  );
  const fromMe = ((meBiz.body?.data || []) as Array<{ id: string }>).map((b) => String(b.id));
  const businessId = resolved.businessId || opts.businessId || fromMe[0] || null;
  steps.push(...resolved.debug.map((d) => `biz:${d}`));
  if (!businessId && fromMe.length === 0) {
    return {
      ok: false,
      ad_account_id: acc,
      pixel_id: pixelId,
      available_pixels: pixels,
      business_id: null,
      message:
        `Pixel ${pixelId} não está na ${acc} e não foi possível descobrir o Business ID. ` +
        `Vincule em business.facebook.com → Pixels → Atribuir ativos → Conta de anúncios.`,
      error: "business_id_missing",
      steps,
    };
  }

  // Tenta share em todas as businesses candidatas (token pode admin em 1 e não em outra).
  const businessesToTry = [
    ...new Set([
      ...(opts.businessId ? [String(opts.businessId)] : []),
      ...(resolved.candidates || []),
      ...(businessId ? [String(businessId)] : []),
      ...fromMe,
    ]),
  ];
  let lastShareErr = "";
  let usedBusiness: string | null = null;
  for (const biz of businessesToTry) {
    const share = await graphJson(`${GRAPH}/${pixelId}/shared_accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        account_id: numericAct(acc),
        business: biz,
        access_token: opts.token,
      }),
    });
    if (share.ok) {
      usedBusiness = biz;
      steps.push(`shared_accounts_ok:${biz}`);
      break;
    }
    lastShareErr = share.body?.error?.message || String(share.status);
    steps.push(`shared_accounts_fail:${biz}:${lastShareErr}`);
  }
  if (usedBusiness && opts.admin) {
    try {
      await opts.admin
        .from("platform_facebook_account")
        .update({ business_id: usedBusiness, updated_at: new Date().toISOString() })
        .eq("id", true);
      steps.push(`business_id_salvo:${usedBusiness}`);
    } catch (_) { /* ignore */ }
  }
  const businessIdFinal = usedBusiness || businessId;

  // Revalida
  const relist = await graphJson(
    `${GRAPH}/${acc}/adspixels?fields=id,name&limit=50&access_token=${encodeURIComponent(opts.token)}`,
  );
  const pixels2 = (relist.body?.data || []) as Array<{ id: string; name: string }>;
  const found2 = pixels2.find((p) => p.id === pixelId);

  if (found2) {
    return {
      ok: true,
      linked: true,
      business_id: businessIdFinal,
      ad_account_id: acc,
      pixel_id: pixelId,
      available_pixels: pixels2,
      message: `Pixel ${pixelId} (${found2.name}) vinculado à ${acc} agora ✅`,
      steps,
    };
  }

  return {
    ok: false,
    linked: false,
    business_id: businessIdFinal,
    ad_account_id: acc,
    pixel_id: pixelId,
    available_pixels: pixels2.length ? pixels2 : pixels,
    message:
      `Não consegui vincular o Pixel ${pixelId} à ${acc} via API` +
      (lastShareErr ? `: ${lastShareErr}` : ".") +
      ` Abra business.facebook.com → Pixels → ${pixelId} → Atribuir ativos → Conta ${acc}.`,
    error: lastShareErr || "link_failed",
    steps,
  };
}
