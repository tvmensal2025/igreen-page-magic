import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { enqueueProactiveWaCandidates } from "../_shared/igreen-automation.ts";

// =====================================================
// sync-igreen-customers
// Estratégia única: delega o login/scraping para o Playwright Worker na VPS
// (IGREEN_SYNC_WORKER_URL). Toda a normalização e upsert continua aqui.
// =====================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normalizePhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 11) return `55${digits}`;
  if (digits.length === 10) return `55${digits}`;
  if (digits.length >= 12) return digits;
  return "";
}

function mapStatus(andamento: string | undefined): string {
  if (!andamento) return "pending";
  const lower = andamento.toLowerCase().trim();
  if (lower === "validado" || lower === "aprovado" || lower === "ativo") return "approved";
  if (lower === "devolutiva") return "devolutiva";
  if (lower === "reprovado" || lower === "cancelado") return "rejected";
  if (lower.includes("falta assinatura")) return "awaiting_signature";
  if (lower.includes("aguardando")) return "pending";
  if (lower === "pendente" || lower === "em análise" || lower === "em analise") return "pending";
  if (lower === "lead" || lower === "novo") return "lead";
  if (lower === "dados completos" || lower === "data_complete") return "data_complete";
  if (lower === "registrado" || lower === "registered_igreen") return "registered_igreen";
  if (lower === "contrato enviado" || lower === "contract_sent") return "contract_sent";
  return "pending";
}

// Mapeia o id da coluna do Kanban /crm/green para o status interno.
// Colunas: aguardando_assinatura, aguardando, devolutiva, reprovado, validado,
// adimplente, menos_30d, inadimplente, cancelado.
function mapStatusColuna(col: string | undefined): string | null {
  if (!col) return null;
  const c = col.toLowerCase().trim();
  if (c === "validado" || c === "adimplente" || c === "menos_30d" || c === "inadimplente") return "approved";
  if (c === "aguardando_assinatura") return "awaiting_signature";
  if (c === "aguardando") return "pending";
  if (c === "devolutiva") return "devolutiva";
  if (c === "reprovado") return "rejected";
  if (c === "cancelado") return "rejected";
  return null;
}

function safeStr(val: unknown): string | null {
  if (val == null || val === "") return null;
  const s = String(val).trim();
  return s.length > 0 ? s : null;
}

function safeNum(val: unknown): number | null {
  if (val == null || val === "") return null;
  const n = parseFloat(String(val).replace(",", ".").replace("%", ""));
  return isNaN(n) ? null : n;
}

function stableIntId(input: unknown): number {
  const s = String(input || "").trim();
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function get(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] != null && obj[key] !== "") return obj[key];
    const found = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
    if (found && obj[found] != null && obj[found] !== "") return obj[found];
  }
  return null;
}

function cleanDevolutiva(raw: string): string {
  const cleaned = raw.replace(/caminho[a-zA-Z0-9]*:\s*/g, "");
  return cleaned.replace(/^[,\s]+|[,\s]+$/g, "").replace(/,\s*,/g, ",").trim();
}

function buildRecord(c: Record<string, unknown>): Record<string, unknown> | null {
  const phoneRaw = get(c, "celular", "telefone", "phone", "whatsapp", "Celular", "Telefone");
  let phone = normalizePhone(String(phoneRaw || ""));
  let isPlaceholderPhone = false;

  if (!phone || phone.length < 12) {
    const codigo = safeStr(get(c, "codigoCliente", "codigo", "Codigo", "Código", "codigoIgreen", "id"));
    const instalacao = safeStr(get(c, "instalacao", "numeroInstalacao", "numero_instalacao", "Instalação"));
    const fallbackId = codigo || instalacao;
    if (fallbackId) {
      phone = `sem_celular_${fallbackId.replace(/\D/g, "")}`;
      isPlaceholderPhone = true;
    } else return null;
  }

  const record: Record<string, unknown> = { phone_whatsapp: phone };
  record.customer_origin = "igreen_sync";
  record.phone_contact_confirmed = false;
  // Nome vindo do portal iGreen é confiável — marca como 'igreen_portal' para
  // que o chat interno mostre o nome do cliente em vez do número de telefone.
  record.name_source = "igreen_portal";

  const name = safeStr(get(c, "nomeCliente", "nome", "Nome", "name", "Nome do Cliente"));
  if (name) record.name = name;

  const statusRaw = safeStr(get(c, "andamento", "Andamento", "status", "status_label"));
  const statusColuna = safeStr(get(c, "status_coluna"));
  const statusFromColuna = mapStatusColuna(statusColuna || undefined);
  record.status = isPlaceholderPhone
    ? "contato_incompleto"
    : (statusFromColuna || mapStatus(statusRaw || undefined));
  // Guarda o andamento textual (coluna do Kanban) para exibição/auditoria.
  if (statusColuna) record.andamento_igreen = statusColuna;

  const cpf = safeStr(get(c, "cpf", "CPF", "documento", "Documento"));
  if (cpf) record.cpf = cpf.replace(/\D/g, "");

  const email = safeStr(get(c, "email", "Email", "E-mail"));
  if (email) record.email = email;

  const city = safeStr(get(c, "cidade", "Cidade", "municipio"));
  if (city) record.address_city = city;

  const state = safeStr(get(c, "uf", "UF", "estado"));
  if (state) record.address_state = state.toUpperCase();

  const dist = safeStr(get(c, "distribuidora", "Distribuidora"));
  if (dist) record.distribuidora = dist;

  const andamento = safeStr(get(c, "andamento", "Andamento"));
  if (andamento) record.andamento_igreen = andamento;

  const devolutiva = safeStr(get(c, "devolutiva", "Devolutiva"));
  if (devolutiva) record.devolutiva = cleanDevolutiva(devolutiva);

  const obs = safeStr(get(c, "observacaoCompartilhada", "observacao", "Observação", "obs"));
  if (obs) record.observacao = obs;

  const icode = safeStr(get(c, "codigoIgreen", "codigo", "Código"));
  if (icode) record.igreen_code = icode;

  const consumo = safeNum(get(c, "consumoMedio", "consumo_medio", "Consumo Médio", "kwh", "consumo"));
  if (consumo != null) record.media_consumo = consumo;

  const desc = safeNum(get(c, "descontoCliente", "desconto_cliente", "Desconto"));
  if (desc != null) record.desconto_cliente = desc;

  const dCad = safeStr(get(c, "dataCadastro", "data_cadastro", "Data Cadastro"));
  if (dCad) record.data_cadastro = dCad;

  const dAtivo = safeStr(get(c, "dataAtivo", "data_ativo", "Data Ativo"));
  if (dAtivo) record.data_ativo = dAtivo;

  const dVal = safeStr(get(c, "dataValidado", "data_validado", "Data Validado"));
  if (dVal) record.data_validado = dVal;

  const stFin = safeStr(get(c, "statusFinanceiro", "status_financeiro"));
  if (stFin) record.status_financeiro = stFin;

  const cash = safeStr(get(c, "cashback", "Cashback"));
  if (cash) record.cashback = cash;

  const nivel = safeStr(get(c, "nivel", "Nível"));
  if (nivel) record.nivel_licenciado = nivel;

  const asCl = safeStr(get(c, "assinaturaCliente", "assinatura_cliente"));
  if (asCl) record.assinatura_cliente = asCl;

  const asIg = safeStr(get(c, "assinaturaIgreen", "assinatura_igreen"));
  if (asIg) record.assinatura_igreen = asIg;

  const linkAs = safeStr(get(c, "linkAssinatura", "link_assinatura"));
  if (linkAs) record.link_assinatura = linkAs;

  const lic = safeStr(get(c, "licenciado", "Licenciado", "nomeLicenciado"));
  if (lic) record.registered_by_name = lic;

  const codLic = safeStr(get(c, "codigoLicenciado", "codigo_licenciado"));
  if (codLic) record.registered_by_igreen_id = codLic;

  const indicador = safeStr(get(c, "indicador", "Indicador", "nomeIndicador", "indicadoPor", "quemIndicou", "referredBy", "indicacao"));
  if (indicador) record.customer_referred_by_name = indicador;

  const indicadorPhone = safeStr(get(c, "telefoneIndicador", "celularIndicador", "phoneIndicador"));
  if (indicadorPhone) record.customer_referred_by_phone = normalizePhone(String(indicadorPhone));

  const inst = safeStr(get(c, "numeroInstalacao", "numero_instalacao", "Instalação"));
  if (inst) record.numero_instalacao = inst;

  const nasc = safeStr(get(c, "dataNascimento", "data_nascimento"));
  if (nasc) record.data_nascimento = nasc.substring(0, 10);

  return record;
}

// =====================================================
// Resolve worker URL + secret (mesmo padrão do portal-worker)
// =====================================================
async function resolveSyncWorker(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<{ url: string; secret: string } | null> {
  const { data: settingsRows } = await supabase.from("settings").select("key, value");
  const settings: Record<string, string> = {};
  settingsRows?.forEach((s: { key: string; value: string }) => { settings[s.key] = s.value; });

  const url = (
    settings.igreen_sync_worker_url ||
    Deno.env.get("IGREEN_SYNC_WORKER_URL") ||
    ""
  ).replace(/\/$/, "");
  const secret =
    settings.igreen_sync_worker_secret ||
    Deno.env.get("IGREEN_SYNC_WORKER_SECRET") ||
    settings.worker_secret ||
    Deno.env.get("WORKER_SECRET") ||
    "";

  if (!url) return null;
  return { url, secret };
}

async function callWorker(
  worker: { url: string; secret: string },
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data?: any; error?: string }> {
  const ctrl = new AbortController();
  // sync-all com enrich pode levar 4–6 min quando o portal/Tor está lento.
  // A Edge responde em background; este timeout é só da chamada interna ao worker.
  const timeout = setTimeout(() => ctrl.abort(), 600_000); // 10 min
  try {
    const res = await fetch(`${worker.url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Token": worker.secret,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) return { ok: false, status: res.status, error: data?.error || text.slice(0, 300), data };
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

// =====================================================
// Telemetria: registra a execução em igreen_sync_runs +
// atualiza consultants.igreen_credential_status.
// =====================================================
function classifyError(err: string | undefined): string {
  const msg = String(err || "").toLowerCase();
  if (/invalid|credenc|senha|password|unauth|401|403/.test(msg)) return "invalid_credentials";
  if (/cloudflare|challenge|blocked|waf|captcha|429|cooldown/.test(msg)) return "waf_blocked";
  if (/sync_already_running|em andamento|409/.test(msg)) return "already_running";
  return "failed";
}

// deno-lint-ignore no-explicit-any
async function scheduleWafRetry(supabase: any, consultantId: string | null, mode: string, delayMs = 300_000): Promise<string | null> {
  if (!consultantId) return null;
  const at = new Date(Date.now() + delayMs).toISOString();
  try {
    await supabase.from("settings").upsert(
      { key: `igreen_retry:${consultantId}`, value: { at, mode, scheduled_at: new Date().toISOString() } },
      { onConflict: "key" },
    );
    console.log(`[retry] agendado ${mode} para ${consultantId} em ${Math.round(delayMs/1000)}s`);
    return at;
  } catch (e) {
    console.warn(`[retry] falha ao agendar: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// deno-lint-ignore no-explicit-any
function workerErrorResponse(email: string, r: { status: number; error?: string }, opts?: { retry_at?: string | null }) {
  const reason = classifyError(r.error);
  return {
    success: false,
    email,
    error: `Worker falhou: ${r.error}`,
    status: r.status,
    reason,
    retry_scheduled_at: opts?.retry_at || null,
  };
}


// deno-lint-ignore no-explicit-any
async function logSyncStart(supabase: any, consultantId: string | null, mode: string): Promise<string | null> {
  if (!consultantId) return null;
  const { data, error } = await supabase
    .from("igreen_sync_runs")
    .insert({ consultant_id: consultantId, mode, status: "running" })
    .select("id")
    .single();
  if (error) { console.warn("[telemetry] logSyncStart:", error.message); return null; }
  return data?.id ?? null;
}

// deno-lint-ignore no-explicit-any
async function updateAutomationTimestamps(supabase: any, consultantId: string | null, result: Record<string, unknown>): Promise<void> {
  if (!consultantId || !result?.success) return;
  const now = new Date().toISOString();
  const updates: Record<string, string> = {};
  const map: Record<string, string> = {
    customers: "last_sync_customers",
    boletos: "last_sync_boletos",
    devolutivas: "last_sync_devolutivas",
    metrics: "last_sync_metrics",
    network: "last_sync_network",
    telecom: "last_sync_telecom",
    seguros: "last_sync_seguros",
    cashback: "last_sync_cashback",
  };
  for (const [k, col] of Object.entries(map)) if (result[k] != null) updates[col] = now;
  if (Object.keys(updates).length > 0) {
    await supabase.from("igreen_automation_settings")
      .upsert({ consultant_id: consultantId, ...updates }, { onConflict: "consultant_id" });
  }
}

// deno-lint-ignore no-explicit-any
async function logSyncFinish(
  supabase: any,
  runId: string | null,
  consultantId: string | null,
  result: Record<string, unknown>,
): Promise<void> {
  const success = Boolean(result?.success);
  const errText = success ? null : String(result?.error || "");
  const status = success ? "ok" : classifyError(errText || undefined);
  const counts: Record<string, unknown> = {};
  for (const k of ["customers","boletos","telecom","seguros","devolutivas","network","metrics","cashback","details","alerts","portfolio","background","portal_identity","diagnostics","full_extras","full_extras_error"]) {
    if (result[k] != null) counts[k] = result[k];
  }
  if (runId) {
    await supabase.from("igreen_sync_runs").update({
      status, counts, error: errText, finished_at: new Date().toISOString(),
    }).eq("id", runId);
  }
  if (consultantId) {
    await supabase.from("consultants").update({
      igreen_credential_status: success ? "valid" : status,
      igreen_credential_checked_at: new Date().toISOString(),
      igreen_credential_error: errText,
    }).eq("id", consultantId);
  }
  await updateAutomationTimestamps(supabase, consultantId, result);
}

const DEFAULT_IGREEN_TOGGLES: Record<string, boolean> = {
  capture_boletos: true,
  capture_devolutivas: true,
  capture_telecom: true,
  capture_seguros: true,
  capture_cashback: true,
  alert_boletos_vencendo: true,
  alert_devolutivas: true,
  alert_licencas_expirando: true,
  rotinas_tarefas: true,
  // Envio proativo WA e cross-sell: OFF por padrão (alinha com a UI e com a
  // regra de produção — sem mensagem automática até validação explícita).
  auto_wa_boleto_vencendo: false,
  auto_wa_aniversariante: false,
  cross_sell_bot: false,
};

// deno-lint-ignore no-explicit-any
async function loadIgreenToggles(supabase: any, consultantId: string | null): Promise<Record<string, boolean>> {
  let toggles: Record<string, boolean> = { ...DEFAULT_IGREEN_TOGGLES };
  if (consultantId) {
    const { data: t } = await supabase
      .from("igreen_automation_settings")
      .select("*")
      .eq("consultant_id", consultantId)
      .maybeSingle();
    if (t) toggles = { ...DEFAULT_IGREEN_TOGGLES, ...(t as Record<string, boolean>) };
  }

  const autoEnabled: string[] = [];
  if (toggles.alert_boletos_vencendo && !toggles.capture_boletos) { toggles.capture_boletos = true; autoEnabled.push("capture_boletos"); }
  if (toggles.alert_devolutivas && !toggles.capture_devolutivas) { toggles.capture_devolutivas = true; autoEnabled.push("capture_devolutivas"); }
  if (autoEnabled.length) console.log(`[sync-all] auto-enabled for run: ${autoEnabled.join(",")}`);
  return toggles;
}

function buildExtrasOnly(_toggles: Record<string, boolean>): string[] {
  // Captura SEMPRE completa: clientes (varredura por dia = 571), rede, métricas,
  // boletos, telecom, seguros, devolutivas e cashback. Os toggles NÃO limitam
  // mais a coleta de dados — eles controlam apenas as AUTOMAÇÕES (alertas e
  // envio proativo de WhatsApp). Assim a página nunca fica sem dado.
  // "customers" aqui = varredura COMPLETA por dia (a Fase A já trouxe o Kanban rápido).
  return ["customers", "network", "metrics", "boletos", "telecom", "seguros", "devolutivas", "cashback"];
}

function extractCustomerCodes(customers: any[]): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const c of customers || []) {
    const code = safeStr(c?.codigo || c?.codigoIgreen || c?.codigoCliente || c?.idcliente || c?.id || c?.igreen_code);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

function buildProductDiagnostics(data: any, only: string[] | null = null): Record<string, unknown> {
  const telecom = Array.isArray(data?.telecom) ? data.telecom : [];
  const seguros = Array.isArray(data?.seguros) ? data.seguros : [];
  const telecomSummaryTotal = safeNum(data?.metrics?.telecom_resumo?.total ?? data?.metrics?.telecom_resumo?.totalCadastradas);
  const segurosSummaryTotal = safeNum(data?.metrics?.seguros_resumo?.total ?? data?.metrics?.seguros_resumo?.vigentes ?? data?.metrics?.seguros_resumo?.apolicesVigentes);
  const workerDiag = data?.diagnostics && typeof data.diagnostics === "object" ? data.diagnostics : {};
  return {
    ...(workerDiag || {}),
    only,
    telecom: {
      source: "/crm/telecom",
      returned: telecom.length,
      summary_total: telecomSummaryTotal,
      gap: telecomSummaryTotal != null && telecomSummaryTotal > 0 && telecom.length === 0,
      ...((workerDiag as Record<string, any>)?.telecom || {}),
    },
    seguros: {
      source: "/crm/seguros",
      returned: seguros.length,
      summary_total: segurosSummaryTotal,
      gap: segurosSummaryTotal != null && segurosSummaryTotal > 0 && seguros.length === 0,
      ...((workerDiag as Record<string, any>)?.seguros || {}),
    },
  };
}

function augmentProductGaps(out: Record<string, unknown>, rawData: any): void {
  const diagnostics = (out.diagnostics && typeof out.diagnostics === "object" ? out.diagnostics : {}) as Record<string, any>;
  const telecomDiag = (diagnostics.telecom ||= {});
  const segurosDiag = (diagnostics.seguros ||= {});
  const telecomSummary = safeNum(rawData?.metrics?.telecom_resumo?.total ?? rawData?.metrics?.telecom_resumo?.totalCadastradas);
  const segurosSummary = safeNum(rawData?.metrics?.seguros_resumo?.total ?? rawData?.metrics?.seguros_resumo?.vigentes ?? rawData?.metrics?.seguros_resumo?.apolicesVigentes);
  const telecomSaved = safeNum((out.telecom as any)?.telecom_valid_rows ?? (out.telecom as any)?.telecom_saved ?? 0) ?? 0;
  const segurosSaved = safeNum((out.seguros as any)?.seguros_valid_rows ?? (out.seguros as any)?.seguros_saved ?? 0) ?? 0;
  if (telecomSummary != null) {
    telecomDiag.summary_total = telecomSummary;
    telecomDiag.saved_rows = telecomSaved;
    telecomDiag.gap = telecomSummary > 0 && telecomSaved === 0;
    if (telecomDiag.gap) telecomDiag.probable_reason = "summary_has_data_but_detail_sources_saved_zero";
  }
  if (segurosSummary != null) {
    segurosDiag.summary_total = segurosSummary;
    segurosDiag.saved_rows = segurosSaved;
    segurosDiag.gap = segurosSummary > 0 && segurosSaved === 0;
    if (segurosDiag.gap) segurosDiag.probable_reason = "summary_has_data_but_detail_sources_saved_zero";
  }
  out.diagnostics = diagnostics;
}

// Fase B do sync_all: extras + enriquecimento. Nunca é pré-requisito para o
// cliente aparecer na carteira; a Fase A já persistiu todos do Kanban.
// deno-lint-ignore no-explicit-any
async function runSyncAllBackgroundPhase(
  supabase: any,
  worker: { url: string; secret: string },
  portalEmail: string,
  portalPassword: string,
  consultantId: string | null,
  toggles: Record<string, boolean>,
  baseCustomers: any[],
  igreenAccountId: string | null = null,
): Promise<void> {
  const emailNorm = String(portalEmail || "").trim().toLowerCase();
  const passwordNorm = String(portalPassword || "");
  const out: Record<string, unknown> = { success: true, mode: "sync_all_background", email: emailNorm };
  try {
    const r = await callWorker(worker, "/sync-all", {
      portal_email: emailNorm,
      portal_password: passwordNorm,
      only: buildExtrasOnly(toggles),
      enrich: false,
      full_history: true,
    });
    if (!r.ok) {
      out.success = false;
      out.error = `Worker falhou nos extras: ${r.error}`;
      return;
    }

    const consultorId = r.data?.consultor_id ? String(r.data.consultor_id) : null;
    // Multi-conta: NÃO sobrescrever consultants.igreen_consultor_id com ID de
    // subconta (Sirlene/Nilma). Só atualiza a linha da conta atual; a coluna
    // legada do consultor fica para a conta principal (Fase A).
    if (consultantId && consultorId) {
      if (igreenAccountId) {
        await supabase.from("igreen_portal_accounts").update({
          igreen_consultor_id: consultorId,
        }).eq("id", igreenAccountId);
      } else {
        await supabase.from("consultants").update({ igreen_consultor_id: consultorId }).eq("id", consultantId);
      }
    }
    out.portal_identity = { igreen_consultor_id: consultorId };
    out.diagnostics = buildProductDiagnostics(r.data, buildExtrasOnly(toggles));

    // Persiste a lista COMPLETA de clientes (varredura por dia = 571). A Fase A
    // já gravou o Kanban rápido; aqui completamos com os que faltavam.
    const fullCustomers: any[] = r.data?.customers || [];
    if (fullCustomers.length > 0) {
      try {
        out.customers_full = await persistCustomers(supabase, consultantId, fullCustomers, igreenAccountId);
        out.portfolio_full = await markOutOfPortfolio(supabase, consultantId, fullCustomers);
      } catch (e) { out.customers_full_error = e instanceof Error ? e.message : String(e); }
    }

    try { out.network = await persistNetwork(supabase, consultantId, r.data?.members || [], igreenAccountId); }
    catch (e) { out.network_error = e instanceof Error ? e.message : String(e); }
    out.metrics = await persistMetrics(supabase, consultantId, r.data?.metrics);
    // Persiste SEMPRE tudo (não depende de toggle). A página nunca fica vazia.
    out.boletos = await persistBoletos(supabase, consultantId, r.data?.boletos || []);
    out.telecom = await persistTelecom(supabase, consultantId, r.data?.telecom || []);
    out.seguros = await persistSeguros(supabase, consultantId, r.data?.seguros || []);
    out.devolutivas = await persistDevolutivas(supabase, consultantId, r.data?.devolutivas || []);
    out.cashback = await persistCashback(supabase, consultantId, r.data?.cashback || {});
    // v18: cobertura total das páginas (telecom/linhas, faturas, comissoes,
    // seguros/apolices, sinistros, network history). Só roda se o worker
    // devolveu `full_extras` (worker v18+).
    if (r.data?.full_extras) {
      try {
        out.full_extras = await persistFullExtras(supabase, consultantId, r.data.full_extras);
      } catch (e) {
        out.full_extras_error = e instanceof Error ? e.message : String(e);
        console.warn("[full_extras] persist error:", out.full_extras_error);
      }
    }
    augmentProductGaps(out, r.data);
    out.alerts = await generateAlerts(supabase, consultantId, toggles, r.data);
    // Enfileira candidatos de WA proativo (sem enviar). Só cria alertas dry_run
    // quando o consultor ligou auto_wa_* — envio real fica para cron futuro + gate.
    if (consultantId) {
      try {
        out.wa_queue = await enqueueProactiveWaCandidates(supabase, consultantId, toggles, {
          boletos: r.data?.boletos || [],
          metrics: r.data?.metrics,
        });
      } catch (e) {
        out.wa_queue_error = e instanceof Error ? e.message : String(e);
      }
    }

    const started = Date.now();
    let detailsApplied = 0;
    let detailsReceived = 0;
    // Enriquece a lista COMPLETA (571) quando disponível; senão a base (Kanban).
    const allCodes = extractCustomerCodes(fullCustomers.length > 0 ? fullCustomers : baseCustomers);
    // PRIORIDADE: quem nunca foi enriquecido vem primeiro. Sem isso, o loop
    // (limitado a ~100s) reprocessava sempre os mesmos primeiros códigos e
    // nunca alcançava o fim da fila — deixando centenas de clientes com
    // "Contato incompleto" (sem telefone/CPF/distribuidora) para sempre.
    const codes = await prioritizeUnenrichedCodes(supabase, consultantId, allCodes);
    out.details_pending_before = codes.length;
    for (let i = 0; i < codes.length; i += 30) {
      if (Date.now() - started > 100_000) {
        out.details_stopped_reason = "edge_time_budget";
        break;
      }
      const chunk = codes.slice(i, i + 30);
      const er = await callWorker(worker, "/enrich-batch", {
        portal_email: emailNorm,
        portal_password: passwordNorm,
        codigos: chunk,
      });
      if (!er.ok) {
        out.details_error = `Worker falhou no enrich ${i}-${i + chunk.length}: ${er.error}`;
        break;
      }
      const details = er.data?.details || [];
      detailsReceived += details.length;
      const applied = await applyCustomerDetails(supabase, consultantId, details, igreenAccountId);
      detailsApplied += Number(applied.details_applied || 0);
    }
    out.details = { details_received: detailsReceived, details_applied: detailsApplied, total_codes: codes.length };

    // Recalcula o estágio de pós-venda dos clientes sincronizados (espera →
    // aprovado → d30/d60/d90/d120). Assim os clientes aparecem no Kanban de
    // pós-venda logo após o sync, sem esperar o cron. A função é segura:
    // respeita pos_venda_manual e não rebaixa quem está em "espera".
    try {
      const { error: rpcErr } = await supabase.rpc("recompute_pos_venda_stages");
      out.pos_venda_recompute = rpcErr ? { error: rpcErr.message } : { ok: true };
    } catch (e) {
      out.pos_venda_recompute = { error: e instanceof Error ? e.message : String(e) };
    }

    await supabase.from("settings").upsert({ key: "last_igreen_sync_background", value: new Date().toISOString() }, { onConflict: "key" });
  } catch (err) {
    out.success = false;
    out.error = err instanceof Error ? err.message : String(err);
    console.error("[sync-all background]", err);
  } finally {
    if (out.success) await updateAutomationTimestamps(supabase, consultantId, out);
    // Persiste os counts da Fase B no último run do consultor. Sem isso a UI
    // (IGreenSyncStatusBar) nunca sabe se network/telecom/seguros/boletos
    // rodaram — a Fase A já tinha finalizado o `igreen_sync_runs` antes.
    if (consultantId) {
      try {
        const { data: lastRun } = await supabase
          .from("igreen_sync_runs")
          .select("id, counts")
          .eq("consultant_id", consultantId)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastRun?.id) {
          const extras: Record<string, unknown> = {};
          for (const k of ["network","metrics","boletos","telecom","seguros","devolutivas","cashback","details","alerts","portal_identity","diagnostics","full_extras","full_extras_error"]) {
            if (out[k] != null) extras[k] = out[k];
          }
          extras._background_finished_at = new Date().toISOString();
          extras._background_success = out.success;
          if (out.error) extras._background_error = out.error;
          const mergedCounts = { ...(lastRun.counts as Record<string, unknown> || {}), extras };
          await supabase.from("igreen_sync_runs").update({ counts: mergedCounts }).eq("id", lastRun.id);
        }
      } catch (persistErr) {
        console.warn("[sync-all background] failed to persist extras:", persistErr instanceof Error ? persistErr.message : String(persistErr));
      }
    }
    console.log("[sync-all background] finished", JSON.stringify(out).slice(0, 500));
  }
}

// =====================================================
// MULTI-CONTA: percorre todas as contas iGreen do consultor em ordem de
// `position` (1 = principal) e sincroniza uma por uma. Cada conta grava seus
// clientes marcados com `igreen_account_id`, evitando misturar carteiras de
// contas diferentes. Se o consultor só tem 1 conta (a principal), o
// comportamento é idêntico ao de antes.
// deno-lint-ignore no-explicit-any
async function syncAllAccountsForConsultant(
  supabase: any,
  worker: { url: string; secret: string },
  consultantId: string,
  mode: string,
  fallbackEmail?: string | null,
  fallbackPassword?: string | null,
): Promise<Record<string, unknown>> {
  const { data: accounts } = await supabase
    .from("igreen_portal_accounts")
    .select("id, position, label, portal_email, portal_password, last_sync_at")
    .eq("consultant_id", consultantId)
    .order("position", { ascending: true });

  const list = (accounts || []) as Array<{ id: string; position: number; label: string | null; portal_email: string; portal_password: string; last_sync_at: string | null }>;

  // Compatibilidade: consultor sem nenhuma linha em igreen_portal_accounts
  // ainda (ex.: credencial antiga não migrada) — usa o fallback direto, sem
  // account_id (comportamento legado).
  if (list.length === 0) {
    if (!fallbackEmail || !fallbackPassword) {
      return { success: false, error: "Nenhuma conta iGreen configurada para este consultor." };
    }
    return await syncOneConsultant(supabase, worker, fallbackEmail, fallbackPassword, consultantId, mode, null);
  }

  const results: Record<string, unknown>[] = [];
  const STALE_MS = 6 * 60 * 60 * 1000; // 6 h
  for (const acc of list) {
    // FORÇA sync_all na PRIMEIRA vez que uma subconta é encontrada (last_sync_at NULL)
    // ou quando a última sync completa é > 6 h. Assim, contas recém-adicionadas
    // (ex.: Nilma) puxam TODOS os clientes + rede na primeira execução, mesmo
    // que o cron esteja rodando em modo enrich_only.
    const lastSync = acc.last_sync_at ? new Date(acc.last_sync_at).getTime() : 0;
    const isStale = !lastSync || Date.now() - lastSync > STALE_MS;
    const accMode = isStale && mode === "enrich_only" ? "sync_all" : mode;
    console.log(`[multi-account] sync conta position=${acc.position} (${acc.label || acc.portal_email}) consultant=${consultantId} mode=${accMode}${accMode !== mode ? " (forced full)" : ""}`);
    try {
      const r = await syncOneConsultant(supabase, worker, acc.portal_email, acc.portal_password, consultantId, accMode, acc.id);
      results.push({ account_id: acc.id, position: acc.position, label: acc.label, mode: accMode, ...r });
      // Marca last_sync_at após qualquer sync completa (não só quando o worker
      // atualiza igreen_consultor_id). Sem isso, a subconta ficaria eternamente
      // sendo forçada a sync_all a cada 6 h mesmo com sync bem-sucedida.
      if (r?.success && (accMode === "sync_all" || accMode === "sync")) {
        await supabase.from("igreen_portal_accounts")
          .update({ last_sync_at: new Date().toISOString() })
          .eq("id", acc.id);
      }
    } catch (err) {
      results.push({ account_id: acc.id, position: acc.position, label: acc.label, mode: accMode, success: false, error: err instanceof Error ? err.message : String(err) });
    }
    // Pausa entre contas para não sobrecarregar o proxy/portal com logins em sequência.
    await new Promise((res) => setTimeout(res, 2000));
  }
  const anySuccess = results.some((r) => r.success);
  return { success: anySuccess, mode, accounts_synced: results.length, results };
}

// deno-lint-ignore no-explicit-any
function scheduleSyncAllBackgroundPhase(...args: any[]): void {
  const task = runSyncAllBackgroundPhase(args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7]);
  // @ts-ignore EdgeRuntime existe no Supabase edge runtime
  try { EdgeRuntime.waitUntil(task); } catch { /* se não houver EdgeRuntime, task já iniciou */ }
}

// =====================================================
// v18 — persistFullExtras: consome o payload `full_extras` do worker (v18)
// e grava cada bloco na tabela específica. Todos os upserts são idempotentes.
// Blocos suportados: telecom.linhas, telecom.faturas, telecom.comissoes,
// seguros.comissoes, seguros.sinistros, seguros.apolices (enriquece
// igreen_seguros_customers), network.history (snapshot mensal).
// =====================================================
// deno-lint-ignore no-explicit-any
async function persistFullExtras(supabase: any, consultantId: string | null, fullExtras: any): Promise<Record<string, unknown>> {
  if (!consultantId || !fullExtras?.blocks) return { skipped: true };
  const summary: Record<string, unknown> = {};
  const blocks = fullExtras.blocks as Record<string, { items?: any[]; data?: any; single?: boolean }>;

  const strOrNull = (v: unknown): string | null => {
    if (v == null || v === "") return null;
    return String(v).trim() || null;
  };
  const centsFromValor = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = parseFloat(String(v).replace(/[^\d,.-]/g, "").replace(",", "."));
    return isNaN(n) ? null : Math.round(n * 100);
  };
  const dateOrNull = (v: unknown): string | null => {
    if (!v) return null;
    const s = String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  const mesRef = (v: unknown, fallback = new Date().toISOString().slice(0, 7)): string => {
    if (!v) return fallback;
    const s = String(v);
    const m = s.match(/(\d{4})[-/](\d{1,2})/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}`;
    return fallback;
  };
  const upsertBatch = async (table: string, rows: any[], onConflict: string): Promise<number> => {
    if (rows.length === 0) return 0;
    let saved = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error, count } = await supabase.from(table).upsert(batch, { onConflict, ignoreDuplicates: false, count: "exact" });
      if (error) { console.warn(`[full_extras] ${table} upsert:`, error.message); }
      else saved += count ?? batch.length;
    }
    return saved;
  };

  // Telecom → linhas
  const linhas = blocks["telecom.linhas"]?.items || [];
  if (linhas.length) {
    const rows = linhas.map((it: any) => ({
      consultant_id: consultantId,
      idcnxtelecom: strOrNull(it.idcnxtelecom ?? it.idConexao ?? it.id),
      msisdn: strOrNull(it.msisdn ?? it.numero ?? it.linha ?? it.telefone) ?? `auto:${stableIntId(JSON.stringify(it))}`,
      iccid: strOrNull(it.iccid ?? it.chipIccid),
      plano: strOrNull(it.plano ?? it.planoNome ?? it.plan),
      status: strOrNull(it.status ?? it.situacao),
      cliente_nome: strOrNull(it.cliente ?? it.nome ?? it.titular),
      cliente_cpf: strOrNull(it.cpf ?? it.documento),
      ativada_em: dateOrNull(it.ativadaEm ?? it.dataAtivacao ?? it.ativada_em),
      cancelada_em: dateOrNull(it.canceladaEm ?? it.dataCancelamento ?? it.cancelada_em),
      raw: it,
    }));
    summary.telecom_linhas = await upsertBatch("igreen_telecom_linhas", rows, "consultant_id,msisdn");
  }

  // Telecom → faturas
  const faturas = blocks["telecom.faturas"]?.items || [];
  if (faturas.length) {
    const rows = faturas.map((it: any) => ({
      consultant_id: consultantId,
      idcnxtelecom: strOrNull(it.idcnxtelecom ?? it.idConexao ?? it.id) ?? String(stableIntId(JSON.stringify(it))),
      msisdn: strOrNull(it.msisdn ?? it.numero ?? it.linha),
      mes_referencia: mesRef(it.mesReferencia ?? it.mes ?? it.competencia ?? it.vencimento),
      valor_cents: centsFromValor(it.valor ?? it.valorTotal ?? it.valorPago),
      status: strOrNull(it.status ?? it.situacao),
      vencimento: dateOrNull(it.vencimento ?? it.dataVencimento),
      pago_em: dateOrNull(it.pagoEm ?? it.dataPagamento),
      raw: it,
    }));
    summary.telecom_faturas = await upsertBatch("igreen_telecom_faturas", rows, "consultant_id,idcnxtelecom,mes_referencia");
  }

  // Telecom → comissões
  const telecomComissoes = blocks["telecom.comissoes"]?.items || [];
  if (telecomComissoes.length) {
    const rows = telecomComissoes.map((it: any) => ({
      consultant_id: consultantId,
      mes_referencia: mesRef(it.mesReferencia ?? it.mes ?? it.competencia),
      origem: strOrNull(it.origem ?? it.tipo ?? it.categoria),
      valor_cents: centsFromValor(it.valor ?? it.valorComissao),
      status: strOrNull(it.status ?? it.situacao),
      descricao: strOrNull(it.descricao ?? it.detalhes),
      external_id: strOrNull(it.id ?? it.idComissao) ?? String(stableIntId(JSON.stringify(it))),
      raw: it,
    }));
    summary.telecom_comissoes = await upsertBatch("igreen_telecom_comissoes", rows, "consultant_id,external_id,mes_referencia");
  }

  // Seguros → comissões
  const segurosComissoes = blocks["seguros.comissoes"]?.items || [];
  if (segurosComissoes.length) {
    const rows = segurosComissoes.map((it: any) => ({
      consultant_id: consultantId,
      mes_referencia: mesRef(it.mesReferencia ?? it.mes ?? it.competencia),
      origem: strOrNull(it.origem ?? it.tipo ?? it.categoria),
      valor_cents: centsFromValor(it.valor ?? it.valorComissao),
      status: strOrNull(it.status ?? it.situacao),
      descricao: strOrNull(it.descricao ?? it.detalhes),
      external_id: strOrNull(it.id ?? it.idComissao) ?? String(stableIntId(JSON.stringify(it))),
      raw: it,
    }));
    summary.seguros_comissoes = await upsertBatch("igreen_seguros_comissoes", rows, "consultant_id,external_id,mes_referencia");
  }

  // Seguros → sinistros/renovações → enriquecem igreen_seguros_customers por apolice
  const sinistros = blocks["seguros.sinistros"]?.items || [];
  const renovacoes = blocks["seguros.renovacoes"]?.items || [];
  if (sinistros.length || renovacoes.length) {
    const byApolice = new Map<string, { sinistros: any[]; renov: any }>();
    for (const s of sinistros) {
      const key = String(s.apoliceId ?? s.apolice_id ?? s.idApolice ?? "");
      if (!key) continue;
      if (!byApolice.has(key)) byApolice.set(key, { sinistros: [], renov: null });
      byApolice.get(key)!.sinistros.push(s);
    }
    for (const r of renovacoes) {
      const key = String(r.apoliceId ?? r.apolice_id ?? r.idApolice ?? "");
      if (!key) continue;
      if (!byApolice.has(key)) byApolice.set(key, { sinistros: [], renov: null });
      byApolice.get(key)!.renov = r;
    }
    let updated = 0;
    for (const [apoliceId, v] of byApolice) {
      const patch: Record<string, unknown> = {};
      if (v.sinistros.length) patch.sinistros = v.sinistros;
      if (v.renov) {
        patch.renovacao_prevista_at = dateOrNull(v.renov.dataRenovacao ?? v.renov.previsao);
        patch.cashback_previsto_cents = centsFromValor(v.renov.cashback ?? v.renov.valorCashback);
      }
      if (Object.keys(patch).length === 0) continue;
      const { error } = await supabase.from("igreen_seguros_customers")
        .update(patch).eq("consultant_id", consultantId).eq("apolice_id", apoliceId);
      if (!error) updated++;
    }
    summary.seguros_enrich_updated = updated;
  }

  // Rede → snapshot mensal
  const netHist = blocks["network.history"]?.items || [];
  if (Array.isArray(netHist) && netHist.length) {
    const rows = netHist.filter((h: any) => h.mes).map((h: any) => ({
      consultant_id: consultantId,
      mes_referencia: h.mes,
      payload: { count: h.count ?? (h.items?.length || 0), error: h.error ?? null, items: h.items?.slice(0, 500) ?? null },
    }));
    summary.network_snapshots = await upsertBatch("igreen_network_snapshots", rows, "consultant_id,mes_referencia");
  }

  summary.per_route_summary = fullExtras.per_route_summary || null;
  return summary;
}


// =====================================================
// syncOneConsultant — chama o worker e processa os dados
// =====================================================
// =====================================================
// Persistência de métricas (painel/rotinas) e boletos — Fase 2
// =====================================================
// deno-lint-ignore no-explicit-any
async function persistMetrics(supabase: any, consultantId: string | null, metrics: any): Promise<Record<string, unknown>> {
  if (!consultantId || !metrics) return { metrics_saved: false, metrics_received: metrics ? 1 : 0 };
  const mes = safeStr(metrics.mes) || new Date().toISOString().slice(0, 7);
  const kpis = metrics.overview?.kpis || {};
  const det = kpis.clientesDetalhe || {};
  const rede = metrics.overview?.rede || {};
  const resumo = metrics.resumo_clientes || {};
  const row = {
    consultant_id: consultantId,
    mes_ref: mes,
    clientes_total: kpis.clientes ?? null,
    clientes_green: det.green ?? null,
    clientes_telecom: det.telecom ?? null,
    clientes_seguros: det.seguros ?? null,
    licenciados_ativos: kpis.licenciadosAtivos ?? null,
    licenciados_total: kpis.licenciadosTotal ?? null,
    diretos: kpis.diretos != null ? Number(kpis.diretos) : null,
    diretos_ativos: kpis.diretosAtivos != null ? Number(kpis.diretosAtivos) : null,
    gp_mes: safeNum(kpis.gpMes),
    gi_mes: safeNum(kpis.giMes),
    rede_tamanho: rede.tamanho ?? null,
    total_cadastros: resumo.totalCadastros ?? null,
    mwh: safeNum(resumo.mwh),
    validados_n: resumo.validados?.n ?? null,
    aguardando_n: resumo.aguardando?.n ?? null,
    devolutivas_n: resumo.devolutivas?.n ?? null,
    cancelados_n: resumo.cancelados?.n ?? null,
    reprovados_n: resumo.reprovados?.n ?? null,
    ag_assinatura_n: resumo.agAssinatura?.n ?? null,
    kwh_validados: safeNum(resumo.kwhValidados),
    rotina_diaria: metrics.rotina_diaria ?? null,
    rotina_semanal: metrics.rotina_semanal ?? null,
    rotina_mensal: metrics.rotina_mensal ?? null,
    painel_onboarding_json: metrics.painel_onboarding ?? null,
    painel_inativos_json: metrics.painel_inativos ?? null,
    painel_ranking_json: metrics.painel_ranking ?? null,
    telecom_resumo_json: metrics.telecom_resumo ?? null,
    seguros_resumo_json: metrics.seguros_resumo ?? null,
    raw_json: metrics,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("igreen_consultant_metrics")
    .upsert(row, { onConflict: "consultant_id,mes_ref", ignoreDuplicates: false });
  if (error) { console.error("metrics upsert:", error.message); return { metrics_saved: false, metrics_received: 1, metrics_error: error.message }; }
  return { metrics_saved: true, metrics_received: 1, mes_ref: mes };
}

// deno-lint-ignore no-explicit-any
async function persistBoletos(supabase: any, consultantId: string | null, boletos: any[]): Promise<Record<string, unknown>> {
  if (!consultantId || !Array.isArray(boletos) || boletos.length === 0) return { boletos_saved: 0, boletos_received: Array.isArray(boletos) ? boletos.length : 0 };
  const parseDate = (v: unknown): string | null => {
    const s = safeStr(v); if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) { const [, d, mo, y] = m; return `${y.length === 2 ? "20" + y : y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`; }
    return null;
  };
  const rows = boletos.map((b) => ({
    consultant_id: consultantId,
    idcliente: Number(b.idcliente),
    nome: safeStr(b.nome),
    cidade: safeStr(b.cidade),
    uf: safeStr(b.uf),
    mes_referencia: safeStr(b.mesReferencia),
    total: safeNum(b.total),
    valor_fornecedora: safeNum(b.valorFornecedora),
    valor_distribuidora: safeNum(b.valorDistribuidora),
    vencimento: parseDate(b.vencimento),
    pagamento: parseDate(b.pagamento),
    status: safeStr(b.status),
    dias_atraso: b.diasAtraso != null ? Number(b.diasAtraso) : null,
    injecao: typeof b.injecao === "boolean" ? b.injecao : null,
    kwh_compensado: safeNum(b.kwhCompensado),
    conta_unica: typeof b.contaUnica === "boolean" ? b.contaUnica : null,
    fornecedora: safeStr(b.fornecedora),
    tipo_pagamento: safeStr(b.tipoPagamento),
    url_invoice: safeStr(b.urlinvoice),
    url_boleto: safeStr(b.urlboleto),
    raw_json: b,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })).filter((r) => Number.isFinite(r.idcliente) && r.idcliente > 0 && r.mes_referencia);
  let saved = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { data, error } = await supabase
      .from("igreen_customer_boletos")
      .upsert(batch, { onConflict: "consultant_id,idcliente,mes_referencia", ignoreDuplicates: false })
      .select("id");
    if (error) console.error("boletos upsert:", error.message);
    else saved += data?.length || 0;
  }

  // Preenche customer_id via igreen_code = idcliente. Sem isso o botão
  // "Conversar" não aparece na tela de boletos (view faz LEFT JOIN por customer_id).
  // Roda em lotes de 200 idclientes para não gerar query gigante.
  try {
    const idclienteList = rows.map((r) => r.idcliente).filter(Boolean);
    for (let i = 0; i < idclienteList.length; i += 200) {
      const chunk = idclienteList.slice(i, i + 200).map(String);
      // Busca os customer_id correspondentes
      const { data: cust } = await supabase
        .from("customers")
        .select("id, igreen_code")
        .eq("consultant_id", consultantId)
        .in("igreen_code", chunk);
      if (!cust || cust.length === 0) continue;
      // Atualiza cada boleto com o customer_id correto
      for (const c of cust as Array<{ id: string; igreen_code: string }>) {
        await supabase
          .from("igreen_customer_boletos")
          .update({ customer_id: c.id })
          .eq("consultant_id", consultantId)
          .eq("idcliente", Number(c.igreen_code))
          .is("customer_id", null); // só atualiza quem ainda não tem
      }
    }
  } catch (e) {
    console.warn("[boletos] customer_id match falhou (nao critico):", e instanceof Error ? e.message : e);
  }

  return { boletos_saved: saved, boletos_received: boletos.length };
}

// Persiste carteira TELECOM (Opção A — tabela dedicada).
// deno-lint-ignore no-explicit-any
async function persistTelecom(supabase: any, consultantId: string | null, items: any[]): Promise<Record<string, unknown>> {
  if (!consultantId || !Array.isArray(items) || items.length === 0) return { telecom_saved: 0, telecom_received: Array.isArray(items) ? items.length : 0 };
  const parseDate = (v: unknown): string | null => {
    const s = safeStr(v); if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) { const [, d, mo, y] = m; return `${y.length === 2 ? "20" + y : y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`; }
    return null;
  };
  const seen = new Set<number>();
  const rows = [];
  for (const c of items) {
    const identity = `${safeStr(c.numero ?? c.linha ?? c.telefone ?? c.msisdn) || ""}|${safeStr(c.cliente ?? c.nome ?? c.nomeCliente ?? c.titular ?? c.assinante) || ""}|${safeStr(c.licenciado ?? c.nomeLicenciado ?? c.consultor ?? c.consultorNome) || ""}`;
    const idc = Number(c._idcnxtelecom ?? c.idcnxtelecom ?? c.idConexao ?? c.id ?? c.codigo ?? c.idcliente) || stableIntId(identity);
    if (!Number.isFinite(idc) || idc <= 0 || seen.has(idc)) continue;
    seen.add(idc);
    rows.push({
      consultant_id: consultantId,
      idcnxtelecom: idc,
      nome: safeStr(c.cliente ?? c.nome ?? c.nomeCliente ?? c.titular ?? c.assinante),
      cidade: safeStr(c.cidade),
      uf: safeStr(c.uf),
      numero: safeStr(c.numero ?? c.linha ?? c.telefone ?? c.msisdn ?? c.celular),
      licenciado: safeStr(c.licenciado ?? c.nomeLicenciado ?? c.consultor ?? c.consultorNome),
      status: safeStr(c.status_coluna ?? c.status ?? c.situacao ?? c.tipo),
      status_label: safeStr(c.status_label ?? c.statusLabel ?? c.status ?? c.situacao ?? c.tipo),
      data: parseDate(c.data ?? c.createdAt ?? c.dataCadastro ?? c.dataAtivacao),
      fatura_valor: safeNum(c._fatura_valor ?? c.valor ?? c.valorFatura ?? c.mensalidade),
      fatura_status: safeStr(c._fatura_status ?? c.statusFatura ?? c.fatura_status),
      fatura_mes_referencia: safeStr(c._fatura_mes ?? c.mesReferencia ?? c.mes_referencia),
      raw_json: c,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  let saved = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { data, error } = await supabase
      .from("igreen_telecom_customers")
      .upsert(batch, { onConflict: "consultant_id,idcnxtelecom", ignoreDuplicates: false })
      .select("id");
    if (error) console.error("telecom upsert:", error.message);
    else saved += data?.length || 0;
  }
  return { telecom_saved: saved, telecom_received: items.length, telecom_valid_rows: rows.length };
}

// Persiste CASHBACK por origem no snapshot de métricas (raw) + colunas de saldo.
// deno-lint-ignore no-explicit-any
async function persistCashback(supabase: any, consultantId: string | null, cashback: any): Promise<Record<string, unknown>> {
  if (!consultantId || !cashback || typeof cashback !== "object") return { cashback_saved: false, cashback_received: cashback ? 1 : 0 };
  const mes = new Date().toISOString().slice(0, 7);
  const green = cashback.green || {};
  const telecom = cashback.telecom || {};
  const seguros = cashback.seguros || {};
  const { error } = await supabase
    .from("igreen_consultant_metrics")
    .update({
      cashback_green_saldo: safeNum(green.saldo),
      cashback_telecom_saldo: safeNum(telecom.saldo),
      cashback_seguros_saldo: safeNum(seguros.saldo),
      cashback_json: cashback,
      updated_at: new Date().toISOString(),
    })
    .eq("consultant_id", consultantId)
    .eq("mes_ref", mes);
  if (error) { console.error("cashback update:", error.message); return { cashback_saved: false, cashback_received: 1, cashback_error: error.message }; }
  return { cashback_saved: true, cashback_received: 1 };
}

// Gera ALERTAS acionáveis (bot_handoff_alerts) a partir dos dados sincronizados,
// SÓ para os toggles ligados. Faz DEDUP: não recria alerta aberto (resolved_at
// null) do mesmo tema para o mesmo cliente — evita flood no cron diário.
// deno-lint-ignore no-explicit-any
async function generateAlerts(supabase: any, consultantId: string | null, toggles: Record<string, boolean>, data: any): Promise<Record<string, unknown>> {
  if (!consultantId) return { alerts_created: 0 };
  const wantTypes: string[] = [];
  if (toggles.alert_boletos_vencendo) wantTypes.push("igreen_boleto_vencendo");
  if (toggles.alert_devolutivas) wantTypes.push("igreen_devolutiva", "igreen_devolutiva_impeditiva");
  if (toggles.alert_licencas_expirando) wantTypes.push("igreen_licencas_expirando");
  if (wantTypes.length === 0) return { alerts_created: 0 };

  // Carrega alertas abertos existentes (dedup key = alert_type + idcliente).
  const openKeys = new Set<string>();
  const { data: existing } = await supabase
    .from("bot_handoff_alerts")
    .select("alert_type, metadata")
    .eq("consultant_id", consultantId)
    .is("resolved_at", null)
    .in("alert_type", wantTypes);
  for (const e of (existing || []) as Array<{ alert_type: string; metadata: Record<string, unknown> | null }>) {
    const idc = e.metadata?.idcliente ?? "_";
    openKeys.add(`${e.alert_type}|${idc}`);
  }

  const rows: Record<string, unknown>[] = [];
  const pushOnce = (alert_type: string, idcliente: unknown, row: Record<string, unknown>) => {
    const key = `${alert_type}|${idcliente ?? "_"}`;
    if (openKeys.has(key)) return;
    openKeys.add(key);
    rows.push(row);
  };

  // Boletos vencidos (não alerta os "a vencer"/"disponível" — só o que já venceu).
  if (toggles.alert_boletos_vencendo) {
    for (const b of (data?.boletos || [])) {
      const st = String(b.status || "").toLowerCase();
      if (!st.includes("vencid")) continue;
      pushOnce("igreen_boleto_vencendo", b.idcliente, {
        consultant_id: consultantId,
        alert_type: "igreen_boleto_vencendo",
        reason: `Boleto ${st} de ${b.nome || "cliente"} (venc. ${b.vencimento || "?"}, R$ ${b.total ?? "?"})`,
        phone: normalizePhone(String(b.celular || "")) || null,
        metadata: { idcliente: b.idcliente, vencimento: b.vencimento, status: b.status, url: b.urlboleto, total: b.total },
      });
    }
  }
  // Devolutivas (prioriza impeditivas)
  if (toggles.alert_devolutivas) {
    for (const d of (data?.devolutivas || [])) {
      const at = d.impeditiva ? "igreen_devolutiva_impeditiva" : "igreen_devolutiva";
      const idc = d._codigo ?? d.codigo;
      pushOnce(at, idc, {
        consultant_id: consultantId,
        alert_type: at,
        reason: `Devolutiva${d.impeditiva ? " IMPEDITIVA" : ""}: ${d.cliente || d.nome || "cliente"} — ${d.obs || d.motivo || d._categoria || "verificar"}`,
        phone: null,
        metadata: { idcliente: idc, categoria: d._categoria, campo: d.campo, impeditiva: d.impeditiva },
      });
    }
  }
  // Licenças expirando (1 alerta agregado por sync, sem idcliente).
  // Preferência: /painel/licencas-expirando (mais rico); fallback: overview.alertas.licencas.
  if (toggles.alert_licencas_expirando) {
    const licExp = data?.metrics?.licencas_expirando || null;
    const licFallback = data?.metrics?.overview?.alertas?.licencas || {};
    const counts = licExp?.counts || licFallback || {};
    const total = Number(counts.aVencer || 0) + Number(counts.vencida || 0) + Number(counts.expirada || 0);
    if (total > 0) {
      pushOnce("igreen_licencas_expirando", null, {
        consultant_id: consultantId,
        alert_type: "igreen_licencas_expirando",
        reason: `Licenças na rede: ${counts.aVencer || 0} a vencer, ${counts.vencida || 0} vencidas, ${counts.expirada || 0} expiradas`,
        phone: null,
        metadata: { counts, itens: licExp?.itens ? licExp.itens.slice(0, 50) : undefined },
      });
    }
  }

  if (rows.length === 0) return { alerts_created: 0 };
  const capped = rows.slice(0, 300);
  const { data: ins, error } = await supabase.from("bot_handoff_alerts").insert(capped).select("id");
  if (error) { console.error("alerts insert:", error.message); return { alerts_created: 0, alerts_error: error.message }; }
  return { alerts_created: ins?.length || 0 };
}

// Persiste carteira SEGUROS (Opção A — tabela dedicada).
// deno-lint-ignore no-explicit-any
async function persistSeguros(supabase: any, consultantId: string | null, items: any[]): Promise<Record<string, unknown>> {
  if (!consultantId || !Array.isArray(items) || items.length === 0) return { seguros_saved: 0, seguros_received: Array.isArray(items) ? items.length : 0 };
  const seen = new Set<string>();
  const rows = [];
  for (const c of items) {
    const sid = safeStr(c.id ?? c.seguro_id ?? c.apolice_id ?? c.codigo ?? c.idcotacao)
      || `auto:${stableIntId(`${safeStr(c.segurado ?? c.cliente ?? c.nome ?? c.nomeCliente) || ""}|${safeStr(c.placa) || ""}|${safeStr(c.modelo ?? c.veiculo ?? c.descricaoVeiculo) || ""}`)}`;
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    rows.push({
      consultant_id: consultantId,
      seguro_id: sid,
      segurado: safeStr(c.segurado ?? c.cliente ?? c.nome ?? c.nomeCliente),
      modelo: safeStr(c.modelo ?? c.veiculo ?? c.descricaoVeiculo),
      placa: safeStr(c.placa),
      fipe: safeNum(c.fipe ?? c.valorFipe),
      mensal: safeNum(c.mensal ?? c.mensalidade ?? c.valorMensal ?? c.valor),
      status: safeStr(c.status_coluna ?? c.status ?? c.situacao ?? c.tipo),
      status_label: safeStr(c.status_label ?? c.statusLabel ?? c.status ?? c.situacao ?? c.tipo),
      cidade: safeStr(c.cidade),
      uf: safeStr(c.uf),
      licenciado: safeStr(c.licenciado ?? c.nomeLicenciado ?? c.consultor ?? c.consultorNome),
      raw_json: c,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  let saved = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { data, error } = await supabase
      .from("igreen_seguros_customers")
      .upsert(batch, { onConflict: "consultant_id,seguro_id", ignoreDuplicates: false })
      .select("id");
    if (error) console.error("seguros upsert:", error.message);
    else saved += data?.length || 0;
  }
  return { seguros_saved: saved, seguros_received: items.length, seguros_valid_rows: rows.length };
}

// Persiste DEVOLUTIVAS detalhadas (categoria/impeditiva/campo/data).
// deno-lint-ignore no-explicit-any
async function persistDevolutivas(supabase: any, consultantId: string | null, items: any[]): Promise<Record<string, unknown>> {
  if (!consultantId || !Array.isArray(items) || items.length === 0) return { devolutivas_saved: 0, devolutivas_received: Array.isArray(items) ? items.length : 0 };
  // resolve customer_id por igreen_code (codigo) quando possível
  const codes = items.map((d) => safeStr(d._codigo ?? d.codigo)).filter(Boolean) as string[];
  const codeToCustomer = new Map<string, string>();
  for (let i = 0; i < codes.length; i += 200) {
    const chunk = codes.slice(i, i + 200);
    const { data } = await supabase.from("customers").select("id, igreen_code").eq("consultant_id", consultantId).in("igreen_code", chunk);
    for (const c of (data || []) as Array<{ id: string; igreen_code: string }>) codeToCustomer.set(c.igreen_code, c.id);
  }
  const seen = new Set<string>();
  const rows = [];
  for (const d of items) {
    const idcliente = Number(d._codigo ?? d.codigo ?? d.idcliente ?? d.id);
    const campo = safeStr(d.campo) || "_";
    const categoria = safeStr(d._categoria ?? d.categoria) || "outros";
    const dedup = `${idcliente}|${campo}|${categoria}`;
    if (!Number.isFinite(idcliente) || idcliente <= 0 || seen.has(dedup)) continue;
    seen.add(dedup);
    const code = safeStr(d._codigo ?? d.codigo);
    rows.push({
      consultant_id: consultantId,
      iddevolutiva: d.iddevolutiva != null ? Number(d.iddevolutiva) : null,
      idcliente,
      customer_id: code ? (codeToCustomer.get(code) || null) : null,
      nome: safeStr(d.cliente ?? d.nome),
      cidade: safeStr(d.cidade),
      uf: safeStr(d.uf),
      licenciado: safeStr(d._licenciado ?? d.licenciado),
      categoria,
      campo,
      motivo: cleanDevolutiva(safeStr(d.obs ?? d.motivo) || ""),
      impeditiva: typeof d.impeditiva === "boolean" ? d.impeditiva : null,
      propria: typeof d.propria === "boolean" ? d.propria : null,
      data_devolutiva: safeStr(d.data) || null,
      raw_json: d,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  let saved = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { data, error } = await supabase
      .from("igreen_customer_devolutivas")
      .upsert(batch, { onConflict: "consultant_id,idcliente,campo,categoria", ignoreDuplicates: false })
      .select("id");
    if (error) console.error("devolutivas upsert:", error.message);
    else saved += data?.length || 0;
  }
  return { devolutivas_saved: saved, devolutivas_received: items.length };
}

// Reordena os códigos para enriquecer PRIMEIRO quem ainda não tem ficha
// detalhada (last_enriched_at IS NULL). Como o loop de enriquecimento tem
// orçamento de tempo limitado, sem essa priorização os mesmos primeiros
// códigos eram reprocessados a cada sync e o fim da fila nunca era alcançado.
// deno-lint-ignore no-explicit-any
async function prioritizeUnenrichedCodes(supabase: any, consultantId: string | null, codes: string[]): Promise<string[]> {
  if (!consultantId || !Array.isArray(codes) || codes.length === 0) return codes;
  try {
    const enriched = new Set<string>();
    for (let i = 0; i < codes.length; i += 200) {
      const chunk = codes.slice(i, i + 200);
      const { data } = await supabase
        .from("customers")
        .select("igreen_code")
        .eq("consultant_id", consultantId)
        .not("last_enriched_at", "is", null)
        .in("igreen_code", chunk);
      for (const c of (data || []) as Array<{ igreen_code: string }>) {
        if (c.igreen_code) enriched.add(String(c.igreen_code));
      }
    }
    const pending = codes.filter((c) => !enriched.has(c));
    const done = codes.filter((c) => enriched.has(c));
    // Pendentes primeiro; os já enriquecidos no fim (re-checagem se sobrar tempo).
    return [...pending, ...done];
  } catch {
    // Em qualquer falha, mantém a ordem original (não quebra o sync).
    return codes;
  }
}

// Aplica a ficha detalhada (/clientes-green/boletos/{id}) nos customers:
// deno-lint-ignore no-explicit-any
async function applyCustomerDetails(supabase: any, consultantId: string | null, details: any[], igreenAccountId: string | null = null): Promise<Record<string, unknown>> {
  if (!consultantId || !Array.isArray(details) || details.length === 0) return { details_applied: 0 };
  let applied = 0;
  for (const d of details) {
    // idcliente pode vir como `idcliente` (api-green-connection) ou `idcliente`
    // já injetado pelo worker no fetchCustomerFull.
    const code = safeStr(d.idcliente || d.id);
    if (!code) continue;
    const patch: Record<string, unknown> = {};
    // Documento
    const cpf = safeStr(d.cpf_cnpj || d.cpf); if (cpf) patch.cpf = cpf.replace(/\D/g, "");
    // Instalação / distribuidora
    const inst = safeStr(d.numinstalacao || d.instalacao); if (inst) patch.numero_instalacao = inst;
    const numCli = safeStr(d.num_cliente_distribuidora || d.numCliente); if (numCli) patch.num_cliente_distribuidora = numCli;
    const conc = safeStr(d.concessionaria); if (conc) { patch.concessionaria = conc; patch.distribuidora = conc; }
    const forn = safeStr(d.fornecedora); if (forn) patch.fornecedora = forn;
    const sit = safeStr(d.situacao); if (sit) patch.situacao_igreen = sit;
    if (typeof d.trocaTitularidade === "boolean") patch.transferir_titularidade = d.trocaTitularidade;
    if (typeof d.transferir_titularidade === "boolean") patch.transferir_titularidade = d.transferir_titularidade;
    if (typeof d.contaUnica === "boolean") patch.contaunica = d.contaUnica;
    if (typeof d.contaunica === "boolean") patch.contaunica = d.contaunica;
    if (typeof d.possui_placas === "boolean") patch.possui_placas = d.possui_placas;
    // Consumo / datas
    const consumo = safeNum(d.consumomedio ?? d.consumo); if (consumo != null) patch.media_consumo = consumo;
    const desc = safeNum(d.desconto_cliente); if (desc != null) patch.desconto_cliente = desc;
    const dAtivo = safeStr(d.dataAtivo); if (dAtivo && /^\d{4}-\d{2}-\d{2}/.test(dAtivo)) patch.data_ativo_igreen = dAtivo.slice(0, 10);
    const dInj = safeStr(d.dataInjecao); if (dInj && /^\d{4}-\d{2}-\d{2}/.test(dInj)) patch.data_injecao_igreen = dInj.slice(0, 10);
    // Pessoais
    const lic = safeStr(d.licenciado); if (lic) patch.registered_by_name = lic;
    const nasc = safeStr(d.dtnasc || d.nascimento);
    if (nasc && /^\d{4}-\d{2}-\d{2}/.test(nasc)) patch.data_nascimento = nasc.slice(0, 10);
    const email = safeStr(d.email); if (email) patch.email = email;
    const cel = safeStr(d.celular); if (cel) patch.phone_whatsapp = normalizePhone(String(cel));
    // Endereço COMPLETO (novo)
    const cep = safeStr(d.cep); if (cep) patch.cep = cep.replace(/\D/g, "");
    const rua = safeStr(d.endereco || d.logradouro); if (rua) patch.address_street = rua;
    const num = safeStr(d.numero); if (num) patch.address_number = num;
    const compl = safeStr(d.complemento); if (compl) patch.address_complement = compl;
    const bairro = safeStr(d.bairro); if (bairro) patch.address_neighborhood = bairro;
    const cid = safeStr(d.cidade); if (cid) patch.address_city = cid;
    const uf = safeStr(d.uf); if (uf) patch.address_state = uf.toUpperCase();
    // Credenciais da distribuidora (apenas login — senha NÃO sincronizamos por decisão)
    const loginDist = safeStr(d.logindistribuidora); if (loginDist) patch.logindistribuidora = loginDist;
    // PJ (dump agregado no jsonb, se qualquer campo de PJ presente)
    const pjRazao = safeStr(d.razao);
    const pjCnpj = safeStr(d.cnpj);
    if (pjRazao || pjCnpj || d.fantasia || d.naturezajuridica || d.cargo || d.ie || d.localregistro) {
      patch.pj_jsonb = {
        cnpj: pjCnpj, razao: pjRazao, fantasia: safeStr(d.fantasia),
        naturezajuridica: safeStr(d.naturezajuridica), cargo: safeStr(d.cargo),
        ie: safeStr(d.ie), localregistro: safeStr(d.localregistro),
      };
      patch.possui_pj = true;
    }
    // Procurador
    const procNome = safeStr(d.testemunha_nome || d.procurador_nome);
    if (procNome) {
      patch.procurador_jsonb = {
        nome: procNome, cpf: safeStr(d.testemunha_cpf || d.procurador_cpf),
        datanasc: safeStr(d.testemunha_datanasc || d.procurador_datanasc),
        email: safeStr(d.testemunha_email || d.procurador_email),
        celular: safeStr(d.testemunha_celular || d.procurador_celular),
      };
      patch.possui_procurador = true;
    }
    patch.last_enriched_at = new Date().toISOString();
    if (Object.keys(patch).length === 1) continue; // apenas last_enriched_at

    let updQuery = supabase
      .from("customers")
      .update(patch)
      .eq("consultant_id", consultantId)
      .eq("igreen_code", code);
    if (igreenAccountId) updQuery = updQuery.eq("igreen_account_id", igreenAccountId);
    let { error } = await updQuery;
    // Alguns clientes têm registros DUPLICADOS com o mesmo igreen_code (dado
    // legado/importação). O update acima afeta as duas linhas de uma vez; se
    // o telefone real colidir com o índice único (phone_whatsapp,
    // consultant_id) — porque a outra linha duplicada ainda tem um placeholder
    // "sem_celular_..." — o update falha por completo e o enrich nunca marca
    // last_enriched_at, travando esse cliente para sempre. Retry sem o
    // telefone resolve: aplica os demais dados (CPF, endereço, etc.) e marca
    // como enriquecido mesmo assim.
    if (error && patch.phone_whatsapp) {
      const { phone_whatsapp: _drop, ...patchNoPhone } = patch;
      let retryQuery = supabase
        .from("customers")
        .update(patchNoPhone)
        .eq("consultant_id", consultantId)
        .eq("igreen_code", code);
      if (igreenAccountId) retryQuery = retryQuery.eq("igreen_account_id", igreenAccountId);
      const retry = await retryQuery;
      error = retry.error;
    }
    if (!error) applied++;
    else console.warn(`[enrich] update falhou para igreen_code=${code}:`, error.message);
  }
  return { details_applied: applied };
}

// Marca clientes que sumiram da carteira do portal.
// Todo customer com customer_origin='igreen_sync' desse consultor que NÃO
// veio no batch atual do Kanban recebe situacao_igreen='fora_da_carteira'.
// deno-lint-ignore no-explicit-any
async function markOutOfPortfolio(supabase: any, consultantId: string | null, customersBatch: any[]): Promise<Record<string, unknown>> {
  if (!consultantId || !Array.isArray(customersBatch) || customersBatch.length === 0) {
    return { out_of_portfolio_marked: 0, skipped: true };
  }
  const portalCodes = new Set(
    customersBatch
      .map((c: any) => safeStr(c?.igreen_code || c?.codigo))
      .filter((v): v is string => !!v),
  );
  if (portalCodes.size === 0) return { out_of_portfolio_marked: 0, skipped: true };

  // Busca todos igreen_codes existentes do consultor (paginado — supabase limita 1000).
  const existing: { id: string; igreen_code: string | null; situacao_igreen: string | null }[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("customers")
      .select("id, igreen_code, situacao_igreen")
      .eq("consultant_id", consultantId)
      .eq("customer_origin", "igreen_sync")
      .not("igreen_code", "is", null)
      .range(from, from + pageSize - 1);
    if (error) {
      console.error("markOutOfPortfolio select:", error.message);
      return { out_of_portfolio_marked: 0, error: error.message };
    }
    const rows = data || [];
    existing.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  const toMark = existing
    .filter((r) => r.igreen_code && !portalCodes.has(String(r.igreen_code)) && r.situacao_igreen !== "fora_da_carteira")
    .map((r) => r.id);

  if (toMark.length === 0) return { out_of_portfolio_marked: 0, checked: existing.length };

  let marked = 0;
  for (let i = 0; i < toMark.length; i += 200) {
    const chunk = toMark.slice(i, i + 200);
    const { data, error } = await supabase
      .from("customers")
      .update({ situacao_igreen: "fora_da_carteira" })
      .in("id", chunk)
      .select("id");
    if (error) {
      console.error("markOutOfPortfolio update:", error.message);
      return { out_of_portfolio_marked: marked, error: error.message, checked: existing.length };
    }
    marked += data?.length || 0;
  }
  return { out_of_portfolio_marked: marked, checked: existing.length, candidates: toMark.length };
}

async function syncOneConsultant(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  worker: { url: string; secret: string },
  portalEmail: string,
  portalPassword: string,
  consultantId: string | null,
  mode: string,
  igreenAccountId: string | null = null,
): Promise<Record<string, unknown>> {
  const emailNorm = String(portalEmail || "").trim().toLowerCase();
  const passwordNorm = String(portalPassword || "");

  if (!emailNorm || !passwordNorm) {
    return { success: false, email: emailNorm, error: "Credenciais do portal iGreen não preenchidas." };
  }

  // === VALIDATE MODE: só verifica login (chamada leve). ===
  if (mode === "validate") {
    const r = await callWorker(worker, "/sync-metrics", { portal_email: emailNorm, portal_password: passwordNorm });
    if (!r.ok) return { success: false, email: emailNorm, error: r.error || "Falha ao validar", status: r.status };
    return { success: true, mode: "validate", email: emailNorm };
  }


  // === SYNC ALL MODE (recomendado): 1 login → tudo, respeitando os toggles ===
  if (mode === "sync_all") {
    console.log(`[worker] sync-all for ${emailNorm}`);

    const toggles = await loadIgreenToggles(supabase, consultantId);

    const out: Record<string, unknown> = { success: true, mode: "sync_all", email: emailNorm, toggles };

    // Fase A: salva a lista-base de clientes numa chamada CURTA (fast=true → só
    // o Kanban, ~5s). Cliente aparece em "Meus clientes" imediatamente. A lista
    // COMPLETA (571, varredura por dia) vem na Fase B em background.
    const base = await callWorker(worker, "/sync-customers", {
      portal_email: emailNorm,
      portal_password: passwordNorm,
      fast: true,
    });
    if (!base.ok) {
      const retry = classifyError(base.error) === "waf_blocked" ? await scheduleWafRetry(supabase, consultantId, mode) : null;
      return workerErrorResponse(emailNorm, base, { retry_at: retry });
    }

    const baseConsultorId = base.data?.consultor_id ? String(base.data.consultor_id) : null;
    if (consultantId && baseConsultorId) {
      // Com múltiplas contas iGreen, o igreen_consultor_id por conta fica em
      // igreen_portal_accounts; a coluna legada em `consultants` só é
      // atualizada para a conta principal (compatibilidade com telas antigas).
      if (igreenAccountId) {
        await supabase.from("igreen_portal_accounts").update({ igreen_consultor_id: baseConsultorId, last_sync_at: new Date().toISOString() }).eq("id", igreenAccountId);
        const { data: accRow } = await supabase
          .from("igreen_portal_accounts")
          .select("position")
          .eq("id", igreenAccountId)
          .maybeSingle();
        if (Number(accRow?.position ?? 0) === 1) {
          await supabase.from("consultants").update({
            igreen_consultor_id: baseConsultorId,
            igreen_id: Number(baseConsultorId) || null,
          }).eq("id", consultantId);
        }
      } else {
        await supabase.from("consultants").update({
          igreen_consultor_id: baseConsultorId,
          igreen_id: Number(baseConsultorId) || null,
        }).eq("id", consultantId);
      }
    }
    out.portal_identity = { igreen_consultor_id: baseConsultorId };
    try { out.customers = await persistCustomers(supabase, consultantId, base.data?.customers || [], igreenAccountId); }
    catch (e) {
      return { success: false, email: emailNorm, error: `Falha ao gravar clientes: ${e instanceof Error ? e.message : String(e)}` };
    }
    out.portfolio = await markOutOfPortfolio(supabase, consultantId, base.data?.customers || []);

    const syncTimestamp = new Date().toISOString();
    await supabase.from("settings").upsert({ key: "last_igreen_sync", value: syncTimestamp }, { onConflict: "key" });
    out.synced_at = syncTimestamp;
    out.background = { extras_and_enrich: "started" };

    // Fase B: extras + enriquecimento em background. Se ela falhar ou demorar,
    // a carteira já está consistente e pesquisável.
    scheduleSyncAllBackgroundPhase(
      supabase,
      worker,
      emailNorm,
      passwordNorm,
      consultantId,
      toggles,
      base.data?.customers || [],
      igreenAccountId,
    );
    return out;
  }

  // === ENRICH ONLY MODE ===
  // Enriquece SO os clientes que ainda nao tem ficha (last_enriched_at IS NULL),
  // sem refazer a varredura completa. Leve e focado: cabe no orcamento de tempo
  // e pode ser chamado repetidamente (cron) ate zerar a fila de pendentes.
  // Resolve o gargalo: antes o enrich ficava no fim da Fase B e o tempo acabava
  // antes de chegar nele.
  if (mode === "enrich_only") {
    console.log(`[worker] enrich-only for ${emailNorm}`);
    const enrichCap = 120; // 4 lotes de 30 por chamada
    let pendQuery = supabase
      .from("customers")
      .select("igreen_code")
      .eq("consultant_id", consultantId)
      .in("customer_origin", ["igreen_sync", "igreen_extension"])
      .is("last_enriched_at", null)
      .not("igreen_code", "is", null)
      .limit(enrichCap);
    // Multi-conta: se veio de uma conta específica, enriquece só os clientes
    // dela (evita usar a credencial errada em clientes de outra conta).
    if (igreenAccountId) pendQuery = pendQuery.eq("igreen_account_id", igreenAccountId);
    const { data: pend } = await pendQuery;
    const codes = ((pend || []) as Array<{ igreen_code: string }>)
      .map((c) => String(c.igreen_code)).filter(Boolean);
    if (codes.length === 0) {
      return { success: true, mode: "enrich_only", details_applied: 0, pending_remaining: 0, message: "nada a enriquecer" };
    }
    const startedEnrich = Date.now();
    let applied = 0, received = 0;
    for (let i = 0; i < codes.length; i += 30) {
      if (Date.now() - startedEnrich > 110_000) break; // respeita o orcamento
      const chunk = codes.slice(i, i + 30);
      const er = await callWorker(worker, "/enrich-batch", {
        portal_email: emailNorm, portal_password: passwordNorm, codigos: chunk,
      });
      if (!er.ok) {
        const retry = classifyError(er.error) === "waf_blocked" ? await scheduleWafRetry(supabase, consultantId, mode) : null;
        if (i === 0) return workerErrorResponse(emailNorm, er, { retry_at: retry });
        break;
      }
      const details = er.data?.details || [];
      received += details.length;
      const res = await applyCustomerDetails(supabase, consultantId, details, igreenAccountId);
      applied += Number(res.details_applied || 0);
    }
    let remainingQuery = supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("consultant_id", consultantId)
      .in("customer_origin", ["igreen_sync", "igreen_extension"])
      .is("last_enriched_at", null);
    if (igreenAccountId) remainingQuery = remainingQuery.eq("igreen_account_id", igreenAccountId);
    const { count: remaining } = await remainingQuery;
    return { success: true, mode: "enrich_only", details_received: received, details_applied: applied, pending_remaining: remaining ?? null };
  }

  // === SYNC METRICS MODE ===
  if (mode === "sync_metrics") {
    console.log(`[worker] sync-metrics for ${emailNorm}`);
    const r = await callWorker(worker, "/sync-metrics", { portal_email: emailNorm, portal_password: passwordNorm });
    if (!r.ok) { const retry = classifyError(r.error) === "waf_blocked" ? await scheduleWafRetry(supabase, consultantId, mode) : null; return workerErrorResponse(emailNorm, r, { retry_at: retry }); }
    const consultorId = r.data?.consultor_id ? String(r.data.consultor_id) : null;
    if (consultantId && consultorId) {
      await supabase.from("consultants").update({ igreen_consultor_id: consultorId }).eq("id", consultantId);
    }
    const saved = await persistMetrics(supabase, consultantId, r.data?.metrics);
    return { success: true, mode: "sync_metrics", ...saved };
  }

  // === SYNC BOLETOS MODE ===
  if (mode === "sync_boletos") {
    console.log(`[worker] sync-boletos for ${emailNorm}`);
    const r = await callWorker(worker, "/sync-boletos", { portal_email: emailNorm, portal_password: passwordNorm });
    if (!r.ok) { const retry = classifyError(r.error) === "waf_blocked" ? await scheduleWafRetry(supabase, consultantId, mode) : null; return workerErrorResponse(emailNorm, r, { retry_at: retry }); }
    const consultorId = r.data?.consultor_id ? String(r.data.consultor_id) : null;
    const saved = await persistBoletos(supabase, consultorId ? (consultantId || null) : consultantId, r.data?.boletos || []);
    return { success: true, mode: "sync_boletos", ...saved };
  }

  // === SYNC TELECOM MODE ===
  if (mode === "sync_telecom") {
    console.log(`[worker] sync-telecom for ${emailNorm}`);
    const r = await callWorker(worker, "/sync-telecom", { portal_email: emailNorm, portal_password: passwordNorm });
    if (!r.ok) { const retry = classifyError(r.error) === "waf_blocked" ? await scheduleWafRetry(supabase, consultantId, mode) : null; return workerErrorResponse(emailNorm, r, { retry_at: retry }); }
    const consultorId = r.data?.consultor_id ? String(r.data.consultor_id) : null;
    if (consultantId && consultorId) {
      await supabase.from("consultants").update({ igreen_consultor_id: consultorId }).eq("id", consultantId);
    }
    const saved = await persistTelecom(supabase, consultantId, r.data?.telecom || []);
    return { success: true, mode: "sync_telecom", portal_identity: { igreen_consultor_id: consultorId }, telecom: saved, diagnostics: buildProductDiagnostics(r.data, ["telecom"]) };
  }

  // === SYNC SEGUROS MODE ===
  if (mode === "sync_seguros") {
    console.log(`[worker] sync-seguros for ${emailNorm}`);
    const r = await callWorker(worker, "/sync-seguros", { portal_email: emailNorm, portal_password: passwordNorm });
    if (!r.ok) { const retry = classifyError(r.error) === "waf_blocked" ? await scheduleWafRetry(supabase, consultantId, mode) : null; return workerErrorResponse(emailNorm, r, { retry_at: retry }); }
    const consultorId = r.data?.consultor_id ? String(r.data.consultor_id) : null;
    if (consultantId && consultorId) {
      await supabase.from("consultants").update({ igreen_consultor_id: consultorId }).eq("id", consultantId);
    }
    const saved = await persistSeguros(supabase, consultantId, r.data?.seguros || []);
    return { success: true, mode: "sync_seguros", portal_identity: { igreen_consultor_id: consultorId }, seguros: saved, diagnostics: buildProductDiagnostics(r.data, ["seguros"]) };
  }

  // === SYNC NETWORK MODE ===
  if (mode === "explore_network" || mode === "sync_network") {
    console.log(`[worker] sync-network for ${emailNorm}`);
    const r = await callWorker(worker, "/sync-network", {
      portal_email: emailNorm,
      portal_password: passwordNorm,
    });
    if (!r.ok) {
      return { success: false, email: emailNorm, error: `Worker falhou: ${r.error}`, status: r.status };
    }
    const members: Record<string, unknown>[] = r.data?.members || r.data?.data || [];
    const consultorId = r.data?.consultor_id ? String(r.data.consultor_id) : null;
    if (consultantId && consultorId) {
      await supabase.from("consultants").update({ igreen_consultor_id: consultorId }).eq("id", consultantId);
    }
    const net = await persistNetwork(supabase, consultantId, members);
    return { success: true, mode: "sync_network", ...net };
  }

  // === SYNC CUSTOMERS (default) ===
  console.log(`[worker] sync-customers for ${emailNorm}`);
  const r = await callWorker(worker, "/sync-customers", {
    portal_email: emailNorm,
    portal_password: passwordNorm,
  });
  if (!r.ok) {
    const retry = classifyError(r.error) === "waf_blocked" ? await scheduleWafRetry(supabase, consultantId, mode) : null;
    return workerErrorResponse(emailNorm, r, { retry_at: retry });
  }
  const consultorId = r.data?.consultor_id ? String(r.data.consultor_id) : null;
  if (consultantId && consultorId) {
    await supabase.from("consultants").update({ igreen_consultor_id: consultorId }).eq("id", consultantId);
  }
  const allCustomers: Record<string, unknown>[] = r.data?.customers || r.data?.data || [];
  if (allCustomers.length === 0) {
    return { success: false, email: emailNorm, error: "Nenhum cliente retornado pelo worker." };
  }
  const cust = await persistCustomers(supabase, consultantId, allCustomers);
  const portfolio = await markOutOfPortfolio(supabase, consultantId, allCustomers);
  const syncTimestamp = new Date().toISOString();
  await supabase.from("settings").upsert({ key: "last_igreen_sync", value: syncTimestamp }, { onConflict: "key" });
  return { success: true, email: emailNorm, synced_at: syncTimestamp, customers: cust, portfolio };
}

// deno-lint-ignore no-explicit-any
async function persistNetwork(supabase: any, consultantId: string | null, members: Record<string, unknown>[], igreenAccountId: string | null = null): Promise<Record<string, unknown>> {
  // Multi-conta: cada portal devolve a árvore com nivel=0 = logado naquela
  // conta. Se a subconta (Sirlene/Nilma) gravar em network_members do mesmo
  // consultant_id, ela sobrescreve a raiz/níveis da conta principal (unique
  // consultant_id+igreen_id) e o mapa fica com a pessoa errada no topo.
  // Por isso só a conta principal (position=1) — ou sync legado sem account —
  // persiste a rede do consultor.
  if (consultantId && igreenAccountId) {
    const { data: acc } = await supabase
      .from("igreen_portal_accounts")
      .select("position, label, portal_email")
      .eq("id", igreenAccountId)
      .maybeSingle();
    const position = Number(acc?.position ?? 0);
    if (position > 1) {
      console.log(
        `[persistNetwork] skip subconta position=${position} (${acc?.label || acc?.portal_email || igreenAccountId}) — rede só pela conta principal`,
      );
      return {
        skipped: true,
        reason: "subaccount_network_skipped",
        account_id: igreenAccountId,
        position,
        total_members: members.length,
      };
    }
  }

  // Dedup por igreen_id dentro DESTA conta.
  const deduped = new Map<number, Record<string, unknown>>();
  for (const m of members) {
    const id = Number(m.idconsultor || m.id);
    if (id) deduped.set(id, m);
  }
  const netData = Array.from(deduped.values());

  const netRecords = netData.map((m) => ({
    consultant_id: consultantId,
    igreen_account_id: igreenAccountId,
    igreen_id: Number(m.idconsultor || m.id),
    name: String(m.nome || "Sem nome"),
    phone: normalizePhone(String(m.celular || "")),
    sponsor_id: m.idpatrocinador ? Number(m.idpatrocinador) : null,
    nivel: Number(m.nivel ?? 0),
    data_ativo: safeStr(m.data_ativo) || null,
    cidade: safeStr(m.cidade) || null,
    uf: safeStr(m.uf) || null,
    clientes_ativos: Number(m.cliativo ?? 0),
    gp: safeNum(m.gp) ?? 0,
    gi: safeNum(m.gi) ?? 0,
    qtde_diretos: Number(m.qtde_diretos ?? 0),
    inicio_rapido: safeStr(m.inicio_rapido) || null,
    diretos_inicio_rapido: Number(m.diretos_inicio_rapido ?? 0),
    diretos_mes: Number(m.diretos_mes ?? 0),
    total_pontos: safeNum(m.total_pontos) ?? 0,
    gp_total: safeNum(m.gp) ?? 0,
    gi_total: safeNum(m.gi) ?? 0,
    bonificavel: safeNum(m.bonificavel),
    gt_qualificavel: safeNum(m.qualificavel),
    graduacao: safeStr(m.graduacao) || null,
    graduacao_expansao: safeStr(m.graduacao_expansao) || null,
    licenciados_diretos: m.licenciados_diretos != null ? Number(m.licenciados_diretos) : null,
    licenciados_diretos_ativos: m.licenciados_diretos_ativos != null ? Number(m.licenciados_diretos_ativos) : null,
    pro: safeStr(m.pro) || null,
    updated_at: new Date().toISOString(),
  }));

  let netUpdated = 0;
  for (let i = 0; i < netRecords.length; i += 25) {
    const batch = netRecords.slice(i, i + 25);
    const { data, error } = await supabase
      .from("network_members")
      .upsert(batch, { onConflict: "consultant_id,igreen_id", ignoreDuplicates: false })
      .select("id");
    if (error) console.error(`Network upsert error at ${i}:`, error);
    else netUpdated += (data?.length || 0);
  }

  // Remove stale members da conta que está gravando (em geral a principal).
  // Escopo por igreen_account_id evita apagar linhas legadas de outras contas
  // se ainda existirem; o unique (consultant_id,igreen_id) garante 1 linha/pessoa.
  let staleDeleted = 0;
  if (consultantId && igreenAccountId) {
    const apiIds = netRecords.map((r) => Number(r.igreen_id));
    const { data: existingMembers } = await supabase
      .from("network_members")
      .select("igreen_id")
      .eq("consultant_id", consultantId)
      .eq("igreen_account_id", igreenAccountId);
    if (existingMembers) {
      const staleIds = (existingMembers as Array<{ igreen_id: number }>)
        .map((m) => m.igreen_id)
        .filter((id) => !apiIds.includes(id));
      if (staleIds.length > 0) {
        const { error: delErr, count } = await supabase
          .from("network_members")
          .delete({ count: "exact" })
          .eq("consultant_id", consultantId)
          .eq("igreen_account_id", igreenAccountId)
          .in("igreen_id", staleIds);
        if (delErr) console.error(`Network stale delete error:`, delErr);
        else staleDeleted = count || 0;
      }
    }
  } else if (consultantId && !igreenAccountId) {
    // Legado: chamadas sem igreenAccountId (ex.: modo sync_network standalone).
    // Não apaga NADA para não zerar a rede das subcontas.
    console.log(`[persistNetwork] sem igreen_account_id → pulando delete-stale (rede acumulada preservada)`);
  }

  console.log(`[persistNetwork] owner=${consultantId} account=${igreenAccountId} members=${netData.length} upserts=${netUpdated} stale_removed=${staleDeleted}`);
  return { total_members: netData.length, updated: netUpdated, stale_removed: staleDeleted };
}


// deno-lint-ignore no-explicit-any
async function persistCustomers(supabase: any, consultantId: string | null, allCustomers: Record<string, unknown>[], igreenAccountId: string | null = null): Promise<Record<string, unknown>> {
  console.log(`Worker returned ${allCustomers.length} customers`);

  const seenPhones = new Map<string, string>();
  const records: Record<string, unknown>[] = [];
  let skippedNoPhone = 0;

  // ---------------------------------------------------------------------------
  // Anti-duplicação: quando o portal iGreen devolve o cliente sem celular numa
  // run posterior, buildRecord gera placeholder 'sem_celular_<code>'. Se já
  // existe uma linha desse mesmo cliente com telefone real (identificada por
  // igreen_code + consultant_id), reusamos o telefone real — assim o upsert
  // por (phone_whatsapp,consultant_id) atualiza a linha existente em vez de
  // criar uma segunda cópia. Índice único parcial em (consultant_id,igreen_code)
  // também bloqueia o problema a partir do banco.
  // ---------------------------------------------------------------------------
  const codeToRealPhone = new Map<string, string>();
  if (consultantId) {
    const codes = new Set<string>();
    for (const c of allCustomers) {
      const code = safeStr(get(c, "codigoCliente", "codigoIgreen", "codigo", "Código"));
      if (code) codes.add(code);
    }
    const codeList = Array.from(codes);
    for (let i = 0; i < codeList.length; i += 200) {
      const chunk = codeList.slice(i, i + 200);
      const { data, error } = await supabase
        .from("customers")
        .select("igreen_code, phone_whatsapp")
        .eq("consultant_id", consultantId)
        .in("igreen_code", chunk);
      if (!error && data) {
        for (const row of data as Array<{ igreen_code: string; phone_whatsapp: string | null }>) {
          const p = String(row.phone_whatsapp || "");
          if (row.igreen_code && p && !p.startsWith("sem_celular_")) {
            codeToRealPhone.set(String(row.igreen_code), p);
          }
        }
      }
    }
    if (codeToRealPhone.size > 0) {
      console.log(`[persistCustomers] real-phone lookup: ${codeToRealPhone.size}/${codeList.length} clientes já têm telefone real cadastrado`);
    }
  }

  let placeholderReused = 0;
  for (const c of allCustomers) {
    const record = buildRecord(c);
    if (!record || !record.phone_whatsapp) { skippedNoPhone++; continue; }
    let phone = String(record.phone_whatsapp);

    // Se buildRecord gerou placeholder mas já temos telefone real no banco,
    // reusa o real para o upsert atualizar a linha existente.
    if (phone.startsWith("sem_celular_")) {
      const icode = safeStr(get(c, "codigoCliente", "codigoIgreen", "codigo", "Código"));
      const real = icode ? codeToRealPhone.get(icode) : undefined;
      if (real) {
        record.phone_whatsapp = real;
        // Se voltou a ter telefone real, o status não deve ser 'contato_incompleto'.
        // Preserva o que já está no banco removendo os campos derivados do placeholder.
        if (record.status === "contato_incompleto") delete record.status;
        phone = real;
        placeholderReused++;
      }
    }

    if (seenPhones.has(phone)) {
      const icode = safeStr(get(c, "codigoCliente", "codigoIgreen", "codigo"));
      if (icode) {
        const uniquePhone = `${phone}_${icode}`;
        record.phone_whatsapp = uniquePhone;
        seenPhones.set(uniquePhone, String(record.name || "unknown"));
      } else continue;
    } else {
      seenPhones.set(phone, String(record.name || "unknown"));
    }

    if (consultantId) record.consultant_id = consultantId;
    if (igreenAccountId) record.igreen_account_id = igreenAccountId;
    records.push(record);
  }
  if (placeholderReused > 0) console.log(`[persistCustomers] ${placeholderReused} placeholders 'sem_celular_*' substituídos por telefone real do banco`);

  // Proteção mid-conversation + detecção de leads que viram carteira
  const allPhones = records.map((r) => String(r.phone_whatsapp));
  const midConvoPhones = new Set<string>();
  const flippingToWalletIds: string[] = [];
  for (let i = 0; i < allPhones.length; i += 200) {
    const chunk = allPhones.slice(i, i + 200);
    let q = supabase
      .from("customers")
      .select("id, phone_whatsapp, conversation_step, customer_origin")
      .in("phone_whatsapp", chunk);
    if (consultantId) q = q.eq("consultant_id", consultantId);
    const { data: existing } = await q;
    if (existing) {
      for (const e of existing as Array<{ id: string; phone_whatsapp: string; conversation_step: string | null; customer_origin: string | null }>) {
        const midConvo = !!e.conversation_step && e.conversation_step !== "complete";
        if (midConvo) midConvoPhones.add(e.phone_whatsapp);
        const isLeadOrigin = !e.customer_origin || e.customer_origin === "whatsapp_lead" || e.customer_origin === "manual";
        if (consultantId && isLeadOrigin && !midConvo) flippingToWalletIds.push(e.id);
      }
    }
  }
  if (midConvoPhones.size > 0) {
    console.log(`⚠️ Protecting ${midConvoPhones.size} mid-conversation leads`);
  }
  for (const rec of records) {
    if (midConvoPhones.has(String(rec.phone_whatsapp))) {
      delete rec.status;
      delete rec.customer_origin;
    }
  }

  let updatedCount = 0;
  let errorCount = 0;
  const failedSamples: Array<Record<string, unknown>> = [];
  const BATCH_SIZE = 100;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from("customers")
      .upsert(batch, { onConflict: "phone_whatsapp,consultant_id", ignoreDuplicates: false })
      .select("id");
    if (error) {
      console.error(`Batch upsert error at ${i}: ${error.message}. Retrying individually.`);
      for (const rec of batch) {
        const { data: rowData, error: rowError } = await supabase
          .from("customers")
          .upsert(rec, { onConflict: "phone_whatsapp,consultant_id", ignoreDuplicates: false })
          .select("id")
          .maybeSingle();
        if (rowError) {
          errorCount++;
          if (failedSamples.length < 10) {
            failedSamples.push({
              name: rec.name,
              phone_whatsapp: rec.phone_whatsapp,
              igreen_code: rec.igreen_code,
              error: rowError.message,
            });
          }
          console.error(`Customer upsert failed: ${String(rec.name || rec.igreen_code || rec.phone_whatsapp)}: ${rowError.message}`);
        } else if (rowData?.id) {
          updatedCount++;
        }
      }
    } else {
      updatedCount += (data?.length || 0);
    }
  }

  // Cleanup de resíduo: leads que viraram carteira
  let cleanedInsights = 0;
  let cleanedDeals = 0;
  if (consultantId && flippingToWalletIds.length > 0) {
    for (let i = 0; i < flippingToWalletIds.length; i += 100) {
      const idChunk = flippingToWalletIds.slice(i, i + 100);
      const { error: liErr, count: liCount } = await supabase
        .from("lead_insights")
        .delete({ count: "exact" })
        .in("customer_id", idChunk);
      if (liErr) console.error(`lead_insights cleanup error at ${i}:`, liErr);
      else cleanedInsights += liCount || 0;

      const { error: cdErr, count: cdCount } = await supabase
        .from("crm_deals")
        .delete({ count: "exact" })
        .eq("consultant_id", consultantId)
        .in("customer_id", idChunk);
      if (cdErr) console.error(`crm_deals cleanup error at ${i}:`, cdErr);
      else cleanedDeals += cdCount || 0;
    }
    if (cleanedInsights > 0 || cleanedDeals > 0) {
      console.log(`🧹 Cleanup leads→carteira: ${cleanedInsights} insights, ${cleanedDeals} deals removidos`);
    }
  }

  console.log(
    `[sync-igreen-customers] upsert done consultant=${consultantId} total_from_portal=${allCustomers.length} processed=${records.length} updated=${updatedCount} errors=${errorCount} skipped_no_phone=${skippedNoPhone}`,
  );

  return {
    total_from_portal: allCustomers.length,
    processed: records.length,
    skipped_no_phone: skippedNoPhone,
    updated: updatedCount,
    errors: errorCount,
    failed_samples: failedSamples,
    cleaned_insights: cleanedInsights,
    cleaned_deals: cleanedDeals,
  };
}


// =====================================================
// Main handler
// =====================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let portalEmail = Deno.env.get("IGREEN_PORTAL_EMAIL");
    let portalPassword = Deno.env.get("IGREEN_PORTAL_PASSWORD");
    let consultantId: string | null = null;
    let mode = "sync";
    let source = "";
    let credsFromBody = false;

    try {
      const body = await req.json();
      if (body.portal_email) { portalEmail = body.portal_email; credsFromBody = true; }
      if (body.portal_password) { portalPassword = body.portal_password; credsFromBody = true; }
      if (body.consultant_id) consultantId = body.consultant_id;
      if (body.mode) mode = body.mode;
      if (body.source) source = body.source;
    } catch (_) { /* sem body */ }



    const worker = await resolveSyncWorker(supabase);
    if (!worker) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Worker de sync iGreen não configurado. Defina IGREEN_SYNC_WORKER_URL (secret) ou settings.igreen_sync_worker_url.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }


    if (source === "cron" || source === "bulk_manual") {
      const label = source === "bulk_manual" ? "MANUAL BULK" : "CRON";
      console.log(`=== ${label} MODE: Syncing consultants ===`);
      const cronMode = mode && mode !== "sync" ? mode : "sync_all";

      // Body pode limitar quais consultores rodar (para retry de falhas).
      let filterIds: string[] | null = null;
      try {
        const b = await req.clone().json();
        if (Array.isArray(b?.consultant_ids) && b.consultant_ids.length > 0) {
          filterIds = b.consultant_ids.map(String);
        }
      } catch (_) { /* body vazio */ }

      const q = supabase
        .from("consultants")
        .select("id, name, igreen_portal_email, igreen_portal_password")
        .eq("approved", true);
      const { data: consultants, error: cErr } = filterIds
        ? await q.in("id", filterIds)
        : await q;

      const usable = (consultants || []).filter((c: Record<string, unknown>) =>
        !!c.igreen_portal_email && !!c.igreen_portal_password
      );

      if (cErr || usable.length === 0) {
        if (portalEmail && portalPassword) {
          const result = await syncOneConsultant(supabase, worker, portalEmail, portalPassword, null, cronMode);
          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ success: false, error: "Nenhum consultor com credenciais iGreen configuradas." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      console.log(`Found ${usable.length} consultants with credentials.`);

      // Estado de bulk (visível para o painel admin).
      const { data: bulkRow } = await supabase
        .from("igreen_bulk_sync_state")
        .insert({
          status: "running",
          total: usable.length,
          completed: 0,
          failed: 0,
          consultant_ids: usable.map((c: Record<string, unknown>) => c.id),
          results: {},
          full_history: true,
        })
        .select("id")
        .single();
      const bulkId: string | null = bulkRow?.id ?? null;

      // Roda tudo em background para escapar do IDLE_TIMEOUT (150s) da Edge.
      const runAll = async () => {
        let completed = 0;
        let failed = 0;
        const results: Record<string, unknown> = {};
        for (const c of usable) {
          console.log(`--- [bg] Syncing: ${c.name} (${c.igreen_portal_email}) ---`);
          if (bulkId) {
            await supabase.from("igreen_bulk_sync_state").update({
              current_consultant_id: c.id, updated_at: new Date().toISOString(),
            }).eq("id", bulkId);
          }
          const runId = await logSyncStart(supabase, c.id, cronMode);
          let r: Record<string, unknown> = { success: false, error: "unknown" };
          try {
            r = await syncAllAccountsForConsultant(supabase, worker, c.id, cronMode, c.igreen_portal_email, c.igreen_portal_password);
          } catch (err) {
            r = { success: false, error: err instanceof Error ? err.message : String(err) };
            console.error(`[bg] Error syncing ${c.name}:`, err);
          } finally {
            await logSyncFinish(supabase, runId, c.id, r);
          }
          if (r?.success) completed++; else failed++;
          results[c.id] = { name: c.name, success: !!r?.success, error: r?.error ?? null };
          if (bulkId) {
            await supabase.from("igreen_bulk_sync_state").update({
              completed, failed, results, updated_at: new Date().toISOString(),
            }).eq("id", bulkId);
          }
          await new Promise((res) => setTimeout(res, 3000));
        }
        if (bulkId) {
          await supabase.from("igreen_bulk_sync_state").update({
            status: "finished", current_consultant_id: null, updated_at: new Date().toISOString(),
          }).eq("id", bulkId);
        }
        console.log(`[bg] ${label} sync finished (${usable.length} consultants)`);
      };
      // @ts-ignore EdgeRuntime existe no Supabase edge runtime
      try { EdgeRuntime.waitUntil(runAll()); } catch { runAll(); }

      return new Response(JSON.stringify({
        success: true,
        mode: source === "bulk_manual" ? "bulk_manual" : "cron_all",
        background: true,
        total_consultants: usable.length,
        bulk_id: bulkId,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================================
    // MANUAL MODE: single consultant
    // ========================================================
    if (consultantId && !credsFromBody) {
      const { data: cred } = await supabase
        .from("consultants")
        .select("igreen_portal_email, igreen_portal_password")
        .eq("id", consultantId)
        .maybeSingle();
      if (cred?.igreen_portal_email && cred?.igreen_portal_password) {
        portalEmail = cred.igreen_portal_email;
        portalPassword = cred.igreen_portal_password;
      }
    }

    if (!consultantId && portalEmail) {
      const { data: consultant } = await supabase
        .from("consultants")
        .select("id")
        .eq("igreen_portal_email", portalEmail)
        .maybeSingle();
      if (consultant?.id) consultantId = consultant.id;
    }

    if (!portalEmail || !portalPassword) {
      return new Response(
        JSON.stringify({ success: false, error: "Credenciais do portal iGreen não configuradas. Preencha email/senha na aba Dados." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Modo validate roda inline e responde na hora (é leve).
    if (mode === "validate") {
      const runId = await logSyncStart(supabase, consultantId, mode);
      const r = await syncOneConsultant(supabase, worker, portalEmail!, portalPassword!, consultantId, mode);
      await logSyncFinish(supabase, runId, consultantId, r);
      return new Response(JSON.stringify(r), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Modo operacional curto: grava clientes inline e só responde quando terminou.
    // sync_all padrão fica no bloco de background abaixo para evitar cancelamento
    // do cliente HTTP; dentro do background ele executa Fase A antes dos extras.
    if (mode === "sync_now" || mode === "sync_customers_now") {
      const runId = await logSyncStart(supabase, consultantId, mode);
      const r = await syncOneConsultant(supabase, worker, portalEmail!, portalPassword!, consultantId, "sync");
      await logSyncFinish(supabase, runId, consultantId, r);
      return new Response(JSON.stringify(r), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Executa em background e responde imediato (evita IDLE_TIMEOUT de 150s).
    const runOne = async () => {
      const runId = await logSyncStart(supabase, consultantId, mode);
      let r: Record<string, unknown> = { success: false, error: "unknown" };
      try {
        // MULTI-CONTA: quando há consultant_id e não veio credencial explícita
        // no body (fluxo normal do botão/cron), percorre TODAS as contas
        // iGreen do consultor em ordem (1, 2, 3...). Se só houver a conta
        // principal, o resultado é o mesmo de antes.
        r = (consultantId && !credsFromBody)
          ? await syncAllAccountsForConsultant(supabase, worker, consultantId, mode, portalEmail, portalPassword)
          : await syncOneConsultant(supabase, worker, portalEmail!, portalPassword!, consultantId, mode);
        console.log(`[bg] sync single done:`, JSON.stringify(r).slice(0, 300));
      } catch (err) {
        r = { success: false, error: err instanceof Error ? err.message : String(err) };
        console.error(`[bg] sync single error:`, err);
      } finally {
        await logSyncFinish(supabase, runId, consultantId, r);
      }
    };
    // @ts-ignore EdgeRuntime existe no Supabase edge runtime
    try { EdgeRuntime.waitUntil(runOne()); } catch { runOne(); }

    return new Response(JSON.stringify({
      success: true,
      background: true,
      mode,
      consultant_id: consultantId,
      message: "Sincronização iniciada em segundo plano. Os dados serão atualizados em instantes.",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Sync error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
