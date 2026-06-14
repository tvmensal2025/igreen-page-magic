// =============================================================================
// proposal-respond — resposta pública a uma proposta (aceitar/recusar/contrapor)
// =============================================================================
// A página pública /proposta/:token chama esta função para registrar a resposta
// do destinatário. Acesso só pelo public_token (service_role, bypass de RLS).
//
// Ações:
//   - accept:  marca a proposta como aceita e CRIA a venda (sales) com pontos
//   - reject:  marca como recusada
//   - counter: registra contraproposta (valor + anexo opcional) e volta ao
//              consultor (status 'countered')
//
// Em todos os casos registra um proposal_event e notifica o consultor.
// =============================================================================

import { buildCors } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/admin-client.ts";
import { notifyConsultant } from "../_shared/notify-consultant.ts";

// ── Scoring local (edge não importa do src/) — espelha vendas/scoring.ts ──
type ScoringRule =
  | { mode: "contracted_kwh"; multiplier: number }
  | { mode: "proposal_kwh"; multiplier: number; validity_months?: number }
  | { mode: "fixed_per_unit"; kwh_per_unit: number; only_portability?: boolean }
  | { mode: "none" };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computePointsKwh(
  rule: ScoringRule,
  input: { kwh?: number; units?: number; portabilidade?: boolean },
): number {
  switch (rule.mode) {
    case "contracted_kwh":
      return round2((input.kwh ?? 0) * rule.multiplier);
    case "proposal_kwh":
      return round2((input.kwh ?? 0) * rule.multiplier);
    case "fixed_per_unit": {
      if (rule.only_portability && input.portabilidade !== true) return 0;
      return round2((input.units ?? 1) * rule.kwh_per_unit);
    }
    case "none":
    default:
      return 0;
  }
}

function asScoringRule(value: unknown): ScoringRule {
  if (value && typeof value === "object" && "mode" in value) {
    return value as ScoringRule;
  }
  return { mode: "none" };
}

type Action = "accept" | "reject" | "counter";

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token ?? "").trim();
    const action = String(body.action ?? "").trim() as Action;
    const note = body.note ? String(body.note).slice(0, 2000) : null;
    const attachmentUrl = body.attachment_url ? String(body.attachment_url) : null;
    const counterAmount =
      body.counter_amount != null && Number.isFinite(Number(body.counter_amount))
        ? Number(body.counter_amount)
        : null;

    if (!token) return json({ error: "token obrigatório" }, 400);
    if (!["accept", "reject", "counter"].includes(action)) {
      return json({ error: "ação inválida" }, 400);
    }

    const supabase = getAdminClient("proposal-respond");

    // Carrega a proposta pelo token (com a regra de pontuação do produto).
    const { data: proposal, error } = await supabase
      .from("proposals")
      .select(
        "id, consultant_id, product_id, customer_id, status, amount, valid_until, sale_id, products(scoring_rule)",
      )
      .eq("public_token", token)
      .maybeSingle();

    if (error) throw error;
    if (!proposal) return json({ error: "proposta não encontrada" }, 404);

    // Estados finais não aceitam nova resposta.
    if (["accepted", "rejected", "expired"].includes(proposal.status)) {
      return json({ error: "proposta já finalizada", status: proposal.status }, 409);
    }

    // Validade.
    if (proposal.valid_until && new Date(proposal.valid_until).getTime() < Date.now()) {
      await supabase.from("proposals").update({ status: "expired" }).eq("id", proposal.id);
      return json({ error: "proposta expirada", status: "expired" }, 409);
    }

    // ── ACEITAR → cria a venda (sales) ──────────────────────────────────────
    if (action === "accept") {
      let saleId = proposal.sale_id as string | null;

      if (!saleId) {
        const scoringRule = asScoringRule(
          (proposal as { products?: { scoring_rule?: unknown } }).products?.scoring_rule,
        );
        // Base de pontos: para energia/placas usa o valor como proxy de kWh só
        // quando não há dado melhor; telecom conta 1 unidade. O consultor ajusta
        // os pontos reais depois, na venda (capture_data).
        const points = computePointsKwh(scoringRule, { units: 1 });

        const { data: sale, error: saleErr } = await supabase
          .from("sales")
          .insert({
            consultant_id: proposal.consultant_id,
            product_id: proposal.product_id,
            customer_id: proposal.customer_id,
            status: "capturing",
            amount: proposal.amount,
            points_kwh: points,
            notes: "Criada a partir de proposta aceita pelo cliente.",
          })
          .select("id")
          .single();
        if (saleErr) throw saleErr;
        saleId = sale.id;
      }

      await supabase
        .from("proposals")
        .update({ status: "accepted", sale_id: saleId })
        .eq("id", proposal.id);

      await supabase.from("proposal_events").insert({
        proposal_id: proposal.id,
        type: "accepted",
        actor: "recipient",
        note,
      });

      await notifyConsultant(
        proposal.consultant_id,
        "info",
        "Proposta aceita!",
        "Um cliente aceitou sua proposta. A venda foi criada e está em captura no painel.",
      ).catch(() => {});

      return json({ ok: true, status: "accepted" });
    }

    // ── RECUSAR ─────────────────────────────────────────────────────────────
    if (action === "reject") {
      await supabase.from("proposals").update({ status: "rejected" }).eq("id", proposal.id);
      await supabase.from("proposal_events").insert({
        proposal_id: proposal.id,
        type: "rejected",
        actor: "recipient",
        note,
      });
      await notifyConsultant(
        proposal.consultant_id,
        "warning",
        "Proposta recusada",
        "Um cliente recusou sua proposta. Veja os detalhes no painel.",
      ).catch(() => {});
      return json({ ok: true, status: "rejected" });
    }

    // ── CONTRAPROPOR (valor + anexo opcional) ───────────────────────────────
    await supabase.from("proposals").update({ status: "countered" }).eq("id", proposal.id);
    await supabase.from("proposal_events").insert({
      proposal_id: proposal.id,
      type: "countered",
      actor: "recipient",
      note,
      attachment_url: attachmentUrl,
      counter_amount: counterAmount,
    });
    await notifyConsultant(
      proposal.consultant_id,
      "info",
      "Contraproposta recebida",
      counterAmount != null
        ? `O cliente propôs R$ ${counterAmount.toFixed(2)}. Veja no painel para responder.`
        : "O cliente enviou uma contraproposta. Veja no painel para responder.",
    ).catch(() => {});

    return json({ ok: true, status: "countered" });
  } catch (e) {
    console.error("[proposal-respond] erro:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
