/**
 * Alertas operacionais para o super-admin (WhatsApp via Whapi).
 * Cron ~15min. Detecta falhas reais e avisa — você não precisa lembrar de perguntar.
 *
 * Checks:
 *  1) Kill switch (bot_global) desligado
 *  2) Cadência global desligada
 *  3) Workers Easy Panel (Portal2 / Sync / Club se URL existir) /health
 *  4) Velip: erros de crédito/saldo + pico BK_PROCON
 *  5) SMS: pico UNDELIV/REJECTD/EXPIRED
 *  6) Portal: muitos leads em worker_offline
 *  7) Caps outreach no limite (automation_skip_log)
 *  8) Whapi health (AUTH) — NÃO alerta Evolution needs_reconnect
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

async function pingHealth(url: string, timeoutMs = 8_000): Promise<{ ok: boolean; detail: string }> {
  const base = url.replace(/\/+$/, "");
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`${base}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
    return { ok: true, detail: "ok" };
  } catch (e) {
    return { ok: false, detail: (e as Error).message || "fetch_failed" };
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
        "Quando algo crítico falhar (Velip, worker, bot global, Whapi, MinIO, SMS undeliv…), " +
        "eu te aviso neste WhatsApp automaticamente.\n\n" +
        "_Não precisa lembrar de perguntar._",
    });
    results.push({ key: "smoke_test", fired: status === "sent", detail: status });
    if (status === "sent") notified++;
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
      "🚨 *Bot global DESLIGADO*\n\n" +
        "Nenhum envio automático (cadência/reheat) vai sair.\n" +
        "Se não foi você: SuperAdmin → Bot Global → religar.",
      120,
    );
  } else {
    results.push({ key: "bot_global_off", fired: false, detail: "ok_on" });
  }

  if (app && (app as { cadence_engine_enabled?: boolean }).cadence_engine_enabled === false) {
    await fire(
      "cadence_engine_off",
      "warn",
      "⚠️ *Motor de cadência desligado*\n\n" +
        "`cadence_engine_enabled=false` — pizza A/B/C parada.\n" +
        "Confira Configurações / toggles se não foi intencional.",
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
  ]);

  const workers: Array<{ key: string; label: string; url: string }> = [];
  if (settings.portal2_worker_url) {
    workers.push({ key: "worker:portal2", label: "Portal 2 (cadastro)", url: settings.portal2_worker_url });
  }
  if (settings.igreen_sync_worker_url) {
    workers.push({ key: "worker:sync", label: "Sync carteira", url: settings.igreen_sync_worker_url });
  }
  const clubUrl =
    settings.club_worker_url ||
    Deno.env.get("CLUB_WORKER_URL") ||
    Deno.env.get("WORKER_CLUB_URL") ||
    "";
  if (clubUrl) {
    workers.push({ key: "worker:club", label: "Club", url: clubUrl });
  }

  const workerHealth = await Promise.all(
    workers.map(async (w) => ({ w, h: await pingHealth(w.url) })),
  );
  for (const { w, h } of workerHealth) {
    if (!h.ok) {
      await fire(
        w.key,
        "critical",
        `🚨 *Worker offline: ${w.label}*\n\n` +
          `URL: ${w.url}\n` +
          `Detalhe: ${h.detail}\n\n` +
          `Abra o Easy Panel → rebuild / logs do worker.\n` +
          `Cadastros/sync podem estar parados.`,
        45,
      );
    } else {
      results.push({ key: w.key, fired: false, detail: "healthy" });
    }
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
      `🚨 *Velip: possível crédito/saldo zerado*\n\n` +
        `${creditHits} falha(s) suspeita(s) nas últimas 6h (voz/SMS).\n\n` +
        `A API Velip *não* mostra saldo aqui — abra o *painel Velip*, recarregue crédito e teste 1 SMS.`,
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
      `⚠️ *Velip: pico Procon (#250)*\n\n` +
        `${proconCount} ligações com BK_PROCON nas últimas 24h.\n` +
        `Isso *não* é falta de crédito — números em lista Não Perturbe.\n` +
        `O sistema já marca DNC; só confira se a base está suja.`,
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
      `⚠️ *SMS com muita falha de entrega*\n\n` +
        `Últimas 6h: ${undeliv} UNDELIV/REJECTD/EXPIRED vs ${delivrd} DELIVRD (total ${totalSms}).\n\n` +
        `Pode ser anti-spam da operadora, base suja ou crédito Velip.\n` +
        `Confira painel Velip + \`voice_sms_log\`.`,
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
      `🚨 *Leads parados em worker offline*\n\n` +
        `${offlineLeads} lead(s) com status \`worker_offline\` (24h).\n` +
        `Cadastro iGreen não está saindo — confira Easy Panel Portal 2.`,
      60,
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
      `⚠️ *Cap de outreach batendo*\n\n` +
        `${capN} skips de cap nas últimas 6h (B/C/global).\n` +
        `Envios foram *adiados* (não descartados). Se precisar: subir \`cap_b\`/\`cap_c\`/\`cap_global_outreach\`.`,
      180,
    );
  } else {
    results.push({ key: "outreach_cap_hot", fired: false, detail: `n=${capN}` });
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
        await fire(
          "whapi_down",
          "critical",
          `🚨 *WhatsApp (Whapi) sem AUTH*\n\n` +
            `Perfil Whapi falhou (HTTP ${profile.status}).\n` +
            `Health HTTP ${r.status}.\n\n` +
            `Envios e alertas podem falhar — reconecte no painel Whapi.`,
          45,
        );
      } else {
        results.push({
          key: "whapi_down",
          fired: false,
          detail: `profile_ok health=${r.status} code=${body?.code ?? "?"}`,
        });
      }
    } catch (e) {
      await fire(
        "whapi_down",
        "critical",
        `🚨 *WhatsApp (Whapi) inacessível*\n\n${(e as Error).message}`,
        45,
      );
    }
  } else {
    results.push({ key: "whapi_down", fired: false, detail: "token_missing_skip" });
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
