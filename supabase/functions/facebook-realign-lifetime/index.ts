// Reajusta o spend_cap (lifetime cap) das campanhas ATIVAS de um consultor de acordo
// com o saldo atual da carteira. Chamado após recarga (Stripe webhook) ou quando o
// consultor escolhe aumentar o orçamento no popup.
//
// Fórmula: cap = (gasto_atual_meta) + (saldo_disponivel / (1 + fee%))
// Assim a Meta sabe exatamente o quanto pode gastar a mais do que já gastou.
//
// Reativação após recarga: SÓ campanhas auto-pausadas por saldo/teto.
// Pausa MANUAL do consultor (MANUAL_PAUSE) NUNCA é reativada aqui.
import {
  adminClient,
  authConsultant,
  fbFetch,
  loadCampaignConnection,
} from "../_shared/fb-graph.ts";
import { buildCors } from "../_shared/cors.ts";
import { isAdsActionAllowedForConfig } from "../_shared/brain-config.ts";
import {
  isAutoBalancePause,
  isConsultantLocked,
} from "../_shared/campaign-pause.ts";
import {
  type MetaObjectState,
  resolveCampaignEffectiveStatus,
} from "../_shared/campaign-effective-status.ts";
import { validateCampaignActivationBudget } from "../_shared/validate-campaign-activation.ts";
import { validateRodizioActivation } from "../_shared/validate-rodizio-activation.ts";

function json(req: Request, body: unknown, status = 200) {
  const cors = buildCors(req);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function toCents(v: unknown) {
  const n = typeof v === "string"
    ? parseFloat(v)
    : typeof v === "number"
    ? v
    : 0;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

async function setMetaStatus(
  id: string,
  token: string,
  status: "ACTIVE" | "PAUSED",
) {
  await fbFetch(`/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ status, access_token: token }),
  });
}

async function getMetaState(
  id: string,
  token: string,
): Promise<MetaObjectState> {
  return fbFetch(
    `/${id}?fields=effective_status,configured_status,issues_info&access_token=${
      encodeURIComponent(token)
    }`,
  );
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    let consultantId: string | null = null;
    const authHeader = req.headers.get("Authorization") || "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const isService = authHeader === `Bearer ${serviceRole}`;

    const body = await req.json().catch(() => ({}));
    if (isService) {
      consultantId = body?.consultant_id ?? null;
    } else {
      const auth = await authConsultant(req);
      if (!auth) return json(req, { error: "Unauthorized" }, 401);
      consultantId = auth.id;
    }
    if (!consultantId) {
      return json(req, { error: "consultant_id required" }, 400);
    }

    const reactivate = !!body?.reactivate;

    const admin = adminClient();
    if (isService) {
      const { data: settings } = await admin
        .from("consultant_ad_settings")
        .select("brain_config")
        .eq("consultant_id", consultantId)
        .maybeSingle();
      // Realinhar `spend_cap`/teto altera quanto a Meta pode gastar: é ação
      // `budget_scale` na policy central. Chamada service-to-service exige
      // modo explícito; o clique do consultor (JWT) não passa por aqui.
      if (
        !isAdsActionAllowedForConfig(settings?.brain_config, "budget_scale")
      ) {
        return json(req, {
          ok: true,
          skipped: "ads_automation_disabled",
          consultant_id: consultantId,
        });
      }
    }
    const { data: ps } = await admin.from("platform_settings").select("*").eq(
      "id",
      true,
    ).maybeSingle();
    const feePct = Number(ps?.platform_fee_percent ?? 20) / 100;

    const { data: wallet } = await admin.from("consultant_wallet")
      .select("balance_cents,debt_cents").eq("consultant_id", consultantId)
      .maybeSingle();
    const balance = Number(wallet?.balance_cents ?? 0);
    const debt = Number(wallet?.debt_cents ?? 0);
    // Saldo líquido (já descontada eventual dívida)
    const liquid = Math.max(0, balance - debt);
    // Quanto a Meta pode gastar a mais (descontando nosso markup)
    const extraMetaBudgetCents = Math.floor(liquid / (1 + feePct));

    const { data: camps } = await admin
      .from("facebook_campaigns")
      .select(
        "id, fb_campaign_id, fb_adset_ids, fb_ad_ids, status, lifetime_cap_cents, daily_budget_cents, duration_days, end_time_utc, rejection_reason",
      )
      .eq("consultant_id", consultantId)
      .in("status", ["active", "paused", "pending_review"]);

    const updated: any[] = [];
    const errors: any[] = [];
    const skippedManual: string[] = [];

    // RATEIO ANTI-PREJUÍZO aplica spend_cap somente às campanhas contínuas.
    // Campanhas com prazo já têm lifetime_budget e não aceitam spend_cap.
    const eligible = (camps || []).filter((c: any) => c.fb_campaign_id);
    const continuous = eligible.filter((c: any) =>
      !(Number(c.duration_days || 0) > 0)
    );
    const denom = Math.max(1, continuous.length);
    const perCampaignExtra = Math.floor(extraMetaBudgetCents / denom);

    for (const c of eligible) {
      try {
        const conn = await loadCampaignConnection(consultantId);
        if (!conn?.token) {
          errors.push({ id: c.id, error: "missing_platform_token" });
          continue;
        }

        let currentSpendCents = 0;
        try {
          const r = await fbFetch(
            `/${c.fb_campaign_id}/insights?fields=spend&date_preset=maximum&access_token=${conn.token}`,
          );
          currentSpendCents = toCents(r?.data?.[0]?.spend || 0);
        } catch (_) {}

        const fixedDuration = Number(c.duration_days || 0) > 0;
        const newCap = fixedDuration
          ? Number(
            c.lifetime_cap_cents ||
              Number(c.daily_budget_cents) * Number(c.duration_days),
          )
          : Math.max(30000, currentSpendCents + perCampaignExtra);
        let metaBudgetApplied = fixedDuration;

        if (!fixedDuration) {
          try {
            await fbFetch(`/${c.fb_campaign_id}`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                spend_cap: String(newCap),
                access_token: conn.token,
              }),
            });
            metaBudgetApplied = true;
          } catch (e) {
            errors.push({
              id: c.id,
              error: `Meta spend_cap update: ${(e as Error).message}`,
            });
          }
        }

        const updates: any = {
          pause_pending: false,
          updated_at: new Date().toISOString(),
        };
        if (!fixedDuration && metaBudgetApplied) {
          updates.lifetime_cap_cents = newCap;
        }

        const canReactivate = reactivate &&
          c.status === "paused" &&
          balance > 0 &&
          debt === 0 &&
          !isConsultantLocked(c.rejection_reason) &&
          isAutoBalancePause(c.rejection_reason);

        if (
          reactivate && c.status === "paused" &&
          isConsultantLocked(c.rejection_reason)
        ) {
          skippedManual.push(c.id);
        } else if (canReactivate) {
          const remainingDays = c.end_time_utc
            ? Math.max(
              1,
              Math.ceil(
                (new Date(c.end_time_utc).getTime() - Date.now()) / 86400_000,
              ),
            )
            : null;
          const activationBudget = await validateCampaignActivationBudget(
            admin,
            {
              consultantId,
              dailyBudgetCents: Number(c.daily_budget_cents),
              durationDays: remainingDays,
            },
          );
          const rodizio = activationBudget.ok
            ? await validateRodizioActivation(admin, c.id, consultantId)
            : { ok: false, error: activationBudget.error };
          if (!rodizio.ok) {
            errors.push({
              id: c.id,
              error: rodizio.error || "activation_blocked",
            });
          } else {
            try {
              const adsetIds = (c.fb_adset_ids || []) as string[];
              const adIds = (c.fb_ad_ids || []) as string[];
              for (const id of adsetIds) {
                await setMetaStatus(id, conn.token, "ACTIVE");
              }
              for (const id of adIds) {
                await setMetaStatus(id, conn.token, "ACTIVE");
              }
              await setMetaStatus(c.fb_campaign_id, conn.token, "ACTIVE");

              const [campaignState, ...children] = await Promise.all([
                getMetaState(c.fb_campaign_id, conn.token),
                ...adsetIds.map((id) => getMetaState(id, conn.token)),
                ...adIds.map((id) => getMetaState(id, conn.token)),
              ]);
              const resolved = resolveCampaignEffectiveStatus(
                campaignState,
                children.slice(0, adsetIds.length),
                children.slice(adsetIds.length),
              );
              if (resolved.localStatus !== "active") {
                throw new Error(
                  `effective_status=${resolved.objectStatuses.join(",")}`,
                );
              }
              updates.status = "active";
              updates.rejection_reason = null;
            } catch (e) {
              errors.push({
                id: c.id,
                error: `reactivate: ${(e as Error).message}`,
              });
            }
          }
        }

        const { error: updateError } = await admin.from("facebook_campaigns")
          .update(updates).eq("id", c.id);
        if (updateError) {
          errors.push({ id: c.id, error: updateError.message });
          continue;
        }
        updated.push({
          id: c.id,
          budget_model: fixedDuration ? "lifetime_budget" : "spend_cap",
          new_cap_cents: newCap,
          current_spend_cents: currentSpendCents,
        });
      } catch (e) {
        errors.push({ id: c.id, error: (e as Error).message });
      }
    }

    return json(req, {
      ok: true,
      consultant_id: consultantId,
      extra_meta_budget_cents: extraMetaBudgetCents,
      updated,
      skipped_manual_pause: skippedManual,
      errors,
    });
  } catch (err) {
    console.error("[fb-realign-lifetime]", err);
    return json(req, { error: (err as Error).message }, 500);
  }
});
