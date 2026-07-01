import { createClient } from "npm:@supabase/supabase-js@2.49.4";

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
  const timeout = setTimeout(() => ctrl.abort(), 180_000); // 3 min
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
  if (/cloudflare|challenge|blocked|waf|captcha|429/.test(msg)) return "waf_blocked";
  return "failed";
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
  for (const k of ["customers","boletos","telecom","seguros","devolutivas","network","metrics","cashback","details","alerts"]) {
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
  // Atualiza last_sync_* em igreen_automation_settings quando aplicável
  if (consultantId && success) {
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
}

// =====================================================
// syncOneConsultant — chama o worker e processa os dados
// =====================================================
// =====================================================
// Persistência de métricas (painel/rotinas) e boletos — Fase 2
// =====================================================
// deno-lint-ignore no-explicit-any
async function persistMetrics(supabase: any, consultantId: string | null, metrics: any): Promise<Record<string, unknown>> {
  if (!consultantId || !metrics) return { metrics_saved: false };
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
  if (error) { console.error("metrics upsert:", error.message); return { metrics_saved: false, metrics_error: error.message }; }
  return { metrics_saved: true, mes_ref: mes };
}

// deno-lint-ignore no-explicit-any
async function persistBoletos(supabase: any, consultantId: string | null, boletos: any[]): Promise<Record<string, unknown>> {
  if (!consultantId || !Array.isArray(boletos) || boletos.length === 0) return { boletos_saved: 0 };
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
  return { boletos_saved: saved, boletos_received: boletos.length };
}

// Persiste carteira TELECOM (Opção A — tabela dedicada).
// deno-lint-ignore no-explicit-any
async function persistTelecom(supabase: any, consultantId: string | null, items: any[]): Promise<Record<string, unknown>> {
  if (!consultantId || !Array.isArray(items) || items.length === 0) return { telecom_saved: 0 };
  const parseDate = (v: unknown): string | null => {
    const s = safeStr(v); if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return null;
  };
  const seen = new Set<number>();
  const rows = [];
  for (const c of items) {
    const idc = Number(c._idcnxtelecom ?? c.idcnxtelecom ?? c.id);
    if (!Number.isFinite(idc) || idc <= 0 || seen.has(idc)) continue;
    seen.add(idc);
    rows.push({
      consultant_id: consultantId,
      idcnxtelecom: idc,
      nome: safeStr(c.cliente ?? c.nome),
      cidade: safeStr(c.cidade),
      uf: safeStr(c.uf),
      numero: safeStr(c.numero),
      licenciado: safeStr(c.licenciado),
      status: safeStr(c.status_coluna),
      status_label: safeStr(c.status_label),
      data: parseDate(c.data),
      fatura_valor: safeNum(c._fatura_valor),
      fatura_status: safeStr(c._fatura_status),
      fatura_mes_referencia: safeStr(c._fatura_mes),
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
  return { telecom_saved: saved, telecom_received: items.length };
}

// Persiste CASHBACK por origem no snapshot de métricas (raw) + colunas de saldo.
// deno-lint-ignore no-explicit-any
async function persistCashback(supabase: any, consultantId: string | null, cashback: any): Promise<Record<string, unknown>> {
  if (!consultantId || !cashback || typeof cashback !== "object") return { cashback_saved: false };
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
  if (error) { console.error("cashback update:", error.message); return { cashback_saved: false }; }
  return { cashback_saved: true };
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
  if (!consultantId || !Array.isArray(items) || items.length === 0) return { seguros_saved: 0 };
  const seen = new Set<string>();
  const rows = [];
  for (const c of items) {
    const sid = safeStr(c.id ?? c.seguro_id);
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    rows.push({
      consultant_id: consultantId,
      seguro_id: sid,
      segurado: safeStr(c.segurado),
      modelo: safeStr(c.modelo),
      placa: safeStr(c.placa),
      fipe: safeNum(c.fipe),
      mensal: safeNum(c.mensal),
      status: safeStr(c.status_coluna),
      status_label: safeStr(c.status_label),
      cidade: safeStr(c.cidade),
      uf: safeStr(c.uf),
      licenciado: safeStr(c.licenciado),
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
  return { seguros_saved: saved, seguros_received: items.length };
}

// Persiste DEVOLUTIVAS detalhadas (categoria/impeditiva/campo/data).
// deno-lint-ignore no-explicit-any
async function persistDevolutivas(supabase: any, consultantId: string | null, items: any[]): Promise<Record<string, unknown>> {
  if (!consultantId || !Array.isArray(items) || items.length === 0) return { devolutivas_saved: 0 };
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

// Aplica a ficha detalhada (/clientes-green/boletos/{id}) nos customers:
// deno-lint-ignore no-explicit-any
async function applyCustomerDetails(supabase: any, consultantId: string | null, details: any[]): Promise<Record<string, unknown>> {
  if (!consultantId || !Array.isArray(details) || details.length === 0) return { details_applied: 0 };
  let applied = 0;
  for (const d of details) {
    const code = safeStr(d.idcliente);
    if (!code) continue;
    const patch: Record<string, unknown> = {};
    const cpf = safeStr(d.cpf); if (cpf) patch.cpf = cpf.replace(/\D/g, "");
    const inst = safeStr(d.instalacao); if (inst) patch.numero_instalacao = inst;
    const numCli = safeStr(d.numCliente); if (numCli) patch.num_cliente_distribuidora = numCli;
    const conc = safeStr(d.concessionaria); if (conc) { patch.concessionaria = conc; patch.distribuidora = conc; }
    const forn = safeStr(d.fornecedora); if (forn) patch.fornecedora = forn;
    const sit = safeStr(d.situacao); if (sit) patch.situacao_igreen = sit;
    if (typeof d.trocaTitularidade === "boolean") patch.transferir_titularidade = d.trocaTitularidade;
    if (typeof d.contaUnica === "boolean") patch.contaunica = d.contaUnica;
    const consumo = safeNum(d.consumo); if (consumo != null) patch.media_consumo = consumo;
    const dAtivo = safeStr(d.dataAtivo); if (dAtivo && /^\d{4}-\d{2}-\d{2}/.test(dAtivo)) patch.data_ativo_igreen = dAtivo.slice(0, 10);
    const dInj = safeStr(d.dataInjecao); if (dInj && /^\d{4}-\d{2}-\d{2}/.test(dInj)) patch.data_injecao_igreen = dInj.slice(0, 10);
    if (Object.keys(patch).length === 0) continue;
    const { error } = await supabase
      .from("customers")
      .update(patch)
      .eq("consultant_id", consultantId)
      .eq("igreen_code", code);
    if (!error) applied++;
  }
  return { details_applied: applied };
}

async function syncOneConsultant(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  worker: { url: string; secret: string },
  portalEmail: string,
  portalPassword: string,
  consultantId: string | null,
  mode: string,
): Promise<Record<string, unknown>> {
  const emailNorm = String(portalEmail || "").trim().toLowerCase();
  const passwordNorm = String(portalPassword || "");

  if (!emailNorm || !passwordNorm) {
    return { success: false, email: emailNorm, error: "Credenciais do portal iGreen não preenchidas." };
  }

  // === SYNC ALL MODE (recomendado): 1 login → tudo, respeitando os toggles ===
  if (mode === "sync_all") {
    console.log(`[worker] sync-all for ${emailNorm}`);

    // Toggles do consultor. Se não houver linha ainda, tratamos captura+alertas como
    // ligados (envio proativo ao cliente permanece off). Isso evita a "corrida"
    // entre criar o consultor e configurar toggles: sync novo já traz tudo.
    const DEFAULT_ON: Record<string, boolean> = {
      capture_boletos: true,
      capture_devolutivas: true,
      capture_telecom: true,
      capture_seguros: true,
      capture_cashback: true,
      alert_boletos_vencendo: true,
      alert_devolutivas: true,
      alert_licencas_expirando: true,
      rotinas_tarefas: true,
      auto_wa_boleto_vencendo: true,
      auto_wa_aniversariante: false,
      cross_sell_bot: true,
    };
    let toggles: Record<string, boolean> = { ...DEFAULT_ON };
    if (consultantId) {
      const { data: t } = await supabase
        .from("igreen_automation_settings")
        .select("*")
        .eq("consultant_id", consultantId)
        .maybeSingle();
      if (t) toggles = { ...DEFAULT_ON, ...(t as Record<string, boolean>) };
    }
    // Consistência captura↔alerta: se o alerta está ligado, força a captura
    // correspondente para esta rodada (não persiste na tabela).
    const autoEnabled: string[] = [];
    if (toggles.alert_boletos_vencendo && !toggles.capture_boletos) { toggles.capture_boletos = true; autoEnabled.push("capture_boletos"); }
    if (toggles.alert_devolutivas && !toggles.capture_devolutivas) { toggles.capture_devolutivas = true; autoEnabled.push("capture_devolutivas"); }
    if (autoEnabled.length) console.log(`[sync-all] auto-enabled for run: ${autoEnabled.join(",")}`);

    // Base sempre coletada; extras conforme toggle.
    const only = ["customers", "network", "metrics"];
    if (toggles.capture_boletos) only.push("boletos");
    if (toggles.capture_telecom) only.push("telecom");
    if (toggles.capture_seguros) only.push("seguros");
    if (toggles.capture_devolutivas) only.push("devolutivas");
    if (toggles.capture_cashback) only.push("cashback");

    const r = await callWorker(worker, "/sync-all", {
      portal_email: emailNorm,
      portal_password: passwordNorm,
      only,
      enrich: true,
      enrich_limit: 400,
    });
    if (!r.ok) return { success: false, email: emailNorm, error: `Worker falhou: ${r.error}`, status: r.status };

    const consultorId = r.data?.consultor_id ? String(r.data.consultor_id) : null;
    if (consultantId && consultorId) {
      await supabase.from("consultants").update({ igreen_consultor_id: consultorId }).eq("id", consultantId);
    }

    const out: Record<string, unknown> = { success: true, mode: "sync_all", email: emailNorm, toggles };
    // Base
    try { out.customers = await persistCustomers(supabase, consultantId, r.data?.customers || []); }
    catch (e) { out.customers_error = e instanceof Error ? e.message : String(e); }
    try { out.network = await persistNetwork(supabase, consultantId, r.data?.members || []); }
    catch (e) { out.network_error = e instanceof Error ? e.message : String(e); }
    out.metrics = await persistMetrics(supabase, consultantId, r.data?.metrics);
    out.details = await applyCustomerDetails(supabase, consultantId, r.data?.details || []);
    // Extras (só se o toggle correspondente estiver ligado)
    if (toggles.capture_boletos) out.boletos = await persistBoletos(supabase, consultantId, r.data?.boletos || []);
    if (toggles.capture_telecom) out.telecom = await persistTelecom(supabase, consultantId, r.data?.telecom || []);
    if (toggles.capture_seguros) out.seguros = await persistSeguros(supabase, consultantId, r.data?.seguros || []);
    if (toggles.capture_devolutivas) out.devolutivas = await persistDevolutivas(supabase, consultantId, r.data?.devolutivas || []);
    if (toggles.capture_cashback) out.cashback = await persistCashback(supabase, consultantId, r.data?.cashback || {});

    // Alertas acionáveis (só se o toggle de alerta estiver ligado)
    out.alerts = await generateAlerts(supabase, consultantId, toggles, r.data);

    const syncTimestamp = new Date().toISOString();
    await supabase.from("settings").upsert({ key: "last_igreen_sync", value: syncTimestamp }, { onConflict: "key" });
    out.synced_at = syncTimestamp;
    return out;
  }

  // === SYNC METRICS MODE ===
  if (mode === "sync_metrics") {
    console.log(`[worker] sync-metrics for ${emailNorm}`);
    const r = await callWorker(worker, "/sync-metrics", { portal_email: emailNorm, portal_password: passwordNorm });
    if (!r.ok) return { success: false, email: emailNorm, error: `Worker falhou: ${r.error}`, status: r.status };
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
    if (!r.ok) return { success: false, email: emailNorm, error: `Worker falhou: ${r.error}`, status: r.status };
    const consultorId = r.data?.consultor_id ? String(r.data.consultor_id) : null;
    const saved = await persistBoletos(supabase, consultorId ? (consultantId || null) : consultantId, r.data?.boletos || []);
    return { success: true, mode: "sync_boletos", ...saved };
  }

  // === SYNC TELECOM MODE ===
  if (mode === "sync_telecom") {
    console.log(`[worker] sync-telecom for ${emailNorm}`);
    const r = await callWorker(worker, "/sync-telecom", { portal_email: emailNorm, portal_password: passwordNorm });
    if (!r.ok) return { success: false, email: emailNorm, error: `Worker falhou: ${r.error}`, status: r.status };
    const saved = await persistTelecom(supabase, consultantId, r.data?.telecom || []);
    return { success: true, mode: "sync_telecom", ...saved };
  }

  // === SYNC SEGUROS MODE ===
  if (mode === "sync_seguros") {
    console.log(`[worker] sync-seguros for ${emailNorm}`);
    const r = await callWorker(worker, "/sync-seguros", { portal_email: emailNorm, portal_password: passwordNorm });
    if (!r.ok) return { success: false, email: emailNorm, error: `Worker falhou: ${r.error}`, status: r.status };
    const saved = await persistSeguros(supabase, consultantId, r.data?.seguros || []);
    return { success: true, mode: "sync_seguros", ...saved };
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
    return { success: false, email: emailNorm, error: `Worker falhou: ${r.error}`, status: r.status };
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
  const syncTimestamp = new Date().toISOString();
  await supabase.from("settings").upsert({ key: "last_igreen_sync", value: syncTimestamp }, { onConflict: "key" });
  return { success: true, email: emailNorm, synced_at: syncTimestamp, ...cust };
}

// deno-lint-ignore no-explicit-any
async function persistNetwork(supabase: any, consultantId: string | null, members: Record<string, unknown>[]): Promise<Record<string, unknown>> {
  // Dedup
  const deduped = new Map<number, Record<string, unknown>>();
  for (const m of members) {
    const id = Number(m.idconsultor || m.id);
    if (id) deduped.set(id, m);
  }
  const netData = Array.from(deduped.values());

  const netRecords = netData.map((m) => ({
    consultant_id: consultantId,
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

  // Remove stale members
  if (consultantId) {
    const apiIds = netRecords.map((r) => Number(r.igreen_id));
    const { data: existingMembers } = await supabase
      .from("network_members")
      .select("igreen_id")
      .eq("consultant_id", consultantId);
    if (existingMembers) {
      const staleIds = (existingMembers as Array<{ igreen_id: number }>)
        .map((m) => m.igreen_id)
        .filter((id) => !apiIds.includes(id));
      if (staleIds.length > 0) {
        await supabase
          .from("network_members")
          .delete()
          .eq("consultant_id", consultantId)
          .in("igreen_id", staleIds);
      }
    }
  }
  return { total_members: netData.length, updated: netUpdated };
}

// deno-lint-ignore no-explicit-any
async function persistCustomers(supabase: any, consultantId: string | null, allCustomers: Record<string, unknown>[]): Promise<Record<string, unknown>> {
  console.log(`Worker returned ${allCustomers.length} customers`);

  const seenPhones = new Map<string, string>();
  const records: Record<string, unknown>[] = [];
  let skippedNoPhone = 0;

  for (const c of allCustomers) {
    const record = buildRecord(c);
    if (!record || !record.phone_whatsapp) { skippedNoPhone++; continue; }
    const phone = String(record.phone_whatsapp);

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
    records.push(record);
  }

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
  const BATCH_SIZE = 100;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from("customers")
      .upsert(batch, { onConflict: "phone_whatsapp,consultant_id", ignoreDuplicates: false })
      .select("id");
    if (error) {
      console.error(`Batch upsert error at ${i}:`, error);
      errorCount += batch.length;
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

  return {
    total_from_portal: allCustomers.length,
    processed: records.length,
    skipped_no_phone: skippedNoPhone,
    updated: updatedCount,
    errors: errorCount,
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

    // ========================================================
    // CRON MODE: itera sobre todos os consultores aprovados
    // ========================================================
    if (source === "cron") {
      console.log("=== CRON MODE: Syncing ALL consultants ===");
      // No cron, por padrão puxa TUDO (clientes + rede + métricas + boletos).
      const cronMode = mode && mode !== "sync" ? mode : "sync_all";
      const { data: consultants, error: cErr } = await supabase
        .from("consultants")
        .select("id, name, igreen_portal_email, igreen_portal_password")
        .eq("approved", true);

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

      // Roda tudo em background para escapar do IDLE_TIMEOUT (150s) da Edge.
      const runAll = async () => {
        for (const c of usable) {
          console.log(`--- [bg] Syncing: ${c.name} (${c.igreen_portal_email}) ---`);
          try {
            await syncOneConsultant(
              supabase,
              worker,
              c.igreen_portal_email,
              c.igreen_portal_password,
              c.id,
              cronMode,
            );
          } catch (err) {
            console.error(`[bg] Error syncing ${c.name}:`, err);
          }
          await new Promise((r) => setTimeout(r, 3000));
        }
        console.log(`[bg] cron sync finished (${usable.length} consultants)`);
      };
      // @ts-ignore EdgeRuntime existe no Supabase edge runtime
      try { EdgeRuntime.waitUntil(runAll()); } catch { runAll(); }

      return new Response(JSON.stringify({
        success: true,
        mode: "cron_all",
        background: true,
        total_consultants: usable.length,
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

    // Executa em background e responde imediato (evita IDLE_TIMEOUT de 150s).
    const runOne = async () => {
      try {
        const r = await syncOneConsultant(
          supabase, worker, portalEmail!, portalPassword!, consultantId, mode,
        );
        console.log(`[bg] sync single done:`, JSON.stringify(r).slice(0, 300));
      } catch (err) {
        console.error(`[bg] sync single error:`, err);
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
