// Shared helper to dispatch a lead to the VPS Portal Worker.
// Used by webhook bot-flows AND by the manual "Finalizar" button (finalize-capture).
//
// Roteamento:
//   consultants.portal_kind = 'digital'    → POST /submit-lead no worker original (Playwright UI)
//   consultants.portal_kind = 'autoconexao' → POST /submit-lead no worker-portal-2 (API direta)

export interface DispatchResult {
  ok: boolean;
  mode: "dispatched" | "queued_offline" | "not_configured";
  status?: number;
  error?: string;
  worker?: "digital" | "autoconexao";
}

async function fetchWithTimeout(url: string, init: RequestInit & { timeout?: number } = {}) {
  const { timeout = 25_000, ...rest } = init;
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

interface ResolvedWorker {
  url: string;
  secret: string;
  kind: "digital" | "autoconexao";
}

/**
 * Resolve qual worker atende o customer baseado no `portal_kind` do consultor dele.
 * Retorna `null` se config insuficiente.
 */
async function resolveWorker(supabase: any, customerId: string): Promise<ResolvedWorker | null> {
  // Carrega settings + portal_kind do consultor do customer numa query só
  const [{ data: settingsRows }, { data: customer }] = await Promise.all([
    supabase.from("settings").select("*"),
    supabase
      .from("customers")
      .select("consultant_id, consultants:consultant_id(portal_kind)")
      .eq("id", customerId)
      .maybeSingle(),
  ]);

  const settings: Record<string, string> = {};
  settingsRows?.forEach((s: any) => { settings[s.key] = s.value; });

  const kind: "digital" | "autoconexao" =
    (customer?.consultants?.portal_kind as any) === "autoconexao" ? "autoconexao" : "digital";

  if (kind === "autoconexao") {
    const url = (
      settings.portal2_worker_url ||
      Deno.env.get("PORTAL2_WORKER_URL") ||
      "http://igreen_portal-worker-2:3101"
    ).replace(/\/$/, "");
    const secret =
      settings.portal2_worker_secret ||
      Deno.env.get("PORTAL2_WORKER_SECRET") ||
      settings.worker_secret ||
      Deno.env.get("WORKER_SECRET") ||
      "";
    if (!url || !secret) return null;
    return { url, secret, kind };
  }

  // Default: Portal 1 (digital)
  const url = (
    settings.portal_worker_url ||
    Deno.env.get("PORTAL_WORKER_URL") ||
    Deno.env.get("WORKER_PORTAL_URL") ||
    ""
  ).replace(/\/$/, "");
  const secret =
    settings.worker_secret ||
    settings.portal_worker_secret ||
    Deno.env.get("WORKER_SECRET") ||
    "";
  if (!url || !secret) return null;
  return { url, secret, kind: "digital" };
}

/**
 * Monta o payload pro `worker-portal-2`. O worker original aceita só
 * `{customer_id}` e busca o resto do banco; o worker-2 espera `{customer_id, dados}`
 * com o payload completo do cadastro.
 */
/**
 * REGRA: nenhum lead sobe ao Portal 2 sem conta de energia + documento
 * (frente + verso pra RG; só frente pra CNH). Confere a PRESENÇA dos anexos
 * (URL http/MinIO, data URL ou base64 inline) no customer. Os bytes em si são
 * resolvidos/anexados no worker-portal-2; aqui é só um gate de pré-despacho
 * pros caminhos que não passam pelo finalize-capture (bot auto-complete,
 * retry, ai-agent-router).
 *
 * Retorna { ok: true } ou { ok: false, missing: string[] }.
 */
async function checkDocsPresentForPortal2(supabase: any, customerId: string): Promise<{ ok: boolean; missing: string[] }> {
  const { data: c } = await supabase
    .from("customers")
    .select(`
      document_type,
      electricity_bill_photo_url, bill_base64,
      document_front_url, document_front_base64,
      document_back_url, document_back_base64
    `)
    .eq("id", customerId)
    .maybeSingle();

  if (!c) return { ok: false, missing: ["customer não encontrado"] };

  const hasFile = (v: any) =>
    typeof v === "string" &&
    v.trim() !== "" &&
    v !== "evolution-media:pending" &&
    v !== "collected" &&
    v !== "nao_aplicavel" &&
    (v.startsWith("http") || v.startsWith("data:") || v.length > 200);

  const isCnh =
    String(c.document_back_url || "") === "nao_aplicavel" ||
    String(c.document_type || "").toLowerCase().includes("cnh");

  const missing: string[] = [];
  if (!hasFile(c.electricity_bill_photo_url) && !hasFile(c.bill_base64)) missing.push("conta de energia");
  if (!hasFile(c.document_front_url) && !hasFile(c.document_front_base64)) missing.push("documento (frente)");
  if (!isCnh && !hasFile(c.document_back_url) && !hasFile(c.document_back_base64)) missing.push("documento (verso)");

  return { ok: missing.length === 0, missing };
}

async function buildPortal2Payload(supabase: any, customerId: string): Promise<{
  customer_id: string;
  dados: Record<string, unknown>;
} | null> {
  const { data: c } = await supabase
    .from("customers")
    .select(`
      id,
      cpf, name, doc_holder_name, bill_holder_name,
      data_nascimento,
      phone_whatsapp,
      portal2_celular_alt,
      email,
      cep, address_street, address_number, address_complement,
      address_neighborhood, address_city, address_state,
      numero_instalacao, media_consumo, electricity_bill_value,
      distribuidora, debitos_aberto, possui_procurador,
      referral_partner_id, consultant_id,
      consultants:consultant_id(igreen_id, name, portal_kind),
      referral_partners:referral_partner_id(cli)
    `)
    .eq("id", customerId)
    .maybeSingle();

  if (!c) return null;

  const consultant = c.consultants as any;
  const partner = c.referral_partners as any;
  const igreenId = consultant?.igreen_id ? Number(consultant.igreen_id) : null;
  if (!igreenId) {
    console.warn(`[portal-worker] customer=${customerId} sem igreen_id do consultor`);
    return null;
  }

  const consumoAtual = Number(c.media_consumo || 0);
  const valorConta = Number(c.electricity_bill_value || 0);
  let consumoMedio = Number.isFinite(consumoAtual) && consumoAtual >= 50
    ? Math.round(consumoAtual)
    : 0;

  if (!consumoMedio && Number.isFinite(valorConta) && valorConta >= 30) {
    consumoMedio = Math.max(100, Math.min(2000, Math.round(valorConta / 1.10)));
    console.log(`[portal-worker] media_consumo ausente; estimado=${consumoMedio} kWh a partir de R$${valorConta} customer=${customerId}`);
    await supabase.from("customers").update({ media_consumo: consumoMedio }).eq("id", customerId);
  }

  if (!consumoMedio) {
    consumoMedio = 350;
    console.warn(`[portal-worker] media_consumo e valor ausentes; usando fallback=${consumoMedio} kWh customer=${customerId}`);
  }

  return {
    customer_id: customerId,
    dados: {
      idconsultor: igreenId,
      indcli: partner?.cli ? Number(partner.cli) : 0,
      cpf: c.cpf || "",
      nome: c.doc_holder_name || c.name || "",
      dataNascimento: c.data_nascimento || "",
      // Req 8.3/8.4/8.5: prioriza o celular alternativo do Portal 2 quando
      // presente; phone_whatsapp é apenas lido, nunca alterado.
      whatsapp: c.portal2_celular_alt || c.phone_whatsapp || "",
      email: c.email || "",
      cep: c.cep || "",
      endereco: c.address_street || "",
      numero: c.address_number || "",
      complemento: c.address_complement || "",
      bairro: c.address_neighborhood || "",
      cidade: c.address_city || "",
      uf: c.address_state || "",
      numeroInstalacao: c.numero_instalacao || "",
      consumoMedio,
      electricityBillValue: valorConta || undefined,
      // Concessionária = distribuidora local. Fornecedora é resolvida pelo
      // worker via /bonus/rules baseado em UF + concessionária + consumo.
      concessionaria: c.distribuidora || "",
      // Sinais que disparam fluxos especiais no Portal 2
      possuiPlacas: false,
      sendcontract: true,
    },
  };
}

export async function dispatchPortalWorker(supabase: any, customerId: string): Promise<DispatchResult> {
  const resolved = await resolveWorker(supabase, customerId);
  if (!resolved) {
    console.log("[portal-worker] worker URL/secret ausentes — confiando no polling");
    return { ok: true, mode: "not_configured" };
  }
  const { url, secret, kind } = resolved;
  console.log(`[portal-worker] roteando customer=${customerId} → kind=${kind} url=${url}`);

  // Health check (10s)
  let online = false;
  let healthErr = "";
  try {
    const h = await fetchWithTimeout(`${url}/health`, { timeout: 10_000 });
    online = h.ok;
    if (!online) healthErr = `HTTP ${h.status}`;
    console.log(`[portal-worker] health=${h.status} online=${online} kind=${kind} url=${url}`);
  } catch (e: any) {
    healthErr = e?.name === "AbortError" ? "timeout" : (e?.message || String(e));
    console.warn(`[portal-worker] health check falhou kind=${kind} url=${url}: ${healthErr}`);
  }

  if (!online) {
    await supabase.from("customers").update({
      status: "worker_offline",
      error_message: `Worker (${kind}) offline: ${healthErr || "sem resposta"} — retry automático em 1 min`,
    }).eq("id", customerId);
    return { ok: false, mode: "queued_offline", error: `worker_offline:${healthErr}`, worker: kind };
  }


  // Body depende do kind
  let body: string;
  if (kind === "autoconexao") {
    // REGRA: bloqueia despacho sem conta de energia + documento (frente/verso
    // pra RG; só frente pra CNH). Protege caminhos fora do finalize-capture.
    const docs = await checkDocsPresentForPortal2(supabase, customerId);
    if (!docs.ok) {
      const msg = `Documentos obrigatórios ausentes: ${docs.missing.join(", ")}`;
      console.warn(`[portal-worker] customer=${customerId} despacho bloqueado — ${msg}`);
      await supabase.from("customers").update({
        status: "missing_documents",
        error_message: msg,
      }).eq("id", customerId);
      return { ok: false, mode: "queued_offline", error: "missing_documents", worker: kind };
    }
    const payload = await buildPortal2Payload(supabase, customerId);
    if (!payload) {
      return { ok: false, mode: "queued_offline", error: "missing_consultant_or_data", worker: kind };
    }
    body = JSON.stringify(payload);
  } else {
    body = JSON.stringify({ customer_id: customerId });
  }

  // POST /submit-lead com retry 3x
  let lastErr: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetchWithTimeout(`${url}/submit-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${secret}` },
        body,
        timeout: 25_000,
      });
      const respBody = await r.text();
      console.log(`[portal-worker] submit-lead kind=${kind} attempt=${attempt} status=${r.status} body=${respBody.slice(0, 200)}`);
      if (r.ok) return { ok: true, mode: "dispatched", status: r.status, worker: kind };
      lastErr = `Worker ${r.status}: ${respBody.slice(0, 120)}`;
    } catch (e: any) {
      lastErr = e?.message || String(e);
      console.warn(`[portal-worker] submit-lead kind=${kind} attempt=${attempt} error=${lastErr}`);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2_000));
  }

  await supabase.from("customers").update({
    status: "worker_offline",
    error_message: `Worker (${kind}) falhou: ${(lastErr || "").slice(0, 200)}`,
  }).eq("id", customerId);

  return { ok: false, mode: "queued_offline", error: lastErr, worker: kind };
}
