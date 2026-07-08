// Pré-voo da campanha: valida token, conta, número WA, e pede reach estimate à Meta.
// Retorna issues bloqueantes + estimativa de alcance — chamado antes de publicar.
import { authConsultant, corsHeaders, FB_GRAPH, fbFetch, loadCampaignConnection } from "../_shared/fb-graph.ts";
import { resolveWabaPhone } from "../_shared/resolve-waba-phone.ts";

interface PreflightBody {
  cities?: { key: string; name: string }[];
  custom_locations?: {
    latitude: number;
    longitude: number;
    radius: number; // km
    address_string?: string;
    name?: string;
  }[];
  daily_budget_cents?: number;
  age_min?: number;
  age_max?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authConsultant(req);
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const conn = await loadCampaignConnection(auth.id);
    if (!conn) return json({ ok: false, blockers: ["Conta principal de anúncios em sincronização. Tente novamente em instantes."], warnings: [], reach: null }, 200);

    const body = (await req.json().catch(() => ({}))) as PreflightBody;
    const blockers: string[] = [];
    const warnings: string[] = [];

    // 1. Token vivo?
    try {
      const tk = await fbFetch(`/debug_token?input_token=${conn.token}&access_token=${conn.token}`);
      const exp = tk?.data?.expires_at as number | undefined;
      if (exp && exp > 0) {
        const daysLeft = Math.floor((exp * 1000 - Date.now()) / 86400_000);
        if (daysLeft < 0) {
          blockers.push("Token do Facebook expirou — reconecte sua conta");
          return json({ ok: false, blockers, warnings, reach: null });
        }
        if (daysLeft < 7) warnings.push(`Token do Facebook expira em ${daysLeft} dias — reconecte logo`);
      }
      if (tk?.data?.is_valid === false) {
        blockers.push("Token do Facebook inválido — reconecte sua conta");
        return json({ ok: false, blockers, warnings, reach: null });
      }
    } catch (e) {
      blockers.push("Token do Facebook expirou — reconecte sua conta");
      return json({ ok: false, blockers, warnings, reach: null });
    }

    // 2. Página + WhatsApp number presente
    if (!conn.page_id) blockers.push("Página do Facebook não selecionada");
    if (!conn.whatsapp_destination_number) blockers.push("Número de WhatsApp de destino não configurado");

    // 3. Ad account ativo + payment + spend cap
    try {
      const acct = await fbFetch(`/${conn.ad_account_id}?fields=account_status,disable_reason,currency,funding_source,balance,spend_cap,amount_spent&access_token=${conn.token}`);
      if (acct?.account_status && ![1, 9, 201].includes(Number(acct.account_status))) {
        const reasonMap: Record<number, string> = { 2: "desativada", 3: "não confirmada", 7: "em revisão", 8: "pendente fechamento", 9: "em revisão pelo Meta", 100: "pendente revisão de pagamento", 101: "fechada", 201: "qualquer revisão" };
        blockers.push(`Conta de anúncios ${reasonMap[acct.account_status] || `status ${acct.account_status}`}`);
      }
      const hasPrepaidSignal = Number(acct?.balance ?? 0) > 0 || Number(acct?.spend_cap ?? 0) > 0;
      if (!acct?.funding_source && !hasPrepaidSignal) {
        warnings.push("Não confirmei a forma de pagamento da conta principal; a publicação seguirá e o Meta valida na entrega.");
      }
      if (acct?.spend_cap && acct?.amount_spent) {
        const remaining = (Number(acct.spend_cap) - Number(acct.amount_spent)) / 100;
        if (remaining < 50) warnings.push(`Limite de gasto da conta quase no fim (R$${remaining.toFixed(2)} restantes)`);
      }
    } catch (e) {
      warnings.push("Não foi possível validar status da conta de anúncios");
    }

    // 4. WABA + número. Fonte da verdade = phone_numbers vivos da WABA.
    // Bloqueia se: sem WABA na Página, ou sem número vinculado, ou número salvo não bate.
    let resolvedPhone: { id: string; display: string; digits: string } | null = null;
    let wabaNumbers: Array<{ id: string; display: string; digits: string }> = [];
    if (conn.page_id) {
      try {
        const waba = await resolveWabaPhone(auth.id, { persist: true });
        wabaNumbers = waba.numbers.map((n) => ({ id: n.id, display: n.display, digits: n.digits }));
        if (waba.ok && waba.chosen) {
          if (/^\d+$/.test(waba.chosen.id)) {
            resolvedPhone = { id: waba.chosen.id, display: waba.chosen.display, digits: waba.chosen.digits };
          } else {
            blockers.push(`O número ${waba.chosen.digits} está salvo, mas não tem phone_number_id real da Meta. Copie o ID numérico no WhatsApp Manager ou vincule a WABA correta à Página antes de publicar.`);
          }
        } else if (waba.reason === "no_waba") {
          blockers.push(waba.hint || "A Página do Facebook não tem WhatsApp Business (WABA) vinculado. Vincule em Meta Business Suite → WhatsApp → Contas.");
        } else if (waba.reason === "no_numbers") {
          blockers.push("Nenhum número está registrado na WhatsApp Business da Página. Registre em Meta Business Suite → WhatsApp Manager.");
        } else if (waba.reason === "no_match") {
          const opts = waba.numbers.map((n) => n.display).join(", ");
          blockers.push(`Seu número não bate com nenhum registrado na WABA. Disponíveis: ${opts}. Escolha um em Anúncios → Configurações.`);
        }
      } catch (e) {
        warnings.push(`Não foi possível verificar o número WhatsApp Business: ${(e as Error).message}`);
      }
    }


    // 5. Pixel vivo (recebeu evento nos últimos 7 dias)?
    if (conn.pixel_id) {
      try {
        const px = await fbFetch(`/${conn.pixel_id}?fields=last_fired_time,is_unavailable&access_token=${conn.token}`);
        if (px?.is_unavailable) warnings.push("Pixel marcado como indisponível pelo Meta");
        if (px?.last_fired_time) {
          const ageH = (Date.now() - new Date(px.last_fired_time).getTime()) / 3_600_000;
          if (ageH > 168) warnings.push(`Pixel sem eventos há ${Math.round(ageH / 24)} dias — não vai otimizar bem`);
        } else {
          warnings.push("Pixel nunca disparou — eventos do site não estão chegando");
        }
      } catch (_) { /* não crítico */ }
    }

    // 6. Reach estimate (não bloqueante)
    let reach: { lower: number; upper: number; daily_min: number; daily_max: number } | null = null;
    const hasCustom = Array.isArray(body.custom_locations) && body.custom_locations.length > 0;
    const hasCities = Array.isArray(body.cities) && body.cities.length > 0;
    if ((hasCustom || hasCities) && blockers.length === 0) {
      try {
        const geo: Record<string, unknown> = {};
        if (hasCustom) {
          geo.custom_locations = body.custom_locations!.slice(0, 200).map((p) => ({
            latitude: p.latitude,
            longitude: p.longitude,
            radius: Math.max(1, Math.min(50, Math.round(p.radius))),
            distance_unit: "kilometer",
            ...(p.address_string ? { address_string: p.address_string } : {}),
          }));
        } else {
          geo.cities = body.cities!.map((c) => ({ key: c.key })).slice(0, 200);
        }
        const ageMin = Math.min(body.age_min ?? 25, 25);
        const ageMax = Math.max(body.age_max ?? 65, 65);
        const targeting: Record<string, unknown> = {
          geo_locations: geo,
          age_min: ageMin,
          age_max: ageMax,
          targeting_automation: { advantage_audience: 1 },
        };
        // Usa o número autoritativo resolvido no passo 4 (sem adivinhar formatos).
        const promotedObject = conn.page_id && resolvedPhone
          ? { page_id: conn.page_id, whatsapp_phone_number: resolvedPhone.digits }
          : null;
        const params = new URLSearchParams({
          targeting_spec: JSON.stringify(targeting),
          optimization_goal: "CONVERSATIONS",
          access_token: conn.token,
        });
        if (promotedObject) {
          params.set("destination_type", "WHATSAPP");
          params.set("promoted_object", JSON.stringify(promotedObject));
        }
        const url = `${FB_GRAPH}/${conn.ad_account_id}/reachestimate?${params.toString()}`;
        const r = await fbFetch(url);
        const est = r?.data || r;
        const lower = Number(est?.users_lower_bound ?? est?.users ?? 0);
        const upper = Number(est?.users_upper_bound ?? est?.users ?? 0);
        const daily_min = Math.round(lower * 0.03);
        const daily_max = Math.round(upper * 0.07);
        reach = { lower, upper, daily_min, daily_max };
        if (hasCustom) {
          if (lower < 5_000) warnings.push(`Raio muito apertado (${lower.toLocaleString("pt-BR")} pessoas) — aumente o raio ou adicione mais endereços pra baratear o lead.`);
        } else if (lower < 1000) {
          warnings.push(`Audiência muito pequena (${lower.toLocaleString("pt-BR")}) — adicione mais cidades pra baratear o lead`);
        }
      } catch (e) {
        const msg = String((e as Error)?.message || "");
        const isWabaMismatch = msg.includes("1487246") || msg.includes("2446885") || /not linked to your account/i.test(msg);
        if (isWabaMismatch && resolvedPhone) {
          blockers.push(`A Meta recusou o WhatsApp ${resolvedPhone.display} (${resolvedPhone.digits}, id ${resolvedPhone.id}) para a Página ${conn.page_id}. Vincule a WABA correta à Página ou rode “Validar e corrigir WhatsApp automaticamente”. Detalhe Meta: ${msg}`);
        } else {
          warnings.push("Não foi possível estimar alcance — campanha será criada mesmo assim");
        }
      }
    }

    return json({
      ok: blockers.length === 0,
      blockers,
      warnings,
      reach,
      whatsapp: resolvedPhone
        ? { id: resolvedPhone.id, display: resolvedPhone.display, digits: resolvedPhone.digits }
        : null,
      waba_numbers: wabaNumbers,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}