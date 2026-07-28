// Shared helper to dispatch a lead to the VPS Portal Worker (Portal 2 / autoconexão).
// Used by webhook bot-flows AND by the manual "Finalizar" button (finalize-capture).
//
// Histórico: o Portal 1 ("digital", container `worker-portal/` via Playwright)
// foi descontinuado em 2026-06-19. Todos os leads finalizam no Portal 2
// (`worker-portal-2`, API direta). O campo `consultants.portal_kind` segue no
// banco apenas para auditoria — o roteamento é sempre Portal 2.

import { resolvePortalWhatsapp } from "./portal-phone.ts";
import { looksLikeFileRef, preflightPortalDocuments } from "./storage-download.ts";
import { resolvePortalContaTitularidade } from "./title-transfer.ts";

export interface DispatchResult {
  ok: boolean;
  mode: "dispatched" | "queued_offline" | "not_configured";
  status?: number;
  error?: string;
  worker?: "autoconexao";
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
  kind: "autoconexao";
}

/**
 * Resolve a URL/secret do worker de cadastro (Portal 2).
 * Retorna `null` se config insuficiente.
 *
 * Mantida exportada para que o caminho de OTP (submit-otp e os intercepts dos
 * webhooks) reuse exatamente a mesma fonte de verdade.
 */
export async function resolveWorker(supabase: any, customerId: string): Promise<ResolvedWorker | null> {
  // Carrega settings (não precisamos mais ler portal_kind — Portal 1 desativado).
  const { data: settingsRows } = await supabase.from("settings").select("*");
  const settings: Record<string, string> = {};
  settingsRows?.forEach((s: any) => { settings[s.key] = s.value; });

  // Aviso de auditoria: se algum consultor ainda estiver marcado como Portal 1,
  // logamos pra facilitar a migração — mas o despacho continua no Portal 2.
  const { data: customer } = await supabase
    .from("customers")
    .select("consultant_id, consultants:consultant_id(portal_kind)")
    .eq("id", customerId)
    .maybeSingle();
  const rawKind = (customer?.consultants?.portal_kind as any);
  if (rawKind && rawKind !== "autoconexao") {
    console.warn(`[portal-worker] ⚠️ consultor com portal_kind='${rawKind}' (legado Portal 1) — roteando no Portal 2 mesmo assim`);
  }

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
  return { url, secret, kind: "autoconexao" };
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
      electricity_bill_photo_url, electricity_boleto_photo_url, bill_base64,
      document_front_url, document_front_base64,
      document_back_url, document_back_base64
    `)
    .eq("id", customerId)
    .maybeSingle();

  if (!c) return { ok: false, missing: ["customer não encontrado"] };

  // Presença rápida (evita round-trip se nem URL existe)
  const quickMissing: string[] = [];
  const isCnh =
    String(c.document_back_url || "") === "nao_aplicavel" ||
    String(c.document_type || "").toLowerCase().includes("cnh");
  if (!looksLikeFileRef(c.electricity_bill_photo_url) && !looksLikeFileRef(c.bill_base64) &&
      !looksLikeFileRef(c.electricity_boleto_photo_url)) {
    quickMissing.push("conta de energia");
  }
  if (!looksLikeFileRef(c.document_front_url) && !looksLikeFileRef(c.document_front_base64)) {
    quickMissing.push("documento (frente)");
  }
  if (!isCnh && !looksLikeFileRef(c.document_back_url) && !looksLikeFileRef(c.document_back_base64)) {
    quickMissing.push("documento (verso)");
  }
  if (quickMissing.length) return { ok: false, missing: quickMissing };

  // Confirma bytes baixáveis (bucket privado) — senão o worker 422-a em loop
  const deep = await preflightPortalDocuments(supabase, c);
  if (deep.ok) return { ok: true, missing: [] };
  return { ok: false, missing: (deep as { ok: false; missing: string[] }).missing };
}

// Exportada para teste de propriedade (Property 7 do spec rodizio-leads-anuncio).
// É a fonte única da regra de idconsultor/indcli — NÃO duplicar em outro lugar.
export async function buildPortal2Payload(supabase: any, customerId: string): Promise<{
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
      phone_landline,
      phone_contact_confirmed,
      contaunica,
      contaunica_answered,
      transferir_titularidade,
      transferir_titularidade_answered,
      email,
      cep, address_street, address_number, address_complement,
      address_neighborhood, address_city, address_state,
      numero_instalacao, media_consumo, electricity_bill_value,
      portal_idconsultor_override,
      distribuidora, debitos_aberto, possui_procurador,
      referral_partner_id, consultant_id,
      consultants:consultant_id(igreen_id, name, portal_kind),
      referral_partners:referral_partner_id(cli, partner_igreen_id)
    `)
    .eq("id", customerId)
    .maybeSingle();

  if (!c) return null;

  const consultant = c.consultants as any;
  const partner = c.referral_partners as any;

  // ─── Resolução de idconsultor + indcli ───
  // Regra de produto (consultor abona × cliente cashback):
  //   0) portal_idconsultor_override > 0 → sobrescreve tudo (ficha manual)
  //   1) cli > 0                        → idconsultor = cli (consultor abonador)
  //   2) senão                          → idconsultor = dono da instância
  //   indcli = partner_igreen_id quando é CLIENTE cashback (≠ idconsultor)
  // Nunca usar partner_igreen_id como idconsultor — isso é campo de cliente.
  const overrideRaw = Number((c as any).portal_idconsultor_override || 0);
  const overrideId = Number.isFinite(overrideRaw) && overrideRaw > 0 ? overrideRaw : 0;
  const donoIgreenId = consultant?.igreen_id ? Number(consultant.igreen_id) : null;
  const partnerIgreenId = partner?.partner_igreen_id
    ? Number(partner.partner_igreen_id)
    : 0;
  const partnerCli = partner?.cli ? Number(partner.cli) : 0;
  const abonadorId =
    Number.isFinite(partnerCli) && partnerCli > 0 ? partnerCli : 0;
  const igreenId = overrideId > 0
    ? overrideId
    : (abonadorId > 0 ? abonadorId : donoIgreenId);
  if (!igreenId) {
    console.warn(`[portal-worker] customer=${customerId} sem igreen_id do consultor`);
    return null;
  }
  const indcli =
    Number.isFinite(partnerIgreenId) &&
    partnerIgreenId > 0 &&
    partnerIgreenId !== Number(igreenId)
      ? partnerIgreenId
      : 0;
  if (overrideId > 0) {
    console.log(`[portal-worker] customer=${customerId} idconsultor OVERRIDE ficha=${overrideId} (abonador=${abonadorId || "-"} dono=${donoIgreenId})`);
  } else if (abonadorId > 0 && abonadorId !== donoIgreenId) {
    console.log(`[portal-worker] customer=${customerId} cadastro via consultor abonador id=${igreenId} (cli=${partnerCli}) dono=${donoIgreenId}${indcli ? ` indcli=${indcli}` : ""}`);
  } else if (indcli > 0) {
    console.log(`[portal-worker] customer=${customerId} cadastro dono=${igreenId} + cliente cashback indcli=${indcli}`);
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
      indcli,
      cpf: c.cpf || "",
      nome: c.doc_holder_name || c.name || "",
      dataNascimento: c.data_nascimento || "",
      // Telefone do Portal 2: alt → landline confirmado → whatsapp (chave da conversa).
      whatsapp: resolvePortalWhatsapp(c),
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
      // Boleto único ≠ troca de título: título só SP (MG sem titularidade).
      ...resolvePortalContaTitularidade(c),
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

  // Marca tentativa
  await supabase.from("customers").update({
    last_portal_dispatch_at: new Date().toISOString(),
  }).eq("id", customerId).then(() => {}, () => {});

  // Status terminais que NÃO podem ser regredidos por uma retentativa tardia
  const TERMINAL_STATUSES = new Set([
    "awaiting_otp", "validating_otp", "awaiting_signature", "complete", "handoff_humano",
  ]);
  const { data: currentRow } = await supabase
    .from("customers").select("status").eq("id", customerId).maybeSingle();
  const currentStatus = String(currentRow?.status || "");

  if (!online) {
    if (!TERMINAL_STATUSES.has(currentStatus)) {
      await supabase.from("customers").update({
        status: "worker_offline",
        error_message: `Worker (${kind}) offline: ${healthErr || "sem resposta"} — retry automático em 1 min`,
        last_portal_dispatch_error: `offline:${healthErr || ""}`.slice(0, 200),
      }).eq("id", customerId);
    }
    return { ok: false, mode: "queued_offline", error: `worker_offline:${healthErr}`, worker: kind };
  }


  // Body depende do kind
  let body: string;
  if (kind === "autoconexao") {
    const docs = await checkDocsPresentForPortal2(supabase, customerId);
    if (!docs.ok) {
      const msg = `Documentos obrigatórios ausentes: ${docs.missing.join(", ")}`;
      console.warn(`[portal-worker] customer=${customerId} despacho bloqueado — ${msg}`);
      if (!TERMINAL_STATUSES.has(currentStatus)) {
        await supabase.from("customers").update({
          status: "awaiting_manual_submit",
          portal2_status: "blocked_missing_documents",
          error_message: msg,
          last_portal_dispatch_error: msg.slice(0, 200),
        }).eq("id", customerId);
      }
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
      if (r.ok) {
        await supabase.from("customers").update({
          last_portal_dispatch_error: null,
        }).eq("id", customerId).then(() => {}, () => {});
        return { ok: true, mode: "dispatched", status: r.status, worker: kind };
      }
      lastErr = `Worker ${r.status}: ${respBody.slice(0, 120)}`;
    } catch (e: any) {
      lastErr = e?.message || String(e);
      console.warn(`[portal-worker] submit-lead kind=${kind} attempt=${attempt} error=${lastErr}`);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2_000));
  }

  if (!TERMINAL_STATUSES.has(currentStatus)) {
    await supabase.from("customers").update({
      status: "worker_offline",
      error_message: `Worker (${kind}) falhou: ${(lastErr || "").slice(0, 200)}`,
      last_portal_dispatch_error: (lastErr || "").slice(0, 200),
    }).eq("id", customerId);
  } else {
    await supabase.from("customers").update({
      last_portal_dispatch_error: (lastErr || "").slice(0, 200),
    }).eq("id", customerId).then(() => {}, () => {});
  }

  return { ok: false, mode: "queued_offline", error: lastErr, worker: kind };
}
