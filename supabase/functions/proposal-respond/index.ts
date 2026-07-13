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

/** Espelha src/features/produtos/orcamento/scoringInput.ts (edge sem import de src/). */
function extractScoringInputFromLineItems(lineItems: unknown): {
  kwh?: number;
  units?: number;
  portabilidade?: boolean;
} {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const scored = items.find(
    (it) => it && typeof it === "object" && (it as { kind?: string }).kind === "scoring_input",
  ) as {
    kwh?: number | null;
    units?: number | null;
    portabilidade?: boolean | null;
    consumo_kwh?: number | null;
  } | undefined;

  if (scored) {
    const kwh =
      typeof scored.kwh === "number" && Number.isFinite(scored.kwh)
        ? scored.kwh
        : typeof scored.consumo_kwh === "number" && Number.isFinite(scored.consumo_kwh)
          ? scored.consumo_kwh
          : undefined;
    return {
      kwh,
      units:
        typeof scored.units === "number" && Number.isFinite(scored.units)
          ? scored.units
          : undefined,
      portabilidade:
        typeof scored.portabilidade === "boolean" ? scored.portabilidade : undefined,
    };
  }

  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const it = raw as { kind?: string; value?: string };
    if (it.kind !== "solar_design" || typeof it.value !== "string") continue;
    const m = it.value.match(/([\d.]+)\s*kWh\/ano/i);
    if (m) {
      const yearly = Number(String(m[1]).replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(yearly) && yearly > 0) {
        return { kwh: Math.round(yearly / 12) };
      }
    }
  }

  let portabilidade: boolean | undefined;
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const it = raw as { label?: string; value?: string };
    if (it.label === "Portabilidade" && typeof it.value === "string") {
      portabilidade = /com portabilidade/i.test(it.value);
    }
  }
  if (portabilidade !== undefined) return { units: 1, portabilidade };
  return {};
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
    // Valor da contraproposta em CENTAVOS inteiros (o front já envia em centavos).
    const counterAmountCents =
      body.counter_amount != null && Number.isFinite(Number(body.counter_amount))
        ? Math.round(Number(body.counter_amount))
        : null;

    if (!token) return json({ error: "token obrigatório" }, 400);
    if (!["accept", "reject", "counter"].includes(action)) {
      return json({ error: "ação inválida" }, 400);
    }

    const supabase = getAdminClient("proposal-respond");

    // Carrega a proposta pelo token (com a regra de pontuação do produto e os
    // dados de exibição para o aviso ao consultor).
    const { data: proposal, error } = await supabase
      .from("proposals")
      .select(
        "id, consultant_id, product_id, customer_id, status, amount_cents, amount_period, valid_until, sale_id, recipient_name, recipient_phone, line_items, products(scoring_rule, name)",
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

    // ── Dados para o aviso ao consultor (nome, produto, valor, telefone) ──
    const prodName =
      (proposal as { products?: { name?: string } }).products?.name ?? "produto iGreen";
    const cliente = (proposal.recipient_name as string | null)?.trim() || "Um cliente";
    // Formata um valor em CENTAVOS inteiros para reais (R$).
    const fmtBRLFromCents = (cents: number | null | undefined) =>
      cents != null
        ? (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
        : null;
    const valorTxt = (() => {
      const v = fmtBRLFromCents(proposal.amount_cents as number | null);
      if (!v) return "";
      return proposal.amount_period === "month" ? `${v}/mês` : v;
    })();
    const fonePart = (() => {
      const raw = (proposal.recipient_phone as string | null) ?? "";
      const d = raw.replace(/\D/g, "").replace(/^55/, "");
      if (d.length === 11) return `\n📱 (${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
      if (d.length === 10) return `\n📱 (${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
      return "";
    })();
    const linhaProduto = `📦 ${prodName}${valorTxt ? ` · ${valorTxt}` : ""}`;

    // ── ACEITAR → cria a venda (sales) ──────────────────────────────────────
    if (action === "accept") {
      let saleId = proposal.sale_id as string | null;

      if (!saleId) {
        const scoringRule = asScoringRule(
          (proposal as { products?: { scoring_rule?: unknown } }).products?.scoring_rule,
        );
        const scoringInput = extractScoringInputFromLineItems(
          (proposal as { line_items?: unknown }).line_items,
        );
        const captureData =
          scoringInput.portabilidade !== undefined
            ? { portabilidade: scoringInput.portabilidade }
            : scoringInput.kwh != null
              ? { consumo_kwh: scoringInput.kwh }
              : {};
        const points = computePointsKwh(scoringRule, {
          kwh: scoringInput.kwh,
          units: scoringInput.units ?? 1,
          portabilidade: scoringInput.portabilidade,
        });

        const { data: sale, error: saleErr } = await supabase
          .from("sales")
          .insert({
            consultant_id: proposal.consultant_id,
            product_id: proposal.product_id,
            customer_id: proposal.customer_id,
            status: "fechado",
            amount_cents: proposal.amount_cents,
            points_kwh: points,
            capture_data: captureData,
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
        "✅ Proposta ACEITA!",
        `${cliente} aceitou sua proposta.\n${linhaProduto}${fonePart}\n\nO negócio foi marcado como FECHADO no painel de Produtos → Pipeline.\n\n⚠️ Próximo passo: faça o cadastro oficial do cliente no sistema da empresa iGreen. O acompanhamento aqui termina no aceite — o contrato, a ativação e o pagamento são feitos lá.`,
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
        "❌ Proposta recusada",
        `${cliente} recusou sua proposta.\n${linhaProduto}${fonePart}\n\nVale um follow-up: veja os detalhes no painel de Orçamentos.`,
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
      counter_amount_cents: counterAmountCents,
    });
    await notifyConsultant(
      proposal.consultant_id,
      "info",
      "📎 Proposta concorrente recebida",
      `${cliente} respondeu com uma proposta concorrente.\n${linhaProduto}${fonePart}\n\n` +
        (counterAmountCents != null ? `💰 Valor citado: ${fmtBRLFromCents(counterAmountCents)}\n` : "") +
        (note ? `💬 "${note.slice(0, 200)}"\n` : "") +
        (attachmentUrl ? `📄 Anexo enviado\n` : "") +
        `\nResponda no painel de Orçamentos para tentar cobrir a oferta.`,
    ).catch(() => {});

    return json({ ok: true, status: "countered" });
  } catch (e) {
    console.error("[proposal-respond] erro:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
