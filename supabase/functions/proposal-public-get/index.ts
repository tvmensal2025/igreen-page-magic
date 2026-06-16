// =============================================================================
// proposal-public-get — leitura pública de uma proposta pelo token
// =============================================================================
// A página pública /proposta/:token NÃO acessa a tabela direto. Esta função usa
// service_role e identifica a proposta APENAS pelo public_token, devolvendo só
// os campos de exibição (nunca IDs internos sensíveis nem a base de clientes).
//
// Efeito colateral seguro: ao primeiro acesso de uma proposta 'sent', marca como
// 'viewed' e registra o evento. Também expira propostas vencidas no acesso.
//
// Body: { token: string }
// =============================================================================

import { getAdminClient } from "../_shared/admin-client.ts";
import { buildCors } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const { token } = await req.json().catch(() => ({ token: "" }));
    if (!token || typeof token !== "string") {
      return json({ error: "token obrigatório" }, 400);
    }

    const supabase = getAdminClient("proposal-public-get");

    // Expira propostas vencidas antes de ler (best-effort).
    // O query builder do supabase-js é "thenable" mas não expõe .catch() direto,
    // então envolvemos em try/catch para não derrubar a função.
    try {
      await supabase.rpc("expire_overdue_proposals");
    } catch (_e) {
      // best-effort: ignorar falha de expiração não impede a leitura.
    }

    const { data: proposal, error } = await supabase
      .from("proposals")
      .select(
        "id, public_token, consultant_id, product_id, status, amount_cents, amount_period, discount_cents, line_items, message, valid_until, sent_at, viewed_at, responded_at, recipient_name",
      )
      .eq("public_token", token)
      .maybeSingle();

    if (error) return json({ error: "erro ao buscar proposta" }, 500);
    if (!proposal) return json({ error: "Proposta não encontrada" }, 404);

    // Marca como visto no primeiro acesso (sent → viewed) + evento.
    if (proposal.status === "sent") {
      await supabase.from("proposals").update({ status: "viewed" }).eq("id", proposal.id);
      await supabase.from("proposal_events").insert({
        proposal_id: proposal.id,
        type: "viewed",
        actor: "recipient",
      });
      proposal.status = "viewed";
    }

    // Dados de exibição do consultor e do produto (públicos).
    const [{ data: consultant }, { data: product }] = await Promise.all([
      supabase
        .from("consultants_public")
        .select("name, photo_url, igreen_id, license")
        .eq("id", proposal.consultant_id)
        .maybeSingle(),
      supabase
        .from("products")
        .select("slug, name, brand_name, family")
        .eq("id", proposal.product_id)
        .maybeSingle(),
    ]);

    // Eventos visíveis ao destinatário (rodadas de negociação, sem dados internos).
    const { data: events } = await supabase
      .from("proposal_events")
      .select("type, actor, note, counter_amount_cents, attachment_url, created_at")
      .eq("proposal_id", proposal.id)
      .order("created_at", { ascending: true });

    return json({
      proposal: {
        token: proposal.public_token,
        status: proposal.status,
        amountCents: proposal.amount_cents,
        amountPeriod: proposal.amount_period,
        discountCents: proposal.discount_cents,
        lineItems: proposal.line_items,
        message: proposal.message,
        validUntil: proposal.valid_until,
        sentAt: proposal.sent_at,
        respondedAt: proposal.responded_at,
        recipientName: proposal.recipient_name,
      },
      consultant: consultant
        ? {
            name: consultant.name,
            photoUrl: consultant.photo_url,
            igreenId: consultant.igreen_id,
          }
        : null,
      product: product
        ? {
            slug: product.slug,
            name: product.name,
            brandName: product.brand_name,
            family: product.family,
          }
        : null,
      events: events ?? [],
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
