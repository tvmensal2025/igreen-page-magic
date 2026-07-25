// Reconciliação diária: compara gasto da Meta com o total debitado e REGISTRA
// a divergência para revisão humana (`ads_spend_reconciliation_log`, 1 linha por
// dia). Nunca ajusta carteira: a cobrança correta é feita por
// `debit_campaign_spend_observation` no facebook-sync-metrics.
import {
  adminClient,
  authConsultant,
  fbRead,
  loadPlatformAccount,
} from "../_shared/fb-graph.ts";
import {
  assertCronAuthStrict,
  cronAuthUnauthorized,
} from "../_shared/cron-auth.ts";
import { buildCors } from "../_shared/cors.ts";

function json(cors: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function toCents(value: unknown) {
  const parsed = typeof value === "string"
    ? parseInt(value, 10)
    : typeof value === "number"
    ? value
    : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

Deno.serve(async (req) => {
  const cors = buildCors(req, "x-service-secret, x-internal-secret");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = adminClient();
    const cronAuth = await assertCronAuthStrict(req, admin);
    if (!cronAuth.ok) {
      const caller = await authConsultant(req);
      if (!caller) return cronAuthUnauthorized(cronAuth.reason, cors);
      const { data: superAdmin } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("user_id", caller.id)
        .eq("role", "super_admin")
        .maybeSingle();
      if (!superAdmin) {
        return json(cors, { ok: false, error: "forbidden" }, 403);
      }
    }

    const platform = await loadPlatformAccount();
    if (!platform) {
      return json(cors, { ok: false, reason: "no_platform_account" });
    }

    const acc = await fbRead(
      `/${platform.ad_account_id}?fields=amount_spent,currency&access_token=${platform.token}`,
    ).catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
    if ((acc as any).error) {
      return json(cors, { ok: false, error: (acc as any).error });
    }

    const metaLifetimeCents = toCents((acc as any).amount_spent);
    const { data: rows } = await admin
      .from("wallet_transactions")
      .select("amount_cents,gross_spend_cents")
      .eq("type", "spend");
    const systemLifetimeCents = ((rows as any[]) || [])
      .reduce(
        (sum, row) =>
          sum + Number(row.gross_spend_cents ?? row.amount_cents ?? 0),
        0,
      );

    const delta = metaLifetimeCents - systemLifetimeCents;
    const result: Record<string, unknown> = {
      ok: true,
      meta_lifetime_cents: metaLifetimeCents,
      system_lifetime_cents: systemLifetimeCents,
      delta_cents: delta,
      currency: (acc as any).currency ?? "BRL",
      // Mantido em `false` por compatibilidade de contrato: esta função nunca
      // ajusta carteira automaticamente.
      adjusted: false,
    };

    // O fluxo anterior inseria uma transação `type='spend'` no ledger de um
    // super admin qualquer, sem debitar carteira nenhuma: criava dívida
    // fantasma no extrato e distorcia o próprio total do sistema. Agora a
    // divergência é apenas REGISTRADA (1 linha por dia, idempotente) para
    // revisão humana. Ajuste de carteira nunca é automático.
    const reconciledDate = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Sao_Paulo",
    });
    const { data: recordRaw, error: recordError } = await admin.rpc(
      "record_ads_spend_reconciliation",
      {
        _reconciled_date: reconciledDate,
        _meta_lifetime_cents: metaLifetimeCents,
        _system_lifetime_cents: systemLifetimeCents,
        _currency: String((acc as any).currency ?? "BRL"),
      },
    );
    if (recordError) {
      console.error("[fb-balance-reconcile] record", recordError.message);
      result.recorded = false;
    } else {
      const record = (recordRaw ?? {}) as Record<string, unknown>;
      result.recorded = record.recorded === true;
      result.requires_review = record.requires_review === true;
    }
    result.reconciled_date = reconciledDate;

    return json(cors, result);
  } catch (error) {
    console.error("[fb-balance-reconcile]", error);
    return json(cors, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
