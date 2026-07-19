/**
 * Garante que a ad account está ligada a um Business Manager.
 * Sem isso a Meta rejeita Custom Audience (subcode 1870050).
 */
const GRAPH = "https://graph.facebook.com/v21.0";

function actId(raw: string): string {
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

async function g(
  path: string,
  token: string,
  init?: { method?: string; form?: Record<string, string> },
): Promise<{ ok: boolean; body: any; status: number }> {
  const method = init?.method || "GET";
  if (init?.form) {
    const r = await fetch(`${GRAPH}${path}`, {
      method,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...init.form, access_token: token }),
    });
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
  }
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`);
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}

export type EnsureBusinessResult = {
  ok: boolean;
  business_id: string | null;
  already?: boolean;
  attached?: boolean;
  message: string;
  steps: string[];
};

export async function ensureAdAccountInBusiness(opts: {
  token: string;
  adAccountId: string;
  preferredBusinessId?: string | null;
  // deno-lint-ignore no-explicit-any
  admin?: any;
}): Promise<EnsureBusinessResult> {
  const steps: string[] = [];
  const acc = actId(opts.adAccountId);

  // 1) Já tem business?
  const accInfo = await g(`/${acc}?fields=id,name,business{id,name}`, opts.token);
  steps.push(`ad_account_read:${accInfo.ok ? "ok" : accInfo.body?.error?.message || accInfo.status}`);
  let businessId: string | null = accInfo.body?.business?.id
    ? String(accInfo.body.business.id)
    : null;

  if (businessId) {
    if (opts.admin) {
      try {
        await opts.admin.from("platform_facebook_account").update({
          business_id: businessId,
          business_name: accInfo.body?.business?.name || null,
          updated_at: new Date().toISOString(),
        }).eq("id", true);
      } catch (_) { /* ignore */ }
    }
    return {
      ok: true,
      already: true,
      business_id: businessId,
      message: `Ad account já está na Business ${businessId}`,
      steps,
    };
  }

  // 2) Candidatos: preferred + me/businesses
  const me = await g(`/me/businesses?fields=id,name&limit=25`, opts.token);
  const fromMe = ((me.body?.data || []) as Array<{ id: string; name: string }>).map((b) => String(b.id));
  steps.push(`me_businesses:${fromMe.length}`);
  const candidates = [...new Set([
    ...(opts.preferredBusinessId ? [String(opts.preferredBusinessId)] : []),
    ...fromMe,
  ])];

  if (!candidates.length) {
    return {
      ok: false,
      business_id: null,
      message:
        "Nenhuma Business Manager no token. Em business.facebook.com, crie/abra uma empresa e adicione a conta de anúncios (Configurações → Contas de anúncios).",
      steps,
    };
  }

  // 3) Tenta anexar a ad account a cada business
  for (const biz of candidates) {
    const owned = await g(`/${biz}/owned_ad_accounts`, opts.token, {
      method: "POST",
      form: { adaccount_id: acc },
    });
    steps.push(`owned_ad_accounts:${biz}:${owned.ok ? "ok" : owned.body?.error?.message || owned.status}`);
    if (owned.ok) {
      businessId = biz;
      break;
    }

    const client = await g(`/${biz}/client_ad_accounts`, opts.token, {
      method: "POST",
      form: { adaccount_id: acc },
    });
    steps.push(`client_ad_accounts:${biz}:${client.ok ? "ok" : client.body?.error?.message || client.status}`);
    if (client.ok) {
      businessId = biz;
      break;
    }
  }

  if (!businessId) {
    return {
      ok: false,
      business_id: null,
      message:
        "Meta exige Business Manager na conta de anúncios para Custom Audience (erro 1870050). " +
        "Abra business.facebook.com → Configurações → Contas de anúncios → Adicionar " +
        `${acc} à sua empresa, aceite os Termos de Públicos Personalizados, e rode Sincronizar de novo.`,
      steps,
    };
  }

  if (opts.admin) {
    try {
      await opts.admin.from("platform_facebook_account").update({
        business_id: businessId,
        updated_at: new Date().toISOString(),
      }).eq("id", true);
    } catch (_) { /* ignore */ }
  }

  return {
    ok: true,
    attached: true,
    business_id: businessId,
    message: `Ad account anexada à Business ${businessId}`,
    steps,
  };
}
