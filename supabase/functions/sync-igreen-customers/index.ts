import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { enqueueProactiveWaCandidates } from "../_shared/igreen-automation.ts";
import {
  IGREEN_SYNC_WORKER_OFFICIAL_URL,
  resolveIgreenSyncWorker,
} from "../_shared/igreen-sync-worker.ts";

// =====================================================
// sync-igreen-customers
// Estratégia única: delega o login/scraping para o Playwright Worker na VPS
// (oficial: IGREEN_SYNC_WORKER_OFFICIAL_URL / settings.igreen_sync_worker_url).
// Toda a normalização e upsert continua aqui.
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
  if (dCad) {
    record.data_cadastro = dCad;
    if (/^\d{4}-\d{2}-\d{2}/.test(dCad)) record.data_cadastro_igreen = dCad.slice(0, 10);
    else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(dCad)) {
      const [dd, mm, yyyy] = dCad.split("/");
      record.data_cadastro_igreen = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    }
  }

  const dAtivo = safeStr(get(c, "dataAtivo", "data_ativo", "Data Ativo"));
  if (dAtivo) {
    record.data_ativo = dAtivo;
    if (/^\d{4}-\d{2}-\d{2}/.test(dAtivo)) record.data_ativo_igreen = dAtivo.slice(0, 10);
  }

  const dVal = safeStr(get(c, "dataValidado", "data_validado", "Data Validado"));
  if (dVal) {
    record.data_validado = dVal;
    if (/^\d{4}-\d{2}-\d{2}/.test(dVal)) record.data_validado_igreen = dVal.slice(0, 10);
  }

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

// Resolve worker URL + secret — ver `_shared/igreen-sync-worker.ts` (URL oficial).
const resolveSyncWorker = resolveIgreenSyncWorker;

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
async function updateAccountCredentialStatus(
  supabase: any,
  accountId: string | null | undefined,
  success: boolean,
  errText?: string | null,
): Promise<void> {
  if (!accountId) return;
  const status = success ? "valid" : classifyError(errText || undefined);
  await supabase.from("igreen_portal_accounts").update({
    credential_status: status,
    credential_checked_at: new Date().toISOString(),
  }).eq("id", accountId);
}

// deno-lint-ignore no-explicit-any
async function logSyncFinish(
  supabase: any,
  runId: string | null,
  consultantId: string | null,
  result: Record<string, unknown>,
  accountId?: string | null,
): Promise<void> {
  const success = Boolean(result?.success);
  const errText = success ? null : String(result?.error || "");
  const status = success ? "ok" : classifyError(errText || undefined);
  const counts: Record<string, unknown> = {};
  for (const k of ["customers","boletos","telecom","seguros","devolutivas","network","metrics","cashback","details","alerts","portfolio","background","portal_identity","diagnostics","full_extras","full_extras_error","customers_full","customers_full_error","results","accounts_synced","accounts_failed"]) {
    if (result[k] != null) counts[k] = result[k];
  }
  if (runId) {
    // Preserva extras da Fase B que possam ter terminado ANTES deste finish
    // (corrida multi-conta). Sem isso, logSyncFinish apagava customers_full.
    const { data: cur } = await supabase
      .from("igreen_sync_runs")
      .select("counts")
      .eq("id", runId)
      .maybeSingle();
    const prev = (cur?.counts && typeof cur.counts === "object")
      ? cur.counts as Record<string, unknown>
      : {};
    if (prev.extras_by_account && !counts.extras_by_account) {
      counts.extras_by_account = prev.extras_by_account;
    }
    if (prev.extras && !counts.extras) {
      counts.extras = prev.extras;
    } else if (prev.extras && counts.extras) {
      counts.extras = {
        ...(prev.extras as Record<string, unknown>),
        ...(counts.extras as Record<string, unknown>),
      };
    }
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
  // Status por conta (multi-conta): badge na UI do card.
  const fromResult = typeof result?.account_id === "string" ? result.account_id : null;
  await updateAccountCredentialStatus(supabase, accountId || fromResult, success, errText);
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

// Grava extras da Fase B no run CORRETO (anti-corrida multi-conta).
// Carteira apenas: telemetria. Nunca apaga/altera leads.
// deno-lint-ignore no-explicit-any
async function persistSyncRunBackgroundExtras(
  supabase: any,
  runId: string | null,
  consultantId: string | null,
  accountId: string | null,
  out: Record<string, unknown>,
  expectedAccountIds: string[] | null = null,
): Promise<void> {
  const extras: Record<string, unknown> = {};
  for (const k of [
    "network", "metrics", "boletos", "telecom", "seguros", "devolutivas", "cashback",
    "details", "alerts", "portal_identity", "diagnostics", "full_extras", "full_extras_error",
    "portal_extras", "portal_extras_error", "portfolio_full",
    "customers_full", "customers_full_error",
  ]) {
    if (out[k] != null) extras[k] = out[k];
  }
  const finishedAt = new Date().toISOString();
  extras._background_finished_at = finishedAt;
  extras._background_success = out.success !== false;
  if (out.error) extras._background_error = out.error;
  if (accountId) extras.igreen_account_id = accountId;

  let targetId = runId;
  let counts: Record<string, unknown> = {};
  if (targetId) {
    const { data } = await supabase
      .from("igreen_sync_runs")
      .select("id, counts")
      .eq("id", targetId)
      .maybeSingle();
    if (data?.id) {
      counts = (data.counts && typeof data.counts === "object")
        ? data.counts as Record<string, unknown>
        : {};
    } else {
      targetId = null;
    }
  }
  if (!targetId && consultantId) {
    // Fallback legado (só se runId sumiu) — ainda filtra pelo consultor.
    const { data: lastRun } = await supabase
      .from("igreen_sync_runs")
      .select("id, counts")
      .eq("consultant_id", consultantId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!lastRun?.id) return;
    targetId = lastRun.id;
    counts = (lastRun.counts && typeof lastRun.counts === "object")
      ? lastRun.counts as Record<string, unknown>
      : {};
  }
  if (!targetId) return;

  const accountKey = accountId || "_default";
  const byAccount: Record<string, Record<string, unknown>> = {
    ...((counts.extras_by_account && typeof counts.extras_by_account === "object")
      ? counts.extras_by_account as Record<string, Record<string, unknown>>
      : {}),
  };
  byAccount[accountKey] = extras;

  // Contas esperadas: argumento explícito > results do run > só esta conta.
  let expected = expectedAccountIds && expectedAccountIds.length > 0
    ? expectedAccountIds
    : null;
  if (!expected && Array.isArray(counts.results) && (counts.results as unknown[]).length > 0) {
    expected = (counts.results as Array<{ account_id?: string }>)
      .map((r) => r.account_id || "_default")
      .filter(Boolean);
  }
  if (!expected) expected = [accountKey];

  const doneIds = expected.filter((id) => Boolean(byAccount[id]?._background_finished_at));
  const allDone = doneIds.length >= expected.length;
  let topExtras: Record<string, unknown>;
  if (allDone) {
    const anyFail = expected.some((id) => byAccount[id]?._background_success === false);
    topExtras = {
      ...extras,
      _background_finished_at: finishedAt,
      _background_success: !anyFail,
      _accounts_background_done: doneIds.length,
      _accounts_background_expected: expected.length,
    };
  } else {
    const prevTop = (counts.extras && typeof counts.extras === "object")
      ? counts.extras as Record<string, unknown>
      : {};
    topExtras = {
      ...prevTop,
      _background_partial: true,
      _accounts_background_done: doneIds.length,
      _accounts_background_expected: expected.length,
    };
    delete topExtras._background_finished_at;
  }

  await supabase.from("igreen_sync_runs").update({
    counts: {
      ...counts,
      extras_by_account: byAccount,
      extras: topExtras,
    },
  }).eq("id", targetId);
}

/** Saltos encadeados de enrich por conta em um único clique de Sincronizar. */
const ENRICH_MAX_HOPS = 15;

/** Estado do encadeamento de enrich (anti-loop entre invocações). */
interface EnrichChainState {
  hop: number;
  prevRemaining: number | null;
}

/** Código do licenciado dono da conta iGreen (quem enxerga o celular do cliente). */
// deno-lint-ignore no-explicit-any
async function resolveAccountConsultorId(supabase: any, igreenAccountId: string | null): Promise<string> {
  if (!igreenAccountId) return "";
  const { data } = await supabase
    .from("igreen_portal_accounts")
    .select("igreen_consultor_id")
    .eq("id", igreenAccountId)
    .maybeSingle();
  return data?.igreen_consultor_id != null ? String(data.igreen_consultor_id) : "";
}

/**
 * Fila de enriquecimento de uma conta: quem ainda não tem ficha, mais os
 * placeholders de telefone que ESTA conta consegue resolver.
 *
 * O portal só mostra o celular de quem a própria conta cadastrou. Cliente de
 * outro licenciado da rede volta `sem_celular_` para sempre — mantê-lo na fila
 * fazia o enrich reprocessar centenas de códigos a cada sync, sem nunca mudar
 * nada. Ele fica de fora até a conta daquele licenciado ser cadastrada aqui.
 */
// deno-lint-ignore no-explicit-any
async function fetchEnrichQueue(
  supabase: any,
  consultantId: string | null,
  igreenAccountId: string | null,
  limit: number,
): Promise<Array<{ igreen_code: string }>> {
  if (!consultantId) return [];
  const accountConsultorId = await resolveAccountConsultorId(supabase, igreenAccountId);

  let q = supabase
    .from("customers")
    .select("igreen_code, phone_whatsapp, last_enriched_at, registered_by_igreen_id, igreen_account_id")
    .eq("consultant_id", consultantId)
    .in("customer_origin", ["igreen_sync", "igreen_extension"])
    .not("igreen_code", "is", null)
    .or("last_enriched_at.is.null,phone_whatsapp.like.sem_celular_%")
    .limit(limit * 3);
  if (!igreenAccountId) q = q.limit(limit);

  const { data } = await q;
  const rows = (data || []) as Array<{
    igreen_code: string;
    phone_whatsapp: string | null;
    last_enriched_at: string | null;
    registered_by_igreen_id: string | null;
    igreen_account_id: string | null;
  }>;

  const usable = igreenAccountId
    ? rows.filter((r) => {
      const isPlaceholder = String(r.phone_whatsapp || "").startsWith("sem_celular_");
      const cadastradoAqui = !!accountConsultorId &&
        String(r.registered_by_igreen_id || "") === accountConsultorId;
      // Sem ficha ainda: tenta pela conta que já é dona da linha.
      if (!r.last_enriched_at && r.igreen_account_id === igreenAccountId) return true;
      // Placeholder: só quem cadastrou o cliente enxerga o celular.
      if (isPlaceholder && cadastradoAqui) return true;
      return false;
    })
    : rows;

  return usable.slice(0, limit).map((r) => ({ igreen_code: String(r.igreen_code) }));
}

/** Quantos a conta ainda consegue enriquecer (0 = terminou o que dá para fazer). */
// deno-lint-ignore no-explicit-any
async function countEnrichPending(
  supabase: any,
  consultantId: string | null,
  igreenAccountId: string | null,
): Promise<number> {
  const queue = await fetchEnrichQueue(supabase, consultantId, igreenAccountId, 5000);
  return queue.length;
}

/**
 * Continua o enriquecimento numa nova invocação da própria edge. Cada salto
 * ganha um orçamento de tempo limpo, então UM clique em "Sincronizar" termina
 * a fila inteira mesmo quando ela não cabe em uma execução só.
 */
async function chainEnrichHop(params: {
  consultantId: string | null;
  igreenAccountId: string | null;
  portalEmail: string;
  portalPassword: string;
  hop: number;
  prevRemaining: number | null;
}): Promise<boolean> {
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!base || !srk || !params.consultantId) return false;
  try {
    // Respiro entre logins no portal (proxy residencial não gosta de rajada).
    await new Promise((r) => setTimeout(r, 3000));
    const resp = await fetch(`${base}/functions/v1/sync-igreen-customers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${srk}`,
        apikey: srk,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        consultant_id: params.consultantId,
        account_id: params.igreenAccountId,
        portal_email: params.portalEmail,
        portal_password: params.portalPassword,
        mode: "enrich_only",
        source: "enrich_chain",
        enrich_hop: params.hop,
        enrich_prev_remaining: params.prevRemaining,
      }),
    });
    console.log(`[enrich-chain] hop=${params.hop} account=${params.igreenAccountId || "-"} → ${resp.status}`);
    return resp.ok;
  } catch (e) {
    console.warn("[enrich-chain] falhou:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

/**
 * Recalcula o pós-venda depois que os dados do portal chegaram. Só aqui as
 * datas (validado/ativo/cadastro) existem — sem elas `compute_pos_venda_stage`
 * devolve `espera` e o cliente novo nunca entra na régua.
 */
// deno-lint-ignore no-explicit-any
async function settlePosVendaAfterSync(
  supabase: any,
  consultantId: string | null,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  try {
    const { error: rpcErr } = await supabase.rpc("recompute_pos_venda_stages");
    out.pos_venda_recompute = rpcErr ? { error: rpcErr.message } : { ok: true };
    if (rpcErr) return out;

    const auto = await supabase.rpc("auto_confirm_pending_pos_venda", {
      _consultant_id: consultantId || null,
    });
    out.pos_venda_auto_confirm = auto.error ? { error: auto.error.message } : auto.data;
    if (!consultantId || auto.error) return out;

    const { getConsultantAutomationPrefs, isConsultantAutoAllowed } = await import(
      "../_shared/consultant-automation-prefs.ts"
    );
    const { isAutomationEnabled } = await import("../_shared/automation-gate.ts");
    const prefs = await getConsultantAutomationPrefs(supabase, consultantId);
    const globalOn = await isAutomationEnabled(supabase, "pos_venda_auto_messages");
    if (!globalOn || !isConsultantAutoAllowed(prefs, "pos_venda") || !prefs?.pos_venda_auto_validate) {
      out.pos_venda_dispatch = {
        triggered: false,
        reason: !globalOn
          ? "global_toggle_off"
          : !isConsultantAutoAllowed(prefs, "pos_venda")
          ? "consultant_pref_off"
          : "auto_validate_off",
      };
      return out;
    }

    const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
    const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (base && srk) {
      void fetch(`${base}/functions/v1/pos-venda-auto-progress`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${srk}`,
          apikey: srk,
          "Content-Type": "application/json",
        },
        body: "{}",
      }).then(async (resp) => {
        const txt = await resp.text().catch(() => "");
        console.log(`[sync-all] pos-venda-auto-progress → ${resp.status} ${txt.slice(0, 200)}`);
      }).catch((e) => {
        console.warn("[sync-all] pos-venda trigger:", e instanceof Error ? e.message : String(e));
      });
      out.pos_venda_dispatch = { triggered: true };
    }
  } catch (e) {
    out.pos_venda_recompute = { error: e instanceof Error ? e.message : String(e) };
  }
  return out;
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
  syncRunId: string | null = null,
  expectedAccountIds: string[] | null = null,
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

    // Persiste a lista COMPLETA de clientes (varredura por dia). A Fase A
    // já gravou o Kanban rápido; aqui completamos com os que faltavam.
    // Só carteira igreen_sync via persistCustomers — não cria lead.
    let fullCustomers: any[] = Array.isArray(r.data?.customers) ? r.data.customers : [];
    if (fullCustomers.length === 0) {
      console.warn(`[sync-all background] /sync-all sem customers (${emailNorm}) — fallback /sync-customers full`);
      const fr = await callWorker(worker, "/sync-customers", {
        portal_email: emailNorm,
        portal_password: passwordNorm,
      });
      if (fr.ok && Array.isArray(fr.data?.customers)) {
        fullCustomers = fr.data.customers;
        out.customers_full_fallback = "sync-customers";
      }
    }
    // Nunca perder quem a Fase A (Kanban) já trouxe: merge por código.
    if (Array.isArray(baseCustomers) && baseCustomers.length > 0) {
      const byCode = new Map<string, any>();
      for (const c of fullCustomers) {
        const code = safeStr(c?.codigo || c?.codigoIgreen || c?.codigoCliente || c?.idcliente || c?.id);
        if (code) byCode.set(code, c);
      }
      for (const c of baseCustomers) {
        const code = safeStr(c?.codigo || c?.codigoIgreen || c?.codigoCliente || c?.idcliente || c?.id);
        if (code && !byCode.has(code)) {
          byCode.set(code, c);
          fullCustomers.push(c);
        }
      }
      if (fullCustomers.length < baseCustomers.length) {
        console.warn(
          `[sync-all background] full(${fullCustomers.length}) < kanban(${baseCustomers.length}) — merge aplicou códigos faltantes`,
        );
      }
    }
    if (fullCustomers.length > 0) {
      try {
        out.customers_full = await persistCustomers(supabase, consultantId, fullCustomers, igreenAccountId);
        // fora_da_carteira SÓ com lista full + account_id (nunca no Kanban parcial).
        out.portfolio_full = await markOutOfPortfolio(supabase, consultantId, fullCustomers, igreenAccountId);
        if (igreenAccountId) {
          await supabase.from("igreen_portal_accounts")
            .update({ last_sync_at: new Date().toISOString() })
            .eq("id", igreenAccountId);
        }
      } catch (e) {
        out.customers_full_error = e instanceof Error ? e.message : String(e);
        console.error("[sync-all background] customers_full:", out.customers_full_error);
      }
    } else {
      out.customers_full_error = "Lista completa vazia após /sync-all e fallback";
      out.success = false;
    }

    try { out.network = await persistNetwork(supabase, consultantId, r.data?.members || [], igreenAccountId); }
    catch (e) { out.network_error = e instanceof Error ? e.message : String(e); }
    out.metrics = await persistMetrics(supabase, consultantId, r.data?.metrics, igreenAccountId);
    // Persiste SEMPRE tudo (não depende de toggle). A página nunca fica vazia.
    out.boletos = await persistBoletos(supabase, consultantId, r.data?.boletos || [], igreenAccountId);
    out.telecom = await persistTelecom(supabase, consultantId, r.data?.telecom || [], igreenAccountId);
    out.seguros = await persistSeguros(supabase, consultantId, r.data?.seguros || [], igreenAccountId);
    out.devolutivas = await persistDevolutivas(supabase, consultantId, r.data?.devolutivas || [], igreenAccountId);
    out.cashback = await persistCashback(supabase, consultantId, r.data?.cashback || {}, igreenAccountId);
    if (r.data?.portal_extras) {
      try {
        out.portal_extras = await persistPortalExtras(supabase, consultantId, r.data.portal_extras, igreenAccountId);
      } catch (e) {
        out.portal_extras_error = e instanceof Error ? e.message : String(e);
      }
    }
    // v18: cobertura total das páginas (telecom/linhas, faturas, comissoes,
    // seguros/apolices, sinistros, network history). Só roda se o worker
    // devolveu `full_extras` (worker v18+).
    if (r.data?.full_extras) {
      try {
        out.full_extras = await persistFullExtras(supabase, consultantId, r.data.full_extras, igreenAccountId);
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
    // Enriquece a lista COMPLETA quando disponível; senão a base (Kanban).
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
        if (i === 0) {
          out.details_error = er.error;
          break;
        }
        out.details_stopped_reason = "enrich_batch_error";
        break;
      }
      const details = er.data?.details || [];
      detailsReceived += details.length;
      const res = await applyCustomerDetails(supabase, consultantId, details, igreenAccountId);
      detailsApplied += Number(res.details_applied || 0);
    }
    out.details = {
      total_codes: allCodes.length,
      prioritized: codes.length,
      details_received: detailsReceived,
      details_applied: detailsApplied,
      stopped_reason: out.details_stopped_reason || null,
    };

    // A fila de enrich quase nunca cabe no orçamento de tempo desta execução.
    // Em vez de parar pela metade (o cliente novo ficava sem CPF/telefone/datas
    // e o pós-venda travava em `espera`), o clique continua sozinho: cada salto
    // é uma nova invocação em enrich_only até a fila zerar.
    const pendingAfter = await countEnrichPending(supabase, consultantId, igreenAccountId);
    out.enrich_pending_after = pendingAfter;
    if (pendingAfter > 0) {
      out.enrich_chain_started = await chainEnrichHop({
        consultantId,
        igreenAccountId,
        portalEmail: emailNorm,
        portalPassword: passwordNorm,
        hop: 1,
        prevRemaining: null,
      });
    }

    // Pós-venda: só carteira (igreen_sync). Respeita pos_venda_manual; não rebaixa.
    // Roda aqui e de novo no fim da cadeia de enrich, quando as datas chegam.
    Object.assign(out, await settlePosVendaAfterSync(supabase, consultantId));

    await supabase.from("settings").upsert({ key: "last_igreen_sync_background", value: new Date().toISOString() }, { onConflict: "key" });
  } catch (err) {
    out.success = false;
    out.error = err instanceof Error ? err.message : String(err);
    console.error("[sync-all background]", err);
  } finally {
    if (out.success) await updateAutomationTimestamps(supabase, consultantId, out);
    // Persiste no run_id da conta (não no "último run" do consultor).
    try {
      await persistSyncRunBackgroundExtras(
        supabase,
        syncRunId,
        consultantId,
        igreenAccountId,
        out,
        expectedAccountIds,
      );
    } catch (persistErr) {
      console.warn("[sync-all background] failed to persist extras:", persistErr instanceof Error ? persistErr.message : String(persistErr));
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
  /** Se informado, sincroniza só esta linha de `igreen_portal_accounts` (botão por conta na UI). */
  onlyAccountId?: string | null,
  /** Run de telemetria — a Fase B grava extras neste id (anti-corrida). */
  syncRunId?: string | null,
): Promise<Record<string, unknown>> {
  let q = supabase
    .from("igreen_portal_accounts")
    .select("id, position, label, portal_email, portal_password, last_sync_at")
    .eq("consultant_id", consultantId)
    .order("position", { ascending: true });
  if (onlyAccountId) q = q.eq("id", onlyAccountId);

  const { data: accounts } = await q;

  const list = (accounts || []) as Array<{ id: string; position: number; label: string | null; portal_email: string; portal_password: string; last_sync_at: string | null }>;

  // Compatibilidade: consultor sem nenhuma linha em igreen_portal_accounts
  // ainda (ex.: credencial antiga não migrada) — usa o fallback direto, sem
  // account_id (comportamento legado).
  if (list.length === 0) {
    if (onlyAccountId) {
      return { success: false, error: "Conta iGreen não encontrada para este consultor." };
    }
    if (!fallbackEmail || !fallbackPassword) {
      return { success: false, error: "Nenhuma conta iGreen configurada para este consultor." };
    }
    return await syncOneConsultant(
      supabase, worker, fallbackEmail, fallbackPassword, consultantId, mode, null, syncRunId || null, null,
    );
  }

  const results: Record<string, unknown>[] = [];
  const STALE_MS = 6 * 60 * 60 * 1000; // 6 h
  // Contas nunca sincronizadas / stale primeiro — evita estourar o tempo da edge
  // e deixar subcontas novas (ex.: Dijalma) de fora no fim da fila.
  const ordered = [...list].sort((a, b) => {
    const score = (acc: typeof a) => {
      const last = acc.last_sync_at ? new Date(acc.last_sync_at).getTime() : 0;
      if (!last) return 0; // nunca syncou
      if (Date.now() - last > STALE_MS) return 1;
      return 2;
    };
    return score(a) - score(b) || a.position - b.position;
  });
  // Só contas que vão disparar Fase B (sync_all) entram no expected —
  // enrich_only não agenda background e não pode travar o wait.
  const expectedAccountIds = ordered
    .filter((acc) => {
      const lastSync = acc.last_sync_at ? new Date(acc.last_sync_at).getTime() : 0;
      const isStale = !lastSync || Date.now() - lastSync > STALE_MS;
      const accMode = isStale && mode === "enrich_only" ? "sync_all" : mode;
      return accMode === "sync_all";
    })
    .map((a) => a.id);
  for (const acc of ordered) {
    // FORÇA sync_all na PRIMEIRA vez que uma subconta é encontrada (last_sync_at NULL)
    // ou quando a última sync completa é > 6 h. Assim, contas recém-adicionadas
    // (ex.: Nilma) puxam TODOS os clientes + rede na primeira execução, mesmo
    // que o cron esteja rodando em modo enrich_only.
    const lastSync = acc.last_sync_at ? new Date(acc.last_sync_at).getTime() : 0;
    const isStale = !lastSync || Date.now() - lastSync > STALE_MS;
    const accMode = isStale && mode === "enrich_only" ? "sync_all" : mode;
    console.log(`[multi-account] sync conta position=${acc.position} (${acc.label || acc.portal_email}) consultant=${consultantId} mode=${accMode}${accMode !== mode ? " (forced full)" : ""}`);
    try {
      const r = await syncOneConsultant(
        supabase, worker, acc.portal_email, acc.portal_password, consultantId, accMode,
        acc.id, syncRunId || null, expectedAccountIds,
      );
      results.push({ account_id: acc.id, position: acc.position, label: acc.label, mode: accMode, ...r });
      await updateAccountCredentialStatus(
        supabase,
        acc.id,
        Boolean(r?.success),
        r?.success ? null : String(r?.error || ""),
      );
      // Marca last_sync_at após Fase A OK. A Fase B atualiza de novo quando
      // customers_full grava (lista completa da carteira).
      if (r?.success && (accMode === "sync_all" || accMode === "sync")) {
        await supabase.from("igreen_portal_accounts")
          .update({ last_sync_at: new Date().toISOString() })
          .eq("id", acc.id);
      }
      // Fase A falhou: não há Fase B. Marca a conta como "background done"
      // (falha) para o waitIgreenSyncFinished não ficar eterno no multi-conta.
      if (!r?.success && syncRunId && (accMode === "sync_all" || accMode === "sync")) {
        try {
          await persistSyncRunBackgroundExtras(
            supabase,
            syncRunId,
            consultantId,
            acc.id,
            {
              success: false,
              error: String(r?.error || "Fase A falhou — lista completa não iniciada"),
              customers_full_error: "fase_a_failed",
            },
            expectedAccountIds,
          );
        } catch (e) {
          console.warn("[multi-account] stub extras falhou:", e instanceof Error ? e.message : String(e));
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({ account_id: acc.id, position: acc.position, label: acc.label, mode: accMode, success: false, error: errMsg });
      await updateAccountCredentialStatus(supabase, acc.id, false, errMsg);
      if (syncRunId && (accMode === "sync_all" || accMode === "sync")) {
        try {
          await persistSyncRunBackgroundExtras(
            supabase,
            syncRunId,
            consultantId,
            acc.id,
            { success: false, error: errMsg, customers_full_error: "fase_a_exception" },
            expectedAccountIds,
          );
        } catch { /* ignore */ }
      }
    }
    // Pausa entre contas para não sobrecarregar o proxy/portal com logins em sequência.
    await new Promise((res) => setTimeout(res, 2000));
  }
  const anySuccess = results.some((r) => r.success);
  // Sucesso parcial: se alguma conta falhou, ainda reporta success=true se
  // outras gravaram — mas inclui falhas em `results` para a UI/telemetria.
  const failed = results.filter((r) => !r.success);
  return {
    success: anySuccess,
    mode,
    accounts_synced: results.length,
    accounts_failed: failed.length,
    results,
    error: !anySuccess
      ? (failed[0]?.error as string) || "Nenhuma conta sincronizou."
      : failed.length > 0
      ? `${failed.length} conta(s) falharam (demais OK).`
      : undefined,
  };
}

// deno-lint-ignore no-explicit-any
function scheduleSyncAllBackgroundPhase(...args: any[]): void {
  const task = runSyncAllBackgroundPhase(
    args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7],
    args[8] ?? null, // syncRunId
    args[9] ?? null, // expectedAccountIds
  );
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
async function persistFullExtras(supabase: any, consultantId: string | null, fullExtras: any, igreenAccountId: string | null = null): Promise<Record<string, unknown>> {
  if (!consultantId || !fullExtras?.blocks) return { skipped: true };
  const summary: Record<string, unknown> = {};
  const blocks = fullExtras.blocks as Record<string, { items?: any[]; data?: any; single?: boolean }>;
  const accountField = igreenAccountId ? { igreen_account_id: igreenAccountId } : {};

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
      ...accountField,
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
    summary.telecom_linhas = await upsertBatch(
      "igreen_telecom_linhas",
      rows,
      igreenAccountId ? "consultant_id,igreen_account_id,msisdn" : "consultant_id,msisdn",
    );
  }

  // Telecom → faturas
  const faturas = blocks["telecom.faturas"]?.items || [];
  if (faturas.length) {
    const rows = faturas.map((it: any) => ({
      consultant_id: consultantId,
      ...accountField,
      idcnxtelecom: strOrNull(it.idcnxtelecom ?? it.idConexao ?? it.id) ?? String(stableIntId(JSON.stringify(it))),
      msisdn: strOrNull(it.msisdn ?? it.numero ?? it.linha),
      mes_referencia: mesRef(it.mesReferencia ?? it.mes ?? it.competencia ?? it.vencimento),
      valor_cents: centsFromValor(it.valor ?? it.valorTotal ?? it.valorPago),
      status: strOrNull(it.status ?? it.situacao),
      vencimento: dateOrNull(it.vencimento ?? it.dataVencimento),
      pago_em: dateOrNull(it.pagoEm ?? it.dataPagamento),
      raw: it,
    }));
    summary.telecom_faturas = await upsertBatch(
      "igreen_telecom_faturas",
      rows,
      igreenAccountId ? "consultant_id,igreen_account_id,idcnxtelecom,mes_referencia" : "consultant_id,idcnxtelecom,mes_referencia",
    );
  }

  // Telecom → comissões
  const telecomComissoes = blocks["telecom.comissoes"]?.items || [];
  if (telecomComissoes.length) {
    const rows = telecomComissoes.map((it: any) => ({
      consultant_id: consultantId,
      ...accountField,
      mes_referencia: mesRef(it.mesReferencia ?? it.mes ?? it.competencia),
      origem: strOrNull(it.origem ?? it.tipo ?? it.categoria),
      valor_cents: centsFromValor(it.valor ?? it.valorComissao),
      status: strOrNull(it.status ?? it.situacao),
      descricao: strOrNull(it.descricao ?? it.detalhes),
      external_id: strOrNull(it.id ?? it.idComissao) ?? String(stableIntId(JSON.stringify(it))),
      raw: it,
    }));
    summary.telecom_comissoes = await upsertBatch(
      "igreen_telecom_comissoes",
      rows,
      igreenAccountId ? "consultant_id,igreen_account_id,external_id,mes_referencia" : "consultant_id,external_id,mes_referencia",
    );
  }

  // Seguros → comissões
  const segurosComissoes = blocks["seguros.comissoes"]?.items || [];
  if (segurosComissoes.length) {
    const rows = segurosComissoes.map((it: any) => ({
      consultant_id: consultantId,
      ...accountField,
      mes_referencia: mesRef(it.mesReferencia ?? it.mes ?? it.competencia),
      origem: strOrNull(it.origem ?? it.tipo ?? it.categoria),
      valor_cents: centsFromValor(it.valor ?? it.valorComissao),
      status: strOrNull(it.status ?? it.situacao),
      descricao: strOrNull(it.descricao ?? it.detalhes),
      external_id: strOrNull(it.id ?? it.idComissao) ?? String(stableIntId(JSON.stringify(it))),
      raw: it,
    }));
    summary.seguros_comissoes = await upsertBatch(
      "igreen_seguros_comissoes",
      rows,
      igreenAccountId ? "consultant_id,igreen_account_id,external_id,mes_referencia" : "consultant_id,external_id,mes_referencia",
    );
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
      let q = supabase.from("igreen_seguros_customers")
        .update(patch).eq("consultant_id", consultantId).eq("apolice_id", apoliceId);
      if (igreenAccountId) q = q.eq("igreen_account_id", igreenAccountId);
      const { error } = await q;
      if (!error) updated++;
    }
    summary.seguros_enrich_updated = updated;
  }

  // Rede → snapshot mensal — SÓ conta principal (evita subconta sobrescrever)
  const netHist = blocks["network.history"]?.items || [];
  if (Array.isArray(netHist) && netHist.length) {
    let allowNetworkSnap = true;
    if (igreenAccountId) {
      const { data: acc } = await supabase.from("igreen_portal_accounts")
        .select("position").eq("id", igreenAccountId).maybeSingle();
      if (acc && Number(acc.position) > 1) {
        allowNetworkSnap = false;
        summary.network_snapshots_skipped = "subaccount";
      }
    }
    if (allowNetworkSnap) {
      const rows = netHist.filter((h: any) => h.mes).map((h: any) => ({
        consultant_id: consultantId,
        ...accountField,
        mes_referencia: String(h.mes).slice(0, 7),
        payload: {
          count: h.count ?? (Array.isArray(h.items) ? h.items.length : 0),
          error: h.error ?? null,
          items: Array.isArray(h.items) ? h.items.slice(0, 500) : null,
        },
      }));
      summary.network_snapshots = await upsertBatch(
        "igreen_network_snapshots",
        rows,
        igreenAccountId ? "consultant_id,igreen_account_id,mes_referencia" : "consultant_id,mes_referencia",
      );
    }
  }

  summary.per_route = fullExtras.per_route_summary || null;
  return summary;
}

// Persiste extras de portal por conta (campanha Gusttavo, financeiro, expansão…).
// deno-lint-ignore no-explicit-any
async function persistPortalExtras(
  supabase: any,
  consultantId: string | null,
  extras: any,
  igreenAccountId: string | null = null,
): Promise<Record<string, unknown>> {
  if (!consultantId || !extras) return { skipped: true };
  const accountId = await ensureAccountId(supabase, consultantId, igreenAccountId);
  const mes = new Date().toISOString().slice(0, 7);
  const out: Record<string, unknown> = {};

  // Atualiza JSON na métrica da conta (cria linha se não existir)
  const metricsPatch: Record<string, unknown> = {
    consultant_id: consultantId,
    mes_ref: mes,
    updated_at: new Date().toISOString(),
    synced_at: new Date().toISOString(),
  };
  if (accountId) metricsPatch.igreen_account_id = accountId;
  if (extras.campanha_boleto) metricsPatch.campanha_boleto_json = extras.campanha_boleto;
  if (extras.financeiro) metricsPatch.financeiro_json = extras.financeiro;
  if (extras.extrato_expansao) metricsPatch.extrato_expansao_json = extras.extrato_expansao;
  if (extras.extrato_kwh) metricsPatch.extrato_kwh_json = extras.extrato_kwh;
  if (extras.telecom_pendencias) metricsPatch.telecom_pendencias_json = extras.telecom_pendencias;
  if (extras.seguros_pendencias) metricsPatch.seguros_pendencias_json = extras.seguros_pendencias;
  if (extras.rede_overview) metricsPatch.rede_overview_json = extras.rede_overview;

  const { error: mErr } = await supabase.from("igreen_consultant_metrics").upsert(metricsPatch, {
    onConflict: "consultant_id,igreen_account_id,mes_ref",
    ignoreDuplicates: false,
  });
  if (mErr) {
    console.error("portal_extras metrics:", mErr.message);
    out.metrics_error = mErr.message;
  } else {
    out.metrics_saved = true;
  }

  // Elegíveis Gusttavo → tabela dedicada (scoped por conta)
  const elegiveis = extras.campanha_boleto?.elegiveis;
  if (Array.isArray(elegiveis)) {
    const rows = elegiveis.map((e: any) => ({
      consultant_id: consultantId,
      igreen_account_id: accountId,
      idcliente: Number(e.idcliente),
      nome: safeStr(e.nome),
      cidade: safeStr(e.cidade),
      uf: safeStr(e.uf),
      licenciado: safeStr(e.licenciado),
      idlicenciado: e.idlicenciado != null ? String(e.idlicenciado) : null,
      valor: safeNum(e.valor),
      vencimento: safeStr(e.vencimento)?.slice(0, 10) || null,
      dias_atraso: e.diasAtraso != null ? Number(e.diasAtraso) : null,
      url_boleto: safeStr(e.urlboleto),
      celular: safeStr(e.celular),
      propria: typeof e.propria === "boolean" ? e.propria : null,
      abertos: e.abertos != null ? Number(e.abertos) : null,
      raw_json: e,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })).filter((r: { idcliente: number }) => Number.isFinite(r.idcliente) && r.idcliente > 0);

    // Remove elegíveis antigos desta conta que saíram da lista
    if (accountId) {
      const keepIds = new Set(rows.map((r: { idcliente: number }) => r.idcliente));
      const { data: existing } = await supabase
        .from("igreen_campanha_boleto_elegiveis")
        .select("idcliente")
        .eq("consultant_id", consultantId)
        .eq("igreen_account_id", accountId);
      const toDelete = ((existing || []) as Array<{ idcliente: number }>)
        .map((e) => e.idcliente)
        .filter((id) => !keepIds.has(id));
      if (toDelete.length > 0) {
        await supabase
          .from("igreen_campanha_boleto_elegiveis")
          .delete()
          .eq("consultant_id", consultantId)
          .eq("igreen_account_id", accountId)
          .in("idcliente", toDelete);
      }
    }

    let saved = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { data, error } = await supabase
        .from("igreen_campanha_boleto_elegiveis")
        .upsert(batch, { onConflict: "consultant_id,igreen_account_id,idcliente", ignoreDuplicates: false })
        .select("id");
      if (error) console.error("campanha elegiveis:", error.message);
      else saved += data?.length || 0;
    }
    out.campanha_elegiveis_saved = saved;
    out.campanha_elegiveis_received = elegiveis.length;
  }

  return out;
}

// =====================================================
async function resolvePrincipalAccountId(supabase: any, consultantId: string | null): Promise<string | null> {
  if (!consultantId) return null;
  const { data } = await supabase
    .from("igreen_portal_accounts")
    .select("id")
    .eq("consultant_id", consultantId)
    .eq("position", 1)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

/** Garante igreen_account_id — sem isso o unique multiconta não casa e a conta principal some. */
async function ensureAccountId(
  supabase: any,
  consultantId: string | null,
  igreenAccountId: string | null,
): Promise<string | null> {
  if (igreenAccountId) return igreenAccountId;
  return resolvePrincipalAccountId(supabase, consultantId);
}

// Persistência de métricas (painel/rotinas) e boletos — Fase 2
// =====================================================
// deno-lint-ignore no-explicit-any
async function persistMetrics(supabase: any, consultantId: string | null, metrics: any, igreenAccountId: string | null = null): Promise<Record<string, unknown>> {
  if (!consultantId || !metrics) return { metrics_saved: false, metrics_received: metrics ? 1 : 0 };
  const accountId = await ensureAccountId(supabase, consultantId, igreenAccountId);
  const mes = safeStr(metrics.mes) || new Date().toISOString().slice(0, 7);
  const kpis = metrics.overview?.kpis || {};
  const det = kpis.clientesDetalhe || {};
  const rede = metrics.overview?.rede || {};
  const resumo = metrics.resumo_clientes || {};
  const row: Record<string, unknown> = {
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
  if (accountId) row.igreen_account_id = accountId;
  const { error } = await supabase
    .from("igreen_consultant_metrics")
    .upsert(row, {
      onConflict: "consultant_id,igreen_account_id,mes_ref",
      ignoreDuplicates: false,
    });
  if (error) { console.error("metrics upsert:", error.message); return { metrics_saved: false, metrics_received: 1, metrics_error: error.message }; }
  return { metrics_saved: true, metrics_received: 1, mes_ref: mes, igreen_account_id: accountId };
}

// deno-lint-ignore no-explicit-any
async function persistBoletos(supabase: any, consultantId: string | null, boletos: any[], igreenAccountId: string | null = null): Promise<Record<string, unknown>> {
  if (!consultantId || !Array.isArray(boletos) || boletos.length === 0) return { boletos_saved: 0, boletos_received: Array.isArray(boletos) ? boletos.length : 0 };
  const accountId = await ensureAccountId(supabase, consultantId, igreenAccountId);
  const parseDate = (v: unknown): string | null => {
    const s = safeStr(v); if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) { const [, d, mo, y] = m; return `${y.length === 2 ? "20" + y : y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`; }
    return null;
  };
  const rows = boletos.map((b) => ({
    consultant_id: consultantId,
    ...(accountId ? { igreen_account_id: accountId } : {}),
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
  const onConflict = "consultant_id,igreen_account_id,idcliente,mes_referencia";
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { data, error } = await supabase
      .from("igreen_customer_boletos")
      .upsert(batch, { onConflict, ignoreDuplicates: false })
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
      let custQ = supabase
        .from("customers")
        .select("id, igreen_code")
        .eq("consultant_id", consultantId)
        .in("igreen_code", chunk);
      if (accountId) custQ = custQ.eq("igreen_account_id", accountId);
      const { data: cust } = await custQ;
      if (!cust || cust.length === 0) continue;
      for (const c of cust as Array<{ id: string; igreen_code: string }>) {
        let upd = supabase
          .from("igreen_customer_boletos")
          .update({ customer_id: c.id })
          .eq("consultant_id", consultantId)
          .eq("idcliente", Number(c.igreen_code))
          .is("customer_id", null);
        if (accountId) upd = upd.eq("igreen_account_id", accountId);
        await upd;
      }
    }
  } catch (e) {
    console.warn("[boletos] customer_id match falhou (nao critico):", e instanceof Error ? e.message : e);
  }

  return { boletos_saved: saved, boletos_received: boletos.length, igreen_account_id: accountId };
}

// Persiste carteira TELECOM (Opção A — tabela dedicada).
// deno-lint-ignore no-explicit-any
async function persistTelecom(supabase: any, consultantId: string | null, items: any[], igreenAccountId: string | null = null): Promise<Record<string, unknown>> {
  if (!consultantId || !Array.isArray(items) || items.length === 0) return { telecom_saved: 0, telecom_received: Array.isArray(items) ? items.length : 0 };
  const accountId = await ensureAccountId(supabase, consultantId, igreenAccountId);
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
      ...(accountId ? { igreen_account_id: accountId } : {}),
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
  const onConflict = "consultant_id,igreen_account_id,idcnxtelecom";
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { data, error } = await supabase
      .from("igreen_telecom_customers")
      .upsert(batch, { onConflict, ignoreDuplicates: false })
      .select("id");
    if (error) console.error("telecom upsert:", error.message);
    else saved += data?.length || 0;
  }
  return { telecom_saved: saved, telecom_received: items.length, telecom_valid_rows: rows.length, igreen_account_id: accountId };
}

// Persiste CASHBACK por origem no snapshot de métricas (raw) + colunas de saldo.
// deno-lint-ignore no-explicit-any
async function persistCashback(supabase: any, consultantId: string | null, cashback: any, igreenAccountId: string | null = null): Promise<Record<string, unknown>> {
  if (!consultantId || !cashback || typeof cashback !== "object") return { cashback_saved: false, cashback_received: cashback ? 1 : 0 };
  const accountId = await ensureAccountId(supabase, consultantId, igreenAccountId);
  const mes = new Date().toISOString().slice(0, 7);
  const green = cashback.green || {};
  const telecom = cashback.telecom || {};
  const seguros = cashback.seguros || {};
  let q = supabase
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
  if (accountId) q = q.eq("igreen_account_id", accountId);
  const { error } = await q;
  if (error) { console.error("cashback update:", error.message); return { cashback_saved: false, cashback_received: 1, cashback_error: error.message }; }
  return { cashback_saved: true, cashback_received: 1, igreen_account_id: accountId };
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
async function persistSeguros(supabase: any, consultantId: string | null, items: any[], igreenAccountId: string | null = null): Promise<Record<string, unknown>> {
  if (!consultantId || !Array.isArray(items) || items.length === 0) return { seguros_saved: 0, seguros_received: Array.isArray(items) ? items.length : 0 };
  const accountId = await ensureAccountId(supabase, consultantId, igreenAccountId);
  const seen = new Set<string>();
  const rows = [];
  for (const c of items) {
    const sid = safeStr(c.id ?? c.seguro_id ?? c.apolice_id ?? c.codigo ?? c.idcotacao)
      || `auto:${stableIntId(`${safeStr(c.segurado ?? c.cliente ?? c.nome ?? c.nomeCliente) || ""}|${safeStr(c.placa) || ""}|${safeStr(c.modelo ?? c.veiculo ?? c.descricaoVeiculo) || ""}`)}`;
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    rows.push({
      consultant_id: consultantId,
      ...(accountId ? { igreen_account_id: accountId } : {}),
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
  const onConflict = "consultant_id,igreen_account_id,seguro_id";
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { data, error } = await supabase
      .from("igreen_seguros_customers")
      .upsert(batch, { onConflict, ignoreDuplicates: false })
      .select("id");
    if (error) console.error("seguros upsert:", error.message);
    else saved += data?.length || 0;
  }
  return { seguros_saved: saved, seguros_received: items.length, seguros_valid_rows: rows.length, igreen_account_id: accountId };
}

// Persiste DEVOLUTIVAS detalhadas (categoria/impeditiva/campo/data).
// deno-lint-ignore no-explicit-any
async function persistDevolutivas(supabase: any, consultantId: string | null, items: any[], igreenAccountId: string | null = null): Promise<Record<string, unknown>> {
  if (!consultantId || !Array.isArray(items) || items.length === 0) return { devolutivas_saved: 0, devolutivas_received: Array.isArray(items) ? items.length : 0 };
  const accountId = await ensureAccountId(supabase, consultantId, igreenAccountId);
  // resolve customer_id por igreen_code (codigo) quando possível — scoped por conta
  const codes = items.map((d) => safeStr(d._codigo ?? d.codigo)).filter(Boolean) as string[];
  const codeToCustomer = new Map<string, string>();
  for (let i = 0; i < codes.length; i += 200) {
    const chunk = codes.slice(i, i + 200);
    let q = supabase.from("customers").select("id, igreen_code").eq("consultant_id", consultantId).in("igreen_code", chunk);
    if (accountId) q = q.eq("igreen_account_id", accountId);
    const { data } = await q;
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
      ...(accountId ? { igreen_account_id: accountId } : {}),
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
  const onConflict = "consultant_id,igreen_account_id,idcliente,campo,categoria";
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { data, error } = await supabase
      .from("igreen_customer_devolutivas")
      .upsert(batch, { onConflict, ignoreDuplicates: false })
      .select("id");
    if (error) console.error("devolutivas upsert:", error.message);
    else saved += data?.length || 0;
  }
  return { devolutivas_saved: saved, devolutivas_received: items.length, igreen_account_id: accountId };
}

// Reordena os códigos para enriquecer PRIMEIRO quem ainda não tem ficha
// detalhada (last_enriched_at IS NULL). Como o loop de enriquecimento tem
// orçamento de tempo limitado, sem essa priorização os mesmos primeiros
// códigos eram reprocessados a cada sync e o fim da fila nunca era alcançado.
// deno-lint-ignore no-explicit-any
async function prioritizeUnenrichedCodes(supabase: any, consultantId: string | null, codes: string[]): Promise<string[]> {
  if (!consultantId || !Array.isArray(codes) || codes.length === 0) return codes;
  try {
    const enrichedOk = new Set<string>(); // já tem ficha E telefone real
    for (let i = 0; i < codes.length; i += 200) {
      const chunk = codes.slice(i, i + 200);
      const { data } = await supabase
        .from("customers")
        .select("igreen_code, phone_whatsapp, last_enriched_at")
        .eq("consultant_id", consultantId)
        .in("igreen_code", chunk);
      for (const c of (data || []) as Array<{ igreen_code: string; phone_whatsapp: string | null; last_enriched_at: string | null }>) {
        if (!c.igreen_code) continue;
        const phone = String(c.phone_whatsapp || "");
        const hasRealPhone = !!phone && !phone.startsWith("sem_celular_");
        // Placeholder ou nunca enriquecido → continua pendente (subconta pode
        // trazer o celular que a Conta principal mascara).
        if (c.last_enriched_at && hasRealPhone) {
          enrichedOk.add(String(c.igreen_code));
        }
      }
    }
    const pending = codes.filter((c) => !enrichedOk.has(c));
    const done = codes.filter((c) => enrichedOk.has(c));
    return [...pending, ...done];
  } catch {
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
    const dCad = safeStr(d.dataCadastro || d.data_cadastro);
    if (dCad && /^\d{4}-\d{2}-\d{2}/.test(dCad)) {
      patch.data_cadastro_igreen = dCad.slice(0, 10);
      patch.data_cadastro = dCad.slice(0, 10);
    }
    const dVal = safeStr(d.dataValidado || d.data_validado);
    if (dVal && /^\d{4}-\d{2}-\d{2}/.test(dVal)) {
      patch.data_validado_igreen = dVal.slice(0, 10);
      patch.data_validado = dVal.slice(0, 10);
    }
    const dInj = safeStr(d.dataInjecao); if (dInj && /^\d{4}-\d{2}-\d{2}/.test(dInj)) patch.data_injecao_igreen = dInj.slice(0, 10);
    // Pessoais
    const lic = safeStr(d.licenciado); if (lic) patch.registered_by_name = lic;
    const nasc = safeStr(d.dtnasc || d.nascimento);
    if (nasc && /^\d{4}-\d{2}-\d{2}/.test(nasc)) patch.data_nascimento = nasc.slice(0, 10);
    const email = safeStr(d.email); if (email) patch.email = email;
    // Só grava telefone se normalizar para um número real — nunca "" sobre placeholder.
    const cel = safeStr(d.celular);
    if (cel) {
      const phoneNorm = normalizePhone(String(cel));
      if (phoneNorm && !phoneNorm.startsWith("sem_celular_")) {
        patch.phone_whatsapp = phoneNorm;
      }
    }
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
    // Conta que trouxe a ficha completa (com celular) passa a ser a fonte de
    // contato — mesmo se a linha nasceu na Conta principal sem número.
    if (igreenAccountId && patch.phone_whatsapp) {
      patch.igreen_account_id = igreenAccountId;
    }
    if (Object.keys(patch).length === 1) continue; // apenas last_enriched_at

    // SEMPRE por (consultant_id, igreen_code) — NÃO filtrar por igreen_account_id.
    // Cliente da rede do Rafael fica na Conta principal como sem_celular_*; o
    // enrich da subconta (Oseias/Nilma/…) precisa atualizar ESSA linha.
    let { error } = await supabase
      .from("customers")
      .update(patch)
      .eq("consultant_id", consultantId)
      .eq("igreen_code", code)
      .eq("customer_origin", "igreen_sync");
    // Colisão de phone único: aplica o resto e tenta promover só placeholders.
    if (error && patch.phone_whatsapp) {
      const { phone_whatsapp: newPhone, igreen_account_id: accId, ...patchNoPhone } = patch;
      const retry = await supabase
        .from("customers")
        .update(patchNoPhone)
        .eq("consultant_id", consultantId)
        .eq("igreen_code", code)
        .eq("customer_origin", "igreen_sync");
      error = retry.error;
      if (!error) {
        const phonePatch: Record<string, unknown> = { phone_whatsapp: newPhone };
        if (accId) phonePatch.igreen_account_id = accId;
        const { error: phoneErr } = await supabase
          .from("customers")
          .update(phonePatch)
          .eq("consultant_id", consultantId)
          .eq("igreen_code", code)
          .eq("customer_origin", "igreen_sync")
          .like("phone_whatsapp", "sem_celular_%");
        if (phoneErr) {
          console.warn(
            `[enrich] phone upgrade bloqueado igreen_code=${code} phone=${newPhone}: ${phoneErr.message}`,
          );
        }
      }
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
// Marca fora_da_carteira SÓ dentro da mesma conta portal.
// Também RESTAURA quem voltou no batch (limpa fora_da_carteira indevido).
// deno-lint-ignore no-explicit-any
async function markOutOfPortfolio(
  supabase: any,
  consultantId: string | null,
  customersBatch: any[],
  igreenAccountId: string | null = null,
): Promise<Record<string, unknown>> {
  if (!consultantId || !Array.isArray(customersBatch) || customersBatch.length === 0) {
    return { out_of_portfolio_marked: 0, skipped: true };
  }
  const portalCodes = new Set(
    customersBatch
      .map((c: any) => safeStr(c?.igreen_code || c?.codigo))
      .filter((v): v is string => !!v),
  );
  if (portalCodes.size === 0) return { out_of_portfolio_marked: 0, skipped: true };

  // SEM account_id: NÃO marca — evita o bug histórico de subconta apagar a principal.
  if (!igreenAccountId) {
    return { out_of_portfolio_marked: 0, skipped: true, reason: "missing_igreen_account_id" };
  }

  const existing: { id: string; igreen_code: string | null; situacao_igreen: string | null }[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("customers")
      .select("id, igreen_code, situacao_igreen")
      .eq("consultant_id", consultantId)
      .eq("customer_origin", "igreen_sync")
      .eq("igreen_account_id", igreenAccountId)
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

  const toRestore = existing
    .filter((r) => r.igreen_code && portalCodes.has(String(r.igreen_code)) && r.situacao_igreen === "fora_da_carteira")
    .map((r) => r.id);

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

  let restored = 0;
  for (let i = 0; i < toRestore.length; i += 200) {
    const chunk = toRestore.slice(i, i + 200);
    const { data, error } = await supabase
      .from("customers")
      .update({ situacao_igreen: null })
      .in("id", chunk)
      .select("id");
    if (error) {
      console.error("markOutOfPortfolio restore:", error.message);
      break;
    }
    restored += data?.length || 0;
  }

  return {
    out_of_portfolio_marked: marked,
    restored,
    checked: existing.length,
    candidates: toMark.length,
    igreen_account_id: igreenAccountId,
  };
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
  syncRunId: string | null = null,
  expectedAccountIds: string[] | null = null,
  enrichChain: EnrichChainState | null = null,
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
    // NÃO marca fora_da_carteira na Fase A: o Kanban fast é incompleto e
    // apagava a carteira das outras contas. O mark fica só na Fase B (lista full).
    out.portfolio = { deferred_to_background: true };

    const syncTimestamp = new Date().toISOString();
    await supabase.from("settings").upsert({ key: "last_igreen_sync", value: syncTimestamp }, { onConflict: "key" });
    out.synced_at = syncTimestamp;
    out.background = { extras_and_enrich: "started" };

    // Fase B: extras + lista COMPLETA da carteira em background.
    // Amarrada ao run_id para não misturar multi-conta.
    scheduleSyncAllBackgroundPhase(
      supabase,
      worker,
      emailNorm,
      passwordNorm,
      consultantId,
      toggles,
      base.data?.customers || [],
      igreenAccountId,
      syncRunId,
      expectedAccountIds ?? (igreenAccountId ? [igreenAccountId] : ["_default"]),
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
    // Fila: sem ficha ainda + placeholders que ESTA conta consegue resolver
    // (o portal só devolve o celular de quem a própria conta cadastrou).
    const codes = (await fetchEnrichQueue(supabase, consultantId, igreenAccountId, enrichCap))
      .map((c) => c.igreen_code)
      .filter(Boolean);
    if (codes.length === 0) {
      const settled = await settlePosVendaAfterSync(supabase, consultantId);
      return {
        success: true,
        mode: "enrich_only",
        details_applied: 0,
        pending_remaining: 0,
        message: "nada a enriquecer",
        ...settled,
      };
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
    const remaining = await countEnrichPending(supabase, consultantId, igreenAccountId);
    const hop = enrichChain?.hop ?? 0;
    const prevRemaining = enrichChain?.prevRemaining ?? null;
    // Só continua enquanto a fila ANDA. Cliente que o portal nunca devolve
    // (ficha inexistente) ficaria eterno na fila e faria a cadeia girar sem fim.
    const progressed = prevRemaining === null || remaining < prevRemaining;
    let chained = false;
    if (remaining > 0 && applied > 0 && progressed && hop < ENRICH_MAX_HOPS) {
      chained = await chainEnrichHop({
        consultantId,
        igreenAccountId,
        portalEmail: emailNorm,
        portalPassword: passwordNorm,
        hop: hop + 1,
        prevRemaining: remaining,
      });
    }
    const tail = chained ? {} : await settlePosVendaAfterSync(supabase, consultantId);
    return {
      success: true,
      mode: "enrich_only",
      details_received: received,
      details_applied: applied,
      pending_remaining: remaining,
      enrich_hop: hop,
      enrich_chained: chained,
      enrich_chain_stopped: chained
        ? null
        : remaining === 0
        ? "fila_zerada"
        : applied === 0
        ? "sem_ficha_no_portal"
        : !progressed
        ? "fila_parada"
        : "max_hops",
      ...tail,
    };
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
  const cust = await persistCustomers(supabase, consultantId, allCustomers, igreenAccountId);
  // Só marca fora_da_carteira com lista completa + account_id (nunca no fast).
  const portfolio = await markOutOfPortfolio(supabase, consultantId, allCustomers, igreenAccountId);
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
  // Anti-duplicação + upgrade multi-conta
  //
  // 1) Placeholder na run atual + telefone real já no banco → reusa o real
  //    (upsert por phone atualiza a linha certa).
  // 2) Telefone REAL na run (ex.: sync da subconta Oseias) + linha existente
  //    com sem_celular_* (nasceu na Conta principal / rede) → UPDATE por
  //    igreen_code (NÃO upsert por phone — senão INSERT novo bate no unique
  //    consultant_id+igreen_code e o número nunca cola).
  // ---------------------------------------------------------------------------
  type ExistingByCode = {
    id: string;
    phone_whatsapp: string | null;
    igreen_account_id: string | null;
  };
  const codeToExisting = new Map<string, ExistingByCode>();
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
        .select("id, igreen_code, phone_whatsapp, igreen_account_id")
        .eq("consultant_id", consultantId)
        .eq("customer_origin", "igreen_sync")
        .in("igreen_code", chunk);
      if (!error && data) {
        for (const row of data as Array<ExistingByCode & { igreen_code: string }>) {
          if (!row.igreen_code) continue;
          codeToExisting.set(String(row.igreen_code), {
            id: row.id,
            phone_whatsapp: row.phone_whatsapp,
            igreen_account_id: row.igreen_account_id,
          });
          const p = String(row.phone_whatsapp || "");
          if (p && !p.startsWith("sem_celular_")) {
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
    const icode = safeStr(get(c, "codigoCliente", "codigoIgreen", "codigo", "Código"));
    if (icode) record.igreen_code = icode;

    // Se buildRecord gerou placeholder mas já temos telefone real no banco,
    // reusa o real para o upsert atualizar a linha existente.
    if (phone.startsWith("sem_celular_")) {
      const real = icode ? codeToRealPhone.get(icode) : undefined;
      if (real) {
        record.phone_whatsapp = real;
        if (record.status === "contato_incompleto") delete record.status;
        phone = real;
        placeholderReused++;
      }
    }

    if (seenPhones.has(phone)) {
      if (icode) {
        const uniquePhone = `${phone}_${icode}`;
        record.phone_whatsapp = uniquePhone;
        // Unique exige sufixo, mas o envio (WA) usa whatsapp_chat_id || phone.
        record.whatsapp_chat_id = phone;
        seenPhones.set(uniquePhone, String(record.name || "unknown"));
      } else continue;
    } else {
      seenPhones.set(phone, String(record.name || "unknown"));
      if (!phone.startsWith("sem_celular_")) {
        record.whatsapp_chat_id = phone;
      }
    }

    if (consultantId) record.consultant_id = consultantId;
    if (igreenAccountId) record.igreen_account_id = igreenAccountId;
    records.push(record);
  }
  if (placeholderReused > 0) console.log(`[persistCustomers] ${placeholderReused} placeholders 'sem_celular_*' substituídos por telefone real do banco`);

  // Proteção mid-conversation + detecção de leads que viram carteira.
  //
  // Bug (jul/2026): steps pós-cadastro (ex.: cadastro_em_analise) eram tratados
  // como "mid-convo", o que apagava customer_origin do upsert e impedia o flip
  // lead → igreen_sync. Resultado: cliente já no portal (com igreen_code /
  // validado) continuava no Kanban de leads (Lucineia, Osmar, etc.).
  //
  // Regra:
  // - Apareceu no batch do portal + origem lead → SEMPRE vira carteira (flip + limpa deals).
  // - midConvo só protege overwrite de `status` em passos reais do funil do bot
  //   (ainda pedindo conta/doc). Nunca bloqueia customer_origin.
  const POST_CADASTRO_STEPS = new Set([
    "cadastro_em_analise",
    "aguardando_assinatura",
    "aguardando_facial",
    "complete",
    "portal_submitting",
    "aguardando_otp",
    "validando_otp",
  ]);
  const POST_CADASTRO_STATUSES = new Set([
    "registered_igreen",
    "cadastro_concluido",
    "complete",
    "approved",
    "active",
    "awaiting_signature",
    "awaiting_facial",
    "portal_submitted",
    "data_complete",
  ]);
  const isPostCadastro = (step: string | null | undefined, status: string | null | undefined) => {
    if (status && POST_CADASTRO_STATUSES.has(status)) return true;
    if (!step) return false;
    const raw = step.startsWith("flow:") ? step.slice(5) : step;
    return POST_CADASTRO_STEPS.has(raw);
  };
  const isMidConversation = (step: string | null | undefined, status: string | null | undefined) => {
    if (isPostCadastro(step, status)) return false;
    if (!step || step === "complete") return false;
    return true;
  };

  const allPhones = records.map((r) => String(r.phone_whatsapp));
  // Também olha o dígito limpo (whatsapp_chat_id / sem sufixo _codigo).
  // Sem isso, lead sombra no número limpo nunca flipa quando a carteira
  // gravou phone_whatsapp com colisão `5511…_igreenCode`.
  const cleanPhones = records
    .map((r) => {
      const chat = String(r.whatsapp_chat_id || "").replace(/\D/g, "");
      if (chat.length >= 12) return chat;
      return String(r.phone_whatsapp || "").split("_")[0].replace(/\D/g, "");
    })
    .filter((p) => p.length >= 12);
  const lookupPhones = [...new Set([...allPhones, ...cleanPhones])];
  const midConvoPhones = new Set<string>();
  const recadastroPhones = new Set<string>();
  const flippingToWalletIds: string[] = [];
  const flipCompleteStepIds: string[] = [];
  for (let i = 0; i < lookupPhones.length; i += 200) {
    const chunk = lookupPhones.slice(i, i + 200);
    let q = supabase
      .from("customers")
      .select("id, phone_whatsapp, conversation_step, customer_origin, status, pos_venda_recadastro_at")
      .in("phone_whatsapp", chunk);
    if (consultantId) q = q.eq("consultant_id", consultantId);
    const { data: existing } = await q;
    if (existing) {
      for (const e of existing as Array<{
        id: string;
        phone_whatsapp: string;
        conversation_step: string | null;
        customer_origin: string | null;
        status: string | null;
        pos_venda_recadastro_at: string | null;
      }>) {
        const midConvo = isMidConversation(e.conversation_step, e.status);
        if (midConvo) midConvoPhones.add(e.phone_whatsapp);
        // Retentativa ativa: não re-flipar origem/status enquanto o novo cadastro roda.
        if (e.pos_venda_recadastro_at && !isPostCadastro(e.conversation_step, e.status)) {
          recadastroPhones.add(e.phone_whatsapp);
          continue;
        }
        const isLeadOrigin = !e.customer_origin || e.customer_origin === "whatsapp_lead" || e.customer_origin === "manual";
        // Lead no batch do portal → sai do funil de leads (Kanban), independente do step.
        if (consultantId && isLeadOrigin) {
          flippingToWalletIds.push(e.id);
          if (isPostCadastro(e.conversation_step, e.status)) flipCompleteStepIds.push(e.id);
        }
      }
    }
  }
  if (midConvoPhones.size > 0) {
    console.log(`⚠️ Protecting status of ${midConvoPhones.size} mid-conversation leads (origin still flips to wallet)`);
  }
  if (recadastroPhones.size > 0) {
    console.log(`⚠️ Protecting ${recadastroPhones.size} recadastro (retentativa) phones from wallet flip`);
  }
  for (const rec of records) {
    const phone = String(rec.phone_whatsapp);
    if (recadastroPhones.has(phone)) {
      delete rec.customer_origin;
      delete rec.status;
      continue;
    }
    if (midConvoPhones.has(phone)) {
      // Preserva status do bot no meio do funil; NÃO apaga customer_origin.
      delete rec.status;
    }
  }

  let updatedCount = 0;
  let errorCount = 0;
  let upgradedFromPlaceholder = 0;
  let updatedByCode = 0;
  const failedSamples: Array<Record<string, unknown>> = [];

  // Particiona: linha já existe por igreen_code → UPDATE por id (permite
  // trocar sem_celular_* → telefone real sem bater no unique do código).
  // Senão → upsert clássico por (phone_whatsapp, consultant_id).
  const toInsert: Record<string, unknown>[] = [];
  const toUpdateById: Array<{ id: string; patch: Record<string, unknown>; wasPlaceholder: boolean }> = [];
  const phonesClaimedInBatch = new Set<string>();

  // Titulares atuais dos telefones limpos no banco (fora do batch). Se o dono
  // do número limpo for lead sombra/bloqueado, a carteira PROMOVE o limpo e a
  // sombra é rebaixada para `<limpo>_<codigo|sombra>` — sem isso o update por
  // código bate no unique (consultant_id+phone) ou o sufixo `_codigo` volta a
  // aparecer no cliente canônico (regressão vista em 2026-08).
  const cleanPhoneHolder = new Map<string, {
    id: string;
    igreen_code: string | null;
    do_not_contact: boolean | null;
    customer_origin: string | null;
  }>();
  if (consultantId) {
    const cleans = new Set<string>();
    for (const rec of records) {
      const p = String(rec.phone_whatsapp || "");
      if (!p || p.startsWith("sem_celular_")) continue;
      cleans.add(p.includes("_") ? p.split("_")[0] : p);
    }
    const cleanList = Array.from(cleans);
    for (let i = 0; i < cleanList.length; i += 200) {
      const { data } = await supabase
        .from("customers")
        .select("id, phone_whatsapp, igreen_code, do_not_contact, customer_origin")
        .eq("consultant_id", consultantId)
        .in("phone_whatsapp", cleanList.slice(i, i + 200));
      for (const row of (data as Array<Record<string, unknown>>) || []) {
        cleanPhoneHolder.set(String(row.phone_whatsapp), {
          id: String(row.id),
          igreen_code: (row.igreen_code as string | null) ?? null,
          do_not_contact: (row.do_not_contact as boolean | null) ?? null,
          customer_origin: (row.customer_origin as string | null) ?? null,
        });
      }
    }
  }
  const holderDemotions: Array<{ id: string; phone_whatsapp: string }> = [];

  for (const rec of records) {
    const code = String(rec.igreen_code || "");
    const existing = code ? codeToExisting.get(code) : undefined;
    if (!existing?.id) {
      toInsert.push(rec);
      continue;
    }
    const incoming = String(rec.phone_whatsapp || "");
    const current = String(existing.phone_whatsapp || "");
    const incomingReal = !!incoming && !incoming.startsWith("sem_celular_");
    const currentReal = !!current && !current.startsWith("sem_celular_");
    const patch: Record<string, unknown> = { ...rec };
    delete patch.id;
    // Merge de telefone: real sempre vence placeholder; dois reais → incoming
    // (subconta que acabou de sincronizar é a fonte do contato).
    if (incomingReal) {
      const clean = incoming.includes("_") ? incoming.split("_")[0] : incoming;
      if (phonesClaimedInBatch.has(clean)) {
        patch.phone_whatsapp = `${clean}_${code}`;
      } else {
        const holder = cleanPhoneHolder.get(clean);
        const holderIsOther = !!holder && holder.id !== existing.id;
        const holderIsShadow = holderIsOther && (
          holder!.do_not_contact === true ||
          !holder!.igreen_code ||
          holder!.customer_origin !== "igreen_sync"
        );
        if (holderIsShadow) {
          // Sombra/lead bloqueado segura o limpo → carteira fica com o limpo.
          holderDemotions.push({
            id: holder!.id,
            phone_whatsapp: `${clean}_${holder!.igreen_code || "sombra"}`,
          });
          cleanPhoneHolder.delete(clean);
          phonesClaimedInBatch.add(clean);
          patch.phone_whatsapp = clean;
        } else if (holderIsOther) {
          // Outro cliente de carteira VIVO com o mesmo número → mantém sufixo.
          patch.phone_whatsapp = `${clean}_${code}`;
        } else {
          phonesClaimedInBatch.add(clean);
          patch.phone_whatsapp = clean;
        }
      }
      patch.whatsapp_chat_id = clean;
    } else if (currentReal) {
      patch.phone_whatsapp = current;
    }
    toUpdateById.push({
      id: existing.id,
      patch,
      wasPlaceholder: !currentReal && incomingReal,
    });
  }

  // Rebaixa sombras ANTES dos updates por id (libera o unique
  // consultant_id+phone_whatsapp para a carteira ficar com o número limpo).
  // CAS no phone: só rebaixa se a linha ainda segura o limpo deste batch.
  for (const d of holderDemotions) {
    const { error } = await supabase
      .from("customers")
      .update({ phone_whatsapp: d.phone_whatsapp })
      .eq("id", d.id)
      .eq("phone_whatsapp", d.phone_whatsapp.split("_")[0]);
    if (error) {
      console.warn(`[persistCustomers] demote sombra ${d.id} → ${d.phone_whatsapp} falhou: ${error.message}`);
    } else {
      console.log(`[persistCustomers] sombra ${d.id} rebaixada → ${d.phone_whatsapp} (limpo promovido p/ carteira)`);
    }
  }

  for (let i = 0; i < toUpdateById.length; i += 25) {
    const chunk = toUpdateById.slice(i, i + 25);
    await Promise.all(chunk.map(async ({ id, patch, wasPlaceholder }) => {
      const phoneWanted = String(patch.phone_whatsapp || "");
      let { error } = await supabase.from("customers").update(patch).eq("id", id);
      if (error && phoneWanted && !phoneWanted.startsWith("sem_celular_")) {
        const { phone_whatsapp: _drop, ...noPhone } = patch;
        const retry = await supabase.from("customers").update(noPhone).eq("id", id);
        error = retry.error;
        if (!error) {
          const phoneOnly = await supabase
            .from("customers")
            .update({
              phone_whatsapp: phoneWanted,
              ...(patch.igreen_account_id ? { igreen_account_id: patch.igreen_account_id } : {}),
              ...(patch.status && patch.status !== "contato_incompleto" ? { status: patch.status } : {}),
            })
            .eq("id", id)
            .like("phone_whatsapp", "sem_celular_%");
          if (phoneOnly.error) {
            console.warn(`[persistCustomers] phone upgrade bloqueado id=${id}: ${phoneOnly.error.message}`);
          } else if (wasPlaceholder) {
            upgradedFromPlaceholder++;
          }
        }
      } else if (!error) {
        updatedByCode++;
        if (wasPlaceholder) upgradedFromPlaceholder++;
      }
      if (error) {
        errorCount++;
        if (failedSamples.length < 10) {
          failedSamples.push({
            name: patch.name,
            phone_whatsapp: patch.phone_whatsapp,
            igreen_code: patch.igreen_code,
            error: error.message,
            path: "update_by_code",
          });
        }
      } else {
        updatedCount++;
      }
    }));
  }

  const BATCH_SIZE = 100;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
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
          // Fallback: unique igreen_code — promove a linha existente.
          const code = String(rec.igreen_code || "");
          if (code && consultantId && /igreen_code|unique/i.test(rowError.message)) {
            const { error: upErr } = await supabase
              .from("customers")
              .update(rec)
              .eq("consultant_id", consultantId)
              .eq("igreen_code", code)
              .eq("customer_origin", "igreen_sync");
            if (!upErr) {
              updatedCount++;
              updatedByCode++;
              continue;
            }
          }
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

  if (upgradedFromPlaceholder > 0) {
    console.log(`[persistCustomers] ${upgradedFromPlaceholder} placeholders promovidos a telefone real (multi-conta)`);
  }

  // Cleanup de resíduo: leads que viraram carteira
  let cleanedInsights = 0;
  let cleanedDeals = 0;
  let completedSteps = 0;
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
    // Fecha o step do bot nos que já passaram do funil (evita badge 26/28 no chat).
    if (flipCompleteStepIds.length > 0) {
      for (let i = 0; i < flipCompleteStepIds.length; i += 100) {
        const idChunk = flipCompleteStepIds.slice(i, i + 100);
        const { error: stepErr, count: stepCount } = await supabase
          .from("customers")
          .update({
            conversation_step: "complete",
            pos_venda_recadastro_at: null,
          }, { count: "exact" })
          .in("id", idChunk)
          .neq("conversation_step", "complete");
        if (stepErr) console.error(`conversation_step complete error at ${i}:`, stepErr);
        else completedSteps += stepCount || 0;
      }
    }
    if (cleanedInsights > 0 || cleanedDeals > 0 || completedSteps > 0) {
      console.log(`🧹 Cleanup leads→carteira: ${cleanedInsights} insights, ${cleanedDeals} deals removidos, ${completedSteps} steps→complete (flips=${flippingToWalletIds.length})`);
    }
  }

  // Leads sombra no número limpo (carteira com sufixo _codigo): pausa+DNC.
  let absorbedShadows = 0;
  if (consultantId && cleanPhones.length > 0) {
    try {
      const { absorbLeadShadowsForWalletPhones } = await import(
        "../_shared/inbound-customer-resolve.ts"
      );
      const abs = await absorbLeadShadowsForWalletPhones(supabase, consultantId, cleanPhones);
      absorbedShadows = abs.absorbed;
      if (absorbedShadows > 0) {
        console.log(`[persistCustomers] absorbed ${absorbedShadows} lead shadows (wallet phone collision)`);
      }
    } catch (e) {
      console.warn("[persistCustomers] absorb shadows:", e instanceof Error ? e.message : String(e));
    }
  }

  console.log(
    `[sync-igreen-customers] upsert done consultant=${consultantId} total_from_portal=${allCustomers.length} processed=${records.length} updated=${updatedCount} by_code=${updatedByCode} phone_upgrades=${upgradedFromPlaceholder} insert=${toInsert.length} errors=${errorCount} skipped_no_phone=${skippedNoPhone}`,
  );

  return {
    total_from_portal: allCustomers.length,
    processed: records.length,
    skipped_no_phone: skippedNoPhone,
    updated: updatedCount,
    updated_by_code: updatedByCode,
    phone_upgrades_from_placeholder: upgradedFromPlaceholder,
    inserted_or_upserted: toInsert.length,
    errors: errorCount,
    failed_samples: failedSamples,
    cleaned_insights: cleanedInsights,
    cleaned_deals: cleanedDeals,
    completed_steps: completedSteps,
    flipped_to_wallet: flippingToWalletIds.length,
    absorbed_lead_shadows: absorbedShadows,
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
    /** Sync de uma subconta só (UI: botão por card). */
    let onlyAccountId: string | null = null;
    /** Continuação automática do enrich do clique anterior (self-invoke). */
    let enrichChain: EnrichChainState | null = null;

    try {
      const body = await req.json();
      if (body.portal_email) { portalEmail = body.portal_email; credsFromBody = true; }
      if (body.portal_password) { portalPassword = body.portal_password; credsFromBody = true; }
      if (body.consultant_id) consultantId = body.consultant_id;
      if (body.mode) mode = body.mode;
      if (body.source) source = body.source;
      if (body.account_id) onlyAccountId = String(body.account_id);
      else if (body.igreen_account_id) onlyAccountId = String(body.igreen_account_id);
      if (body.enrich_hop != null) {
        enrichChain = {
          hop: Number(body.enrich_hop) || 0,
          prevRemaining: body.enrich_prev_remaining != null ? Number(body.enrich_prev_remaining) : null,
        };
      }
    } catch (_) { /* sem body */ }



    const worker = await resolveSyncWorker(supabase);
    if (!worker) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Worker de sync iGreen não configurado. Oficial: ${IGREEN_SYNC_WORKER_OFFICIAL_URL} (settings.igreen_sync_worker_url).`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }


    if (source === "cron" || source === "bulk_manual") {
      // Evomi/proxy residencial: sync automático gasta crédito. Só UI/manual.
      const { data: manualRows } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "igreen_sync_manual_only")
        .maybeSingle();
      const manualOnly = String(manualRows?.value ?? "true").toLowerCase() !== "false";
      if (manualOnly && source === "cron") {
        console.log("[sync-igreen] cron bloqueado (igreen_sync_manual_only=true — Evomi só no clique)");
        return new Response(
          JSON.stringify({
            success: false,
            reason: "manual_only",
            error: "Sync iGreen só manual (clique). Cron desligado para não gastar proxy residencial.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

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
    // MANUAL MODE: single consultant (opcional: uma subconta só)
    // ========================================================
    if (consultantId && onlyAccountId && !credsFromBody) {
      const { data: acc } = await supabase
        .from("igreen_portal_accounts")
        .select("id, portal_email, portal_password")
        .eq("id", onlyAccountId)
        .eq("consultant_id", consultantId)
        .maybeSingle();
      if (!acc?.portal_email || !acc?.portal_password) {
        return new Response(
          JSON.stringify({ success: false, error: "Conta iGreen não encontrada ou sem e-mail/senha salvos." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      portalEmail = acc.portal_email;
      portalPassword = acc.portal_password;
    } else if (consultantId && !credsFromBody) {
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
      const r = await syncOneConsultant(
        supabase, worker, portalEmail!, portalPassword!, consultantId, mode,
        onlyAccountId || null,
      );
      if (onlyAccountId) r.account_id = onlyAccountId;
      await logSyncFinish(supabase, runId, consultantId, r, onlyAccountId);
      return new Response(JSON.stringify(r), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Modo operacional curto: grava clientes inline e só responde quando terminou.
    // sync_all padrão fica no bloco de background abaixo para evitar cancelamento
    // do cliente HTTP; dentro do background ele executa Fase A antes dos extras.
    if (mode === "sync_now" || mode === "sync_customers_now") {
      const runId = await logSyncStart(supabase, consultantId, mode);
      const r = await syncOneConsultant(
        supabase, worker, portalEmail!, portalPassword!, consultantId, "sync",
        onlyAccountId || null,
      );
      if (onlyAccountId) r.account_id = onlyAccountId;
      await logSyncFinish(supabase, runId, consultantId, r, onlyAccountId);
      return new Response(JSON.stringify(r), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Executa em background e responde imediato (evita IDLE_TIMEOUT de 150s).
    const accountFilter = onlyAccountId;
    const runOne = async () => {
      // Salto encadeado não abre run próprio: a UI observa o run mais recente
      // do consultor e um run novo a cada salto faria o poll encerrar cedo.
      const runId = enrichChain ? null : await logSyncStart(supabase, consultantId, mode);
      let r: Record<string, unknown> = { success: false, error: "unknown" };
      try {
        // MULTI-CONTA: quando há consultant_id e não veio credencial explícita
        // no body (fluxo normal do botão/cron), percorre TODAS as contas
        // iGreen do consultor em ordem (1, 2, 3...). Com account_id no body,
        // sincroniza só aquela conta.
        r = (consultantId && !credsFromBody)
          ? await syncAllAccountsForConsultant(
            supabase, worker, consultantId, mode, portalEmail, portalPassword, accountFilter, runId,
          )
          : await syncOneConsultant(
            supabase, worker, portalEmail!, portalPassword!, consultantId, mode, accountFilter, runId,
            accountFilter ? [accountFilter] : null, enrichChain,
          );
        if (accountFilter) r.account_id = accountFilter;
        console.log(`[bg] sync single done:`, JSON.stringify(r).slice(0, 300));
      } catch (err) {
        r = { success: false, error: err instanceof Error ? err.message : String(err) };
        if (accountFilter) r.account_id = accountFilter;
        console.error(`[bg] sync single error:`, err);
      } finally {
        await logSyncFinish(supabase, runId, consultantId, r, accountFilter);
      }
    };
    // @ts-ignore EdgeRuntime existe no Supabase edge runtime
    try { EdgeRuntime.waitUntil(runOne()); } catch { runOne(); }

    return new Response(JSON.stringify({
      success: true,
      background: true,
      mode,
      consultant_id: consultantId,
      account_id: onlyAccountId || null,
      message: onlyAccountId
        ? "Sincronização desta conta iniciada em segundo plano."
        : "Sincronização iniciada em segundo plano. Os dados serão atualizados em instantes.",
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
