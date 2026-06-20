// Credita saldo manualmente na carteira de um consultor (pagamento em dinheiro).
// Apenas Super Admin pode aprovar/creditar. Quita débito primeiro, sobra vai pro saldo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_CENTS = 100;        // R$ 1
const MAX_CENTS = 1_000_000;  // R$ 10.000

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    // Confere papel admin via RPC has_role
    const { data: isAdmin, error: roleErr } = await userClient.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });
    if (roleErr || !isAdmin) return json({ error: "Apenas Super Admin pode creditar saldo." }, 403);

    const body = await req.json().catch(() => ({}));
    const consultantId: string = String(body.consultant_id || "");
    const amountCents = Math.floor(Number(body.amount_cents || 0));
    const note: string | null = body.note ? String(body.note).slice(0, 500) : null;
    const requestId: string | null = body.request_id ? String(body.request_id) : null;
    const action: "approve" | "reject" = body.action === "reject" ? "reject" : "approve";

    if (!consultantId) return json({ error: "consultant_id obrigatório" }, 400);
    if (action === "approve") {
      if (!Number.isFinite(amountCents) || amountCents < MIN_CENTS || amountCents > MAX_CENTS) {
        return json({ error: `Valor inválido (R$ ${MIN_CENTS/100} a R$ ${MAX_CENTS/100})` }, 400);
      }
    }

    // Usa service_role para escrever na carteira ignorando RLS
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "reject" && requestId) {
      await admin.from("wallet_manual_topup_requests").update({
        status: "rejected",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        rejection_reason: note || "Rejeitado pelo Super Admin",
      }).eq("id", requestId);
      return json({ ok: true, action: "rejected" });
    }

    // Lê carteira atual
    const { data: wallet } = await admin
      .from("consultant_wallet")
      .select("balance_cents, debt_cents, total_topped_up_cents")
      .eq("consultant_id", consultantId)
      .maybeSingle();

    const curBalance = wallet?.balance_cents ?? 0;
    const curDebt = wallet?.debt_cents ?? 0;
    const curToppedUp = wallet?.total_topped_up_cents ?? 0;

    // Quita débito primeiro, sobra vai pro saldo
    const debtPayment = Math.min(curDebt, amountCents);
    const remaining = amountCents - debtPayment;
    const newBalance = curBalance + remaining;
    const newDebt = curDebt - debtPayment;

    if (wallet) {
      await admin.from("consultant_wallet").update({
        balance_cents: newBalance,
        debt_cents: newDebt,
        total_topped_up_cents: curToppedUp + amountCents,
        updated_at: new Date().toISOString(),
      }).eq("consultant_id", consultantId);
    } else {
      await admin.from("consultant_wallet").insert({
        consultant_id: consultantId,
        balance_cents: newBalance,
        debt_cents: newDebt,
        total_topped_up_cents: amountCents,
      });
    }

    const description = `Crédito manual Super Admin — R$ ${(amountCents/100).toFixed(2)} (pago em dinheiro)${note ? ` • ${note}` : ""}`;
    const { data: tx } = await admin.from("wallet_transactions").insert({
      consultant_id: consultantId,
      type: "topup",
      amount_cents: amountCents,
      balance_after_cents: newBalance,
      description,
      metadata: { source: "manual_cash", granted_by: user.id, request_id: requestId, debt_paid_cents: debtPayment },
    }).select("id").single();

    // Reativa campanhas pausadas se saldo voltou
    if (newBalance > 0 && newDebt === 0) {
      await admin.from("facebook_campaigns").update({ pause_pending: false })
        .eq("consultant_id", consultantId)
        .eq("pause_pending", true);
    }

    if (requestId) {
      await admin.from("wallet_manual_topup_requests").update({
        status: "approved",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        wallet_transaction_id: tx?.id ?? null,
      }).eq("id", requestId);
    }

    return json({ ok: true, balance_cents: newBalance, debt_cents: newDebt, transaction_id: tx?.id });
  } catch (err) {
    console.error("[wallet-manual-credit]", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
