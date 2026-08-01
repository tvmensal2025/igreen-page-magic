/**
 * Alertas operacionais para o super-admin (WhatsApp via Whapi).
 * Cron ~15min. Detecta falhas reais e avisa — você não precisa lembrar de perguntar.
 *
 * Regras de produto:
 *  - Portal 1 morto: NÃO checar / NÃO mencionar.
 *  - OK do dia: no máximo 1 mensagem/dia, português claro + emoji (sem meta “não vou spam”).
 *  - Fora do ar: 3 checagens com backoff; texto curto com emoji; recovery quando voltar.
 *
 * Checks:
 *  1) Kill switch (bot_global) desligado
 *  2) Cadência global desligada
 *  3) Workers Easy Panel (Portal 2 / Sync / Club se URL existir) /health
 *  4) Velip: erros de crédito/saldo + pico BK_PROCON
 *  5) SMS: pico UNDELIV/REJECTD/EXPIRED
 *  6) Portal 2: muitos leads em worker_offline
 *  7) Caps outreach no limite (automation_skip_log)
 *  7b) Falhas de envio 24h: identity_missing + send_failed (teto configurável)
 *  7c) iGreen Fone: carteiras zeradas / dívida (digest diário com nome)
 *  8) Whapi health (AUTH) — NÃO alerta Evolution needs_reconnect
 *  9) Resumo diário “tudo ok” (1×/24h)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import { notifySuperAdminOpsAlert } from "../_shared/superadmin-alert.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-secret, x-internal-secret",
};

type CheckResult = { key: string; fired: boolean; detail?: string };

type HealthPing = {
  ok: boolean;
  detail: string;
  /** Corpo JSON do /health quando parseável. */
  body?: Record<string, unknown> | null;
};

function humanizeHealthDetail(raw: string): string {
  const msg = String(raw || "").trim();
  if (!msg) return "sem resposta";
  if (/abort|timeout|tempo esgotado|timed?\s*out/i.test(msg)) {
    return "⏱️ rede lenta / tempo esgotado";
  }
  if (/dns|resolve|servfail|nxdomain|getaddrinfo|name.?not.?resolved/i.test(msg)) {
    return "🌐 DNS do Easy Panel falhou";
  }
  if (/client error \(conn|connection|econn|enotfound|network/i.test(msg)) {
    return "🔌 conexão recusada / instável";
  }
  if (/HTTP\s*5\d\d/i.test(msg)) return `💥 ${msg}`;
  // Evita dump técnico longo no Zap
  const short = msg.replace(/\s+/g, " ").slice(0, 120);
  return short;
}

async function pingHealthOnce(url: string, timeoutMs = 18_000): Promise<HealthPing> {
  const base = url.replace(/\/+$/, "");
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`${base}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    let body: Record<string, unknown> | null = null;
    try {
      body = (await r.json()) as Record<string, unknown>;
    } catch {
      body = null;
    }
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}`, body };
    if (body && body.ok === false) {
      return { ok: false, detail: "health.ok=false", body };
    }
    return { ok: true, detail: "ok", body };
  } catch (e) {
    const msg = (e as Error).message || "fetch_failed";
    // Abort transitório ≠ “worker morto” — rotula de forma humana.
    if (/abort/i.test(msg)) return { ok: false, detail: "tempo esgotado (rede lenta)", body: null };
    return { ok: false, detail: msg, body: null };
  }
}

/**
 * Confirma queda real: até 3 tentativas com backoff (DNS/blip Easy Panel).
 * Só marca fora se TODAS falharem.
 */
async function pingHealth(url: string, timeoutMs = 18_000): Promise<HealthPing> {
  const delaysMs = [0, 3_000, 6_000];
  let last: HealthPing = { ok: false, detail: "sem tentativa", body: null };
  for (const delay of delaysMs) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    last = await pingHealthOnce(url, timeoutMs);
    if (last.ok) return last;
  }
  return { ...last, detail: humanizeHealthDetail(last.detail) };
}

function brNowLabel(): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "long",
      day: "2-digit",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString();
  }
}

async function loadSettingMap(
  supabase: ReturnType<typeof createClient>,
  keys: string[],
): Promise<Record<string, string>> {
  const { data } = await supabase.from("settings").select("key, value").in("key", keys);
  const out: Record<string, string> = {};
  for (const row of (data as { key: string; value: string | null }[] | null) || []) {
    if (row.key) out[row.key] = String(row.value || "").trim();
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const cronAuth = await assertCronAuth(req, supabase);
  if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, corsHeaders);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const results: CheckResult[] = [];
  let notified = 0;

  // Smoke opcional: manda 1 WA de confirmação (dedup 24h).
  if (body.smoke_alert === true || body.test_alert === true) {
    const status = await notifySuperAdminOpsAlert(supabase, {
      key: "smoke_test",
      severity: "warn",
      dedupMinutes: 24 * 60,
      text:
        "✅ *Alertas operacionais ligados*\n\n" +
        "📡 Canal pronto.\n" +
        "🔔 Aviso automático se cair: Club, Portal 2, Sync, Velip, Whapi…",
    });
    results.push({ key: "smoke_test", fired: status === "sent", detail: status });
    if (status === "sent") notified++;
  }

  /** Se caiu nas últimas 6h e agora voltou → avisa recuperação (bonito). */
  async function maybeNotifyRecovery(workerKey: string, label: string) {
    const since6h = new Date(Date.now() - 6 * 60 * 60_000).toISOString();
    const { data: recentDown } = await supabase
      .from("infra_metrics")
      .select("id, created_at")
      .eq("metric_key", "ops_alert")
      .gte("created_at", since6h)
      .contains("meta", { key: workerKey, severity: "critical" })
      .order("created_at", { ascending: false })
      .limit(1);
    if (!recentDown || recentDown.length === 0) return;

    const downAt = String((recentDown[0] as { created_at?: string }).created_at || "");
    const { data: alreadyRecovered } = await supabase
      .from("infra_metrics")
      .select("id")
      .eq("metric_key", "ops_alert")
      .gte("created_at", downAt || since6h)
      .contains("meta", { key: `${workerKey}:recovered` })
      .limit(1);
    if (alreadyRecovered && alreadyRecovered.length > 0) return;

    await fire(
      `${workerKey}:recovered`,
      "warn",
      `🟢 *${label} voltou*\n\n` +
        `✨ Serviço respondendo de novo.\n` +
        `🕐 ${brNowLabel()}`,
      6 * 60,
    );
  }

  const fire = async (
    key: string,
    severity: "warn" | "critical",
    text: string,
    dedupMinutes = 60,
  ) => {
    const status = await notifySuperAdminOpsAlert(supabase, {
      key,
      severity,
      text,
      dedupMinutes,
    });
    const fired = status === "sent";
    if (fired) notified++;
    results.push({ key, fired, detail: status });
  };

  // ── 1–2) Kill / cadência ──────────────────────────────────────────
  const { data: app } = await supabase
    .from("app_settings")
    .select("bot_global_enabled, cadence_engine_enabled")
    .eq("id", "global")
    .maybeSingle();

  if (app && (app as { bot_global_enabled?: boolean }).bot_global_enabled === false) {
    await fire(
      "bot_global_off",
      "critical",
      "🛑 *Bot global DESLIGADO*\n\n" +
        "🚫 Nenhum envio automático (cadência / reheat).\n" +
        "👉 SuperAdmin → Bot Global → religar",
      120,
    );
  } else {
    results.push({ key: "bot_global_off", fired: false, detail: "ok_on" });
  }

  if (app && (app as { cadence_engine_enabled?: boolean }).cadence_engine_enabled === false) {
    await fire(
      "cadence_engine_off",
      "warn",
      "⏸️ *Motor de cadência desligado*\n\n" +
        "🍕 Pizza A/B/C parada.\n" +
        "👉 Confira Configurações / toggles",
      180,
    );
  } else {
    results.push({ key: "cadence_engine_off", fired: false, detail: "ok_on" });
  }

  // ── 3) Workers Easy Panel ─────────────────────────────────────────
  const settings = await loadSettingMap(supabase, [
    "portal2_worker_url",
    "igreen_sync_worker_url",
    "club_worker_url",
    "whapi_token",
    "whapi_api_url",
    "alert_identity_missing_24h",
    "alert_send_failed_24h",
  ]);

  const workers: Array<{ key: string; label: string; url: string }> = [];
  // Portal 1 morto — nunca checar portal_worker_url legado.
  if (settings.portal2_worker_url) {
    workers.push({ key: "worker:portal2", label: "Cadastro (Portal 2)", url: settings.portal2_worker_url });
  }
  if (settings.igreen_sync_worker_url) {
    workers.push({ key: "worker:sync", label: "Sync da carteira", url: settings.igreen_sync_worker_url });
  }
  const clubUrl =
    settings.club_worker_url ||
    Deno.env.get("CLUB_WORKER_URL") ||
    Deno.env.get("WORKER_CLUB_URL") ||
    "";
  if (clubUrl) {
    workers.push({ key: "worker:club", label: "Club", url: clubUrl });
  }

  const digestLines: string[] = [];
  let anyWorkerDown = false;

  const workerHealth = await Promise.all(
    workers.map(async (w) => ({ w, h: await pingHealth(w.url) })),
  );
  for (const { w, h } of workerHealth) {
    if (!h.ok) {
      anyWorkerDown = true;
      const emoji =
        w.key === "worker:club" ? "🏷️" : w.key === "worker:sync" ? "🔄" : "📝";
      await fire(
        w.key,
        "critical",
        `${emoji} *${w.label} fora do ar*\n\n` +
          `❌ Sem resposta após 3 checagens.\n` +
          `🔎 ${humanizeHealthDetail(h.detail)}\n\n` +
          `🛠️ Easy Panel → *${w.label}* → Start / Rebuild`,
        90,
      );
      digestLines.push(`• ${w.label} — ❌ fora`);
      continue;
    }

    await maybeNotifyRecovery(w.key, w.label);

    if (w.key === "worker:sync" && h.body) {
      const audit = h.body.ai_audit as { healthy?: boolean; last_error?: string; enabled?: boolean } | undefined;
      if (audit?.enabled && audit.healthy === false) {
        await fire(
          "worker:sync:ai_audit",
          "warn",
          `🤖 *Sync — auditoria IA indisponível*\n\n` +
            `⚠️ ${audit.last_error || "Checagem de IA falhou."}\n` +
            `✅ A sync em si pode continuar.`,
          180,
        );
      } else {
        results.push({ key: "worker:sync:ai_audit", fired: false, detail: "ok_or_off" });
      }
    }

    // Portal 2: HTTP 200 mas Redis caiu → queue ≠ redis-bullmq (problema real).
    if (w.key === "worker:portal2" && h.body) {
      const queueMode = String(h.body.queue || "");
      if (queueMode && queueMode !== "redis-bullmq") {
        anyWorkerDown = true;
        await fire(
          "worker:portal2:redis",
          "critical",
          `📝 *Cadastro (Portal 2) — fila Redis fora*\n\n` +
            `⚠️ Worker no ar, mas fila em \`${queueMode}\` (esperado: Redis).\n` +
            `🐢 Cadastros podem travar.\n\n` +
            `🛠️ Easy Panel → Redis do Portal 2 → Start / Rebuild`,
          90,
        );
        digestLines.push(`• Cadastro (Portal 2) — ⚠️ Redis/fila`);
      } else {
        results.push({ key: "worker:portal2:redis", fired: false, detail: queueMode || "ok" });
        digestLines.push(`• Cadastro (Portal 2) — ✅ no ar`);
      }

      const audit = h.body.ai_audit as { healthy?: boolean; last_error?: string } | undefined;
      if (audit && audit.healthy === false) {
        await fire(
          "worker:portal2:ai_audit",
          "warn",
          `🤖 *Cadastro — auditoria IA indisponível*\n\n` +
            `⚠️ ${audit.last_error || "healthy=false"}\n` +
            `✅ Cadastro segue; só a análise Gemini falhou.`,
          180,
        );
      } else {
        results.push({ key: "worker:portal2:ai_audit", fired: false, detail: "ok" });
      }
    } else if (w.key === "worker:portal2") {
      digestLines.push(`• Cadastro (Portal 2) — ✅ no ar`);
    }

    // Club: queue=sync com health OK e allow_live_post é modo válido (não assusta).
    if (w.key === "worker:club" && h.body) {
      const queueMode = String(h.body.queue || "");
      const allowLive = h.body.allow_live_post === true;
      if (queueMode && queueMode !== "redis-bullmq" && !allowLive) {
        await fire(
          "worker:club:redis",
          "warn",
          `🏷️ *Club — fila sem Redis e sem envio ao vivo*\n\n` +
            `⚙️ Modo: \`${queueMode}\`\n` +
            `🛠️ Easy Panel → Redis do Club → Start / Rebuild`,
          180,
        );
        digestLines.push(`• Club — ⚠️ fila`);
      } else {
        results.push({
          key: "worker:club:redis",
          fired: false,
          detail: `${queueMode || "ok"}${allowLive ? "+live" : ""}`,
        });
        digestLines.push(
          queueMode === "redis-bullmq"
            ? `• Club — ✅ no ar`
            : `• Club — ✅ no ar (modo direto)`,
        );
      }
    } else if (w.key === "worker:club") {
      digestLines.push(`• Club — ✅ no ar`);
    }

    if (w.key === "worker:sync") {
      digestLines.push(`• Sync da carteira — ✅ no ar`);
    }

    results.push({ key: w.key, fired: false, detail: "healthy" });
  }

  // ── 4) Velip crédito / Procon ─────────────────────────────────────
  const since6h = new Date(Date.now() - 6 * 60 * 60_000).toISOString();
  const since24h = new Date(Date.now() - 24 * 60 * 60_000).toISOString();

  const { data: creditCalls } = await supabase
    .from("voice_call_logs")
    .select("id, error")
    .gte("created_at", since6h)
    .or(
      "error.ilike.%credit%,error.ilike.%saldo%,error.ilike.%insufficient%,error.ilike.%sem crédito%,error.ilike.%sem credito%",
    )
    .limit(50);

  const { data: creditSms } = await supabase
    .from("voice_sms_log")
    .select("id, error, balance_after, status")
    .gte("created_at", since6h)
    .or(
      "error.ilike.%credit%,error.ilike.%saldo%,error.ilike.%insufficient%,balance_after.eq.0",
    )
    .limit(50);

  const creditHits =
    ((creditCalls as unknown[] | null) || []).length +
    ((creditSms as unknown[] | null) || []).filter((r: any) => {
      const err = String(r.error || "").toLowerCase();
      if (/credit|saldo|insufficient|sem cr[eé]dito/.test(err)) return true;
      // balance_after=0 só conta se status failed (não spam em sucesso com saldo 0)
      return Number(r.balance_after) === 0 && String(r.status || "") === "failed";
    }).length;

  if (creditHits >= 2) {
    await fire(
      "velip_credit",
      "critical",
      `💳 *Velip — possível crédito zerado*\n\n` +
        `🚨 ${creditHits} falha(s) de saldo/crédito nas últimas 6h (voz/SMS).\n\n` +
        `👉 Abra o painel Velip → recarregue → teste 1 SMS`,
      90,
    );
  } else {
    results.push({ key: "velip_credit", fired: false, detail: `hits=${creditHits}` });
  }

  const { count: proconCount } = await supabase
    .from("voice_call_logs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since24h)
    .ilike("error", "%BK_PROCON%");

  if ((proconCount ?? 0) >= 5) {
    await fire(
      "velip_procon_spike",
      "warn",
      `📵 *Velip — pico Procon (#250)*\n\n` +
        `📞 ${proconCount} ligações BK_PROCON nas últimas 24h.\n` +
        `ℹ️ Não é falta de crédito — números em Não Perturbe.\n` +
        `✅ Sistema já marca bloqueio; confira se a base está suja.`,
      360,
    );
  } else {
    results.push({ key: "velip_procon_spike", fired: false, detail: `n=${proconCount ?? 0}` });
  }

  // ── 5) SMS undeliv ────────────────────────────────────────────────
  const { data: smsRows } = await supabase
    .from("voice_sms_log")
    .select("delivery_status, status")
    .gte("created_at", since6h)
    .limit(500);

  let undeliv = 0;
  let delivrd = 0;
  let totalSms = 0;
  for (const r of (smsRows as { delivery_status?: string; status?: string }[] | null) || []) {
    totalSms++;
    const st = String(r.delivery_status || r.status || "").toUpperCase();
    if (st === "DELIVRD") delivrd++;
    if (["UNDELIV", "REJECTD", "EXPIRED", "DELETED"].includes(st)) undeliv++;
  }

  if (undeliv >= 5 && (delivrd === 0 || undeliv >= delivrd)) {
    await fire(
      "sms_undeliv_spike",
      "warn",
      `📨 *SMS — muita falha de entrega*\n\n` +
        `📉 Últimas 6h: ${undeliv} falhas vs ${delivrd} entregues (total ${totalSms}).\n\n` +
        `🔎 Pode ser anti-spam, base suja ou crédito Velip.`,
      120,
    );
  } else {
    results.push({
      key: "sms_undeliv_spike",
      fired: false,
      detail: `undeliv=${undeliv} delivrd=${delivrd}`,
    });
  }

  // ── 6) Portal worker_offline stuck ────────────────────────────────
  const { count: offlineLeads } = await supabase
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("status", "worker_offline")
    .gte("updated_at", since24h);

  if ((offlineLeads ?? 0) >= 3) {
    await fire(
      "portal_worker_offline_leads",
      "critical",
      `📝 *Cadastros parados no Portal 2*\n\n` +
        `🚨 ${offlineLeads} lead(s) “worker offline” nas últimas 24h.\n` +
        `👤 Cliente finalizou, mas o envio ao iGreen não saiu.\n\n` +
        `🛠️ Easy Panel → *Cadastro (Portal 2)*`,
      90,
    );
  } else {
    results.push({
      key: "portal_worker_offline_leads",
      fired: false,
      detail: `n=${offlineLeads ?? 0}`,
    });
  }

  // ── 7) Caps no limite ─────────────────────────────────────────────
  const { data: capSkips } = await supabase
    .from("automation_skip_log")
    .select("key, meta")
    .gte("created_at", since6h)
    .or(
      "key.ilike.%outreach_cap%,key.eq.outreach_cap_b,key.eq.outreach_cap_c,key.eq.outreach_cap_global,meta->>reason.ilike.%cap%",
    )
    .limit(100);

  const capN = ((capSkips as unknown[] | null) || []).length;
  if (capN >= 20) {
    await fire(
      "outreach_cap_hot",
      "warn",
      `📊 *Cap de outreach batendo*\n\n` +
        `⏳ ${capN} skips de cap nas últimas 6h (B/C/global).\n` +
        `✅ Envios *adiados* (não descartados).\n` +
        `👉 Se precisar: subir \`cap_b\` / \`cap_c\` / \`cap_global_outreach\``,
      180,
    );
  } else {
    results.push({ key: "outreach_cap_hot", fired: false, detail: `n=${capN}` });
  }

  // ── 7b) Falhas reais de envio na cadência (24h) ───────────────────
  // Dispara quando `identity_missing:*` (consultor sem nome/telefone/chip) ou
  // falhas de envio (whapi/evolution/voz/sms) passam do teto configurado.
  // Tetos: settings.alert_identity_missing_24h / settings.alert_send_failed_24h
  {
    const identityLimit = Math.max(
      1,
      Number(settings.alert_identity_missing_24h || "") || 10,
    );
    const sendFailLimit = Math.max(
      1,
      Number(settings.alert_send_failed_24h || "") || 30,
    );

    const { data: failRows } = await supabase
      .from("cadence_action_log")
      .select("consultant_id, customer_id, channel, detail")
      .eq("status", "failed")
      .gte("created_at", since24h)
      .limit(3000);

    type FailRow = {
      consultant_id: string | null;
      customer_id?: string | null;
      channel: string | null;
      detail: Record<string, unknown> | null;
    };

    const identityByConsultant = new Map<string, number>();
    const sendFailByConsultant = new Map<string, number>();
    const identityReasons = new Map<string, number>();
    const identityCustomers = new Set<string>();
    const sendFailCustomers = new Set<string>();
    let identityTotal = 0;
    let sendFailTotal = 0;

    for (const r of (failRows as FailRow[] | null) || []) {
      const dispatch = String((r.detail as any)?.dispatch || "");
      if (!dispatch) continue;
      // Ruído de retry/advance — não conta no spike (já falhou de verdade antes).
      if (
        dispatch.includes("idempotent_replay") ||
        dispatch.startsWith("effect_failed_final") ||
        dispatch.startsWith("effect_suppressed") ||
        dispatch.startsWith("ack_max_attempts")
      ) {
        continue;
      }
      const cid = String(r.consultant_id || "system");
      const customerId = String((r as any).customer_id || "");
      if (dispatch.startsWith("identity_missing")) {
        if (customerId && identityCustomers.has(customerId)) continue;
        if (customerId) identityCustomers.add(customerId);
        identityTotal++;
        identityByConsultant.set(cid, (identityByConsultant.get(cid) || 0) + 1);
        const reason = dispatch.split(":")[1] || "?";
        identityReasons.set(reason, (identityReasons.get(reason) || 0) + 1);
      } else if (
        dispatch.startsWith("send_failed") ||
        dispatch.includes("send_returned_false") ||
        dispatch.startsWith("send_error")
      ) {
        if (customerId && sendFailCustomers.has(customerId)) continue;
        if (customerId) sendFailCustomers.add(customerId);
        sendFailTotal++;
        sendFailByConsultant.set(cid, (sendFailByConsultant.get(cid) || 0) + 1);
      }
    }

    const idsToName = [
      ...identityByConsultant.keys(),
      ...sendFailByConsultant.keys(),
    ].filter((v) => v && v !== "system");
    const nameById = new Map<string, string>();
    if (idsToName.length > 0) {
      const { data: cons } = await supabase
        .from("consultants")
        .select("id, name, display_name")
        .in("id", Array.from(new Set(idsToName)));
      for (const c of (cons as { id: string; name?: string; display_name?: string }[] | null) || []) {
        nameById.set(c.id, String(c.display_name || c.name || c.id).trim());
      }
    }

    const topLines = (m: Map<string, number>, max = 4) =>
      Array.from(m.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, max)
        .map(([cid, n]) => `• ${nameById.get(cid) || (cid === "system" ? "sem consultor" : cid)} — ${n}`)
        .join("\n");

    if (identityTotal >= identityLimit) {
      const reasons = Array.from(identityReasons.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k}=${n}`)
        .join(", ");
      await fire(
        "cadence_identity_missing_spike",
        "critical",
        `🪪 *Leads travados — consultor sem identidade*\n\n` +
          `🚨 ${identityTotal} envio(s) falharam em 24h (limite ${identityLimit}).\n` +
          `🔎 Faltando: ${reasons || "?"}\n\n` +
          `${topLines(identityByConsultant)}\n\n` +
          `👉 Corrija telefone + chip WhatsApp do consultor`,
        180,
      );
    } else {
      results.push({
        key: "cadence_identity_missing_spike",
        fired: false,
        detail: `n=${identityTotal} limite=${identityLimit}`,
      });
    }

    if (sendFailTotal >= sendFailLimit) {
      await fire(
        "cadence_send_failed_spike",
        "critical",
        `📤 *Muitas falhas de envio na cadência*\n\n` +
          `🚨 ${sendFailTotal} falha(s) em 24h (limite ${sendFailLimit}).\n\n` +
          `${topLines(sendFailByConsultant)}\n\n` +
          `🔎 Costuma ser chip caído ou token do canal.`,
        180,
      );
    } else {
      results.push({
        key: "cadence_send_failed_spike",
        fired: false,
        detail: `n=${sendFailTotal} limite=${sendFailLimit}`,
      });
    }
  }



  // ── 7c) iGreen Fone — carteiras zeradas / em dívida (aviso diário) ──
  // Complementa o aviso imediato no débito: lista quem já está sem saldo.
  {
    const { data: zeroWallets } = await supabase
      .from("consultant_wallet")
      .select("consultant_id, balance_cents, debt_cents")
      .or("balance_cents.lte.0,debt_cents.gt.0")
      .limit(40);

    const rows = (zeroWallets as Array<{
      consultant_id: string;
      balance_cents: number;
      debt_cents: number;
    }> | null) || [];

    if (rows.length > 0) {
      const ids = rows.map((w) => w.consultant_id);
      const { data: consRows } = await supabase
        .from("consultants")
        .select("id, name, display_name")
        .in("id", ids);
      const nameById = new Map<string, string>();
      for (const c of (consRows as Array<{
        id: string;
        name?: string | null;
        display_name?: string | null;
      }> | null) || []) {
        const nome = String(c.display_name || c.name || "").trim() || c.id.slice(0, 8);
        nameById.set(c.id, nome);
      }

      const lines = rows.slice(0, 15).map((w) => {
        const nome = nameById.get(w.consultant_id) || w.consultant_id.slice(0, 8);
        const bal = (Number(w.balance_cents) / 100).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        });
        const debt = Number(w.debt_cents) || 0;
        const debtPart = debt > 0
          ? ` · dívida ${(debt / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
          : "";
        return `• ${nome} — saldo ${bal}${debtPart}`;
      });
      const extra = rows.length > 15 ? `\n… e mais ${rows.length - 15}` : "";
      await fire(
        "igreen_fone_wallets_zero",
        "warn",
        `📱 *iGreen Fone — consultores sem crédito*\n\n` +
          `💸 ${rows.length} carteira(s) zerada(s) ou com dívida:\n` +
          `${lines.join("\n")}${extra}\n\n` +
          `👉 Super Admin → consultor → adicionar crédito`,
        24 * 60,
      );
    } else {
      results.push({ key: "igreen_fone_wallets_zero", fired: false, detail: "none" });
    }
  }

  // ── 8) Whapi health (AUTH) ────────────────────────────────────────
  const whapiToken = settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
  const whapiBase = (settings.whapi_api_url || "https://gate.whapi.cloud").replace(/\/+$/, "");
  if (whapiToken) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8_000);
      const r = await fetch(`${whapiBase}/health`, {
        headers: { Authorization: `Bearer ${whapiToken}` },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      let body: any = null;
      try {
        body = await r.json();
      } catch {
        body = null;
      }
      // Whapi às vezes devolve code=5 no /health mesmo AUTH — perfil é mais confiável
      const profile = await fetch(`${whapiBase}/users/profile`, {
        headers: { Authorization: `Bearer ${whapiToken}` },
      }).then((x) => ({ ok: x.ok, status: x.status })).catch(() => ({ ok: false, status: 0 }));

      if (!profile.ok) {
        anyWorkerDown = true;
        await fire(
          "whapi_down",
          "critical",
          `💬 *WhatsApp (Whapi) desconectado*\n\n` +
            `❌ Não li o perfil do canal (HTTP ${profile.status}).\n` +
            `🛠️ Reconecte no painel Whapi`,
          90,
        );
        digestLines.push(`• WhatsApp (Whapi) — ❌ fora`);
      } else {
        results.push({
          key: "whapi_down",
          fired: false,
          detail: `profile_ok health=${r.status} code=${body?.code ?? "?"}`,
        });
        digestLines.push(`• WhatsApp (Whapi) — ✅ conectado`);
      }
    } catch (e) {
      anyWorkerDown = true;
      await fire(
        "whapi_down",
        "critical",
        `💬 *WhatsApp (Whapi) inacessível*\n\n` +
          `❌ ${(e as Error).message}`,
        90,
      );
      digestLines.push(`• WhatsApp (Whapi) — ❌ fora`);
    }
  } else {
    results.push({ key: "whapi_down", fired: false, detail: "token_missing_skip" });
  }

  // ── 9) Resumo diário (1×/24h) — só se nada crítico estiver fora agora ──
  if (!anyWorkerDown && digestLines.length > 0) {
    const text =
      `☀️ *Resumo do dia — iGreen*\n` +
      `🕐 _${brNowLabel()}_\n\n` +
      `✨ Tudo certo:\n` +
      `${digestLines.join("\n")}`;
    await fire("ops_daily_ok", "warn", text, 24 * 60);
  } else if (anyWorkerDown) {
    results.push({ key: "ops_daily_ok", fired: false, detail: "skipped_while_down" });
  } else {
    results.push({ key: "ops_daily_ok", fired: false, detail: "no_workers_configured" });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      notified,
      checks: results.length,
      results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
