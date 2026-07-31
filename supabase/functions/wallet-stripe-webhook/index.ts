// Webhook público (sem JWT) que recebe checkout.session.completed da Stripe
// e credita o saldo do consultor de forma idempotente.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "stripe-signature, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const whSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!stripeKey || !whSecret) return new Response("not configured", { status: 503 });

    const sig = req.headers.get("stripe-signature");
    if (!sig) return new Response("missing signature", { status: 400 });

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });
    const raw = await req.text();
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(raw, sig, whSecret);
    } catch (e) {
      console.error("[wallet-webhook] bad signature", (e as Error).message);
      return new Response("invalid signature", { status: 400 });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const consultantId = session.metadata?.consultant_id;
      // amount_total é o valor cobrado do cliente (sempre o que recebemos bruto)
      const amountCents = Number(session.amount_total || session.metadata?.amount_cents || 0);
      if (consultantId && amountCents > 0) {
        const admin = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        // Calcula taxa Stripe efetiva consultando o PaymentIntent (charge.balance_transaction.fee)
        let stripeFeeCents = 0;
        let amountReceivedCents = amountCents;
        try {
          if (typeof session.payment_intent === "string") {
            const pi = await stripe.paymentIntents.retrieve(session.payment_intent, {
              expand: ["latest_charge.balance_transaction"],
            });
            const charge = pi.latest_charge as Stripe.Charge | null;
            const bt = (charge?.balance_transaction as Stripe.BalanceTransaction | null);
            if (bt) {
              stripeFeeCents = Number(bt.fee || 0);
              amountReceivedCents = Number(bt.net || amountCents);
            }
          }
        } catch (fe) { console.error("[wallet-webhook] fee lookup failed", (fe as Error).message); }

        // Credita o LÍQUIDO recebido (não o bruto cobrado) — isso garante que
        // a margem da plataforma cubra as taxas Stripe sem prejuízo.
        await admin.rpc("credit_consultant_wallet", {
          _consultant_id: consultantId,
          _amount_cents: amountReceivedCents,
          _stripe_session_id: session.id,
          _stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
          _description: `Recarga Stripe (bruto R$ ${(amountCents/100).toFixed(2)} - fee R$ ${(stripeFeeCents/100).toFixed(2)})`,
          _metadata: { stripe_event_id: event.id, gross_cents: amountCents, fee_cents: stripeFeeCents },
          _stripe_fee_cents: stripeFeeCents,
        });
        // Realinha spend_cap das campanhas com o saldo novo + reativa as pausadas por saldo
        try {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/facebook-realign-lifetime`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ consultant_id: consultantId, reactivate: true }),
          });
        } catch (re) { console.error("[wallet-webhook] realign failed", (re as Error).message); }
      }
    }

    // Estorno (chargeback ou refund) — debita o saldo de volta
    if (event.type === "charge.refunded" || event.type === "charge.dispute.funds_withdrawn") {
      const charge = event.data.object as Stripe.Charge;
      const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const refundCents = Number(charge.amount_refunded || charge.amount || 0);
      // Busca a transação original pra achar o consultor + session_id
      const { data: orig } = piId
        ? await admin.from("wallet_transactions")
          .select("consultant_id,stripe_session_id,amount_cents")
          .eq("stripe_payment_intent_id", piId)
          .eq("type", "topup")
          .maybeSingle()
        : { data: null };
      if (orig?.consultant_id) {
        await admin.rpc("refund_consultant_wallet", {
          _consultant_id: orig.consultant_id,
          _amount_cents: refundCents,
          _stripe_session_id: orig.stripe_session_id,
          _stripe_payment_intent_id: piId,
          _description: event.type === "charge.refunded" ? "Estorno Stripe" : "Chargeback Stripe",
        });
      } else {
        // Nunca engolir um estorno: sem transação original o saldo fica inflado.
        console.error("[wallet-stripe-webhook] estorno sem transação original", { piId, event: event.type });
        try {
          await sendSuperAdminAlert(admin, {
            key: `stripe_refund_orphan:${piId ?? charge.id}`,
            severity: "critical",
            text: `⚠️ Estorno Stripe SEM transação original.\nEvento: ${event.type}\nPaymentIntent: ${piId ?? "—"}\nCharge: ${charge.id}\nValor: R$ ${(refundCents / 100).toFixed(2)}\nAjuste a carteira manualmente.`,
          });
        } catch (alertErr) {
          console.error("[wallet-stripe-webhook] falha ao alertar superadmin", alertErr);
        }
      }
    }


    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[wallet-stripe-webhook]", err);
    return new Response((err as Error).message, { status: 500 });
  }
});