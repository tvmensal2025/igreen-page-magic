/**
 * Cron tick + envio do aviso "boleto chegou".
 * Toggles: áudio / texto; botão arquivo opcional; apps Android/iOS sempre.
 * Copy leigo: sem a palavra "PDF" ao cliente.
 *
 * action=tick → se hora BRT bater: dispara sync_boletos + processa fila claimed.
 * dryRun=true → não envia WA (só loga).
 */
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";
import { isPausedByPhone } from "../_shared/bot/paused.ts";
import { assertCanContact } from "../_shared/contact-suppression.ts";
import { isOutsideSendWindowBRT } from "../_shared/quiet-hours.ts";
import {
  resolveChannelForCustomerWithFailover,
  resolveConsultantOutboundChannel,
  isUnavailable,
  toJid,
  isValidJid,
  ctx,
  type ChannelEnv,
  type ResolvedChannel,
} from "../_shared/channel-sender.ts";
import { renderPersonalizedTtsAudio } from "../_shared/pos-venda-tts.ts";
import {
  BOLETO_CHEGOU_STAGE_PREFIX,
  BOLETO_RECEBER_DOC_BUTTON_ID,
  boletoAppStoreChoiceOptions,
  buildAppStoreButtonsPrompt,
  buildAppStoreNumberedMessage,
  buildBoletoButtonPrompt,
  isBoletoStatusPago,
  formatBoletoValor,
  formatBoletoVencimento,
  loadBoletoNotifyConfig,
  parseMesFromStageKey,
  buildBoletoAudioSpoken,
  loadConsultantForBoletoAudio,
  renderBoletoNotifyTemplate,
  stripBoletoButtonCta,
  shouldRunBoletoNotifyNow,
  type BoletoNotifyConfig,
} from "../_shared/boleto-notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret, x-service-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  );

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = String(body.action || "tick");

  // Teste manual (UI): JWT do consultor. Cron: assertCronAuth.
  if (action === "test_send" || action === "test_tts") {
    const user = await authConsultant(req, supabase, body.consultant_id ? String(body.consultant_id) : null);
    if (!user.ok) {
      return json({ success: false, error: user.error }, 401);
    }
    const cfg = await loadBoletoNotifyConfig(supabase);
    if (action === "test_tts") {
      const cons = await loadConsultantForBoletoAudio(supabase, user.consultantId);
      const spoken = buildBoletoAudioSpoken({
        audioBody: cfg.audio_script,
        name: String(body.name || "Maria"),
        nameSource: "manual",
        ...cons,
      });
      const audioUrl = await renderPersonalizedTtsAudio(supabase, user.consultantId, spoken);
      return json({
        success: !!audioUrl,
        spoken,
        audio_url: audioUrl,
        ola_prefix: "Olá, {Nome}! Tudo bem?",
      });
    }
    const result = await runTestSend(supabase, cfg, {
      consultantId: user.consultantId,
      phone: String(body.phone || ""),
      name: String(body.name || "Maria"),
    });
    return json(result, result.success ? 200 : 400);
  }

  const auth = await assertCronAuth(req, supabase);
  if (!auth.ok) return cronAuthUnauthorized(auth.reason, corsHeaders);

  const dryRun = body.dryRun === true || String(body.dryRun) === "true";
  const limit = Math.min(Number(body.limit) || 40, 80);

  const cfg = await loadBoletoNotifyConfig(supabase);
  const now = new Date();
  const out: Record<string, unknown> = {
    success: true,
    action,
    dryRun,
    hour_match: shouldRunBoletoNotifyNow(cfg, now),
    cron_hour_brt: cfg.cron_hour_brt,
  };

  if (action === "tick" && shouldRunBoletoNotifyNow(cfg, now) && cfg.sync_enabled) {
    out.sync_triggered = await triggerSyncBoletos();
  } else {
    out.sync_triggered = false;
  }

  if (isOutsideSendWindowBRT(now) && !dryRun) {
    out.send = { skipped: "outside_send_window" };
    return json(out);
  }

  const botOn = await isBotGloballyEnabled(supabase);
  if (!botOn && !dryRun) {
    out.send = { skipped: "bot_global_off" };
    return json(out);
  }

  out.send = await processQueue(supabase, cfg, { dryRun, limit });
  return json(out);
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function triggerSyncBoletos(): Promise<Record<string, unknown>> {
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!base || !srk) return { ok: false, error: "missing_env" };
  try {
    const resp = await fetch(`${base}/functions/v1/sync-igreen-customers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${srk}`,
        apikey: srk,
        "Content-Type": "application/json",
        "x-internal-secret": Deno.env.get("EMBED_INTERNAL_SECRET") || "",
      },
      body: JSON.stringify({
        source: "cron",
        mode: "sync_boletos",
        triggered_by: "igreen-boleto-notify",
      }),
    });
    const text = await resp.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text.slice(0, 200);
    }
    console.log(`[boleto-notify] sync_boletos → ${resp.status}`);
    return { ok: resp.ok, status: resp.status, body: parsed };
  } catch (e) {
    console.warn("[boleto-notify] sync trigger falhou:", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function loadChannelEnv(supabase: any): Promise<ChannelEnv> {
  const { data: rows } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["whapi_token", "superadmin_consultant_id"]);
  const map = new Map<string, string>();
  for (const r of (rows || []) as Array<{ key: string; value: unknown }>) {
    map.set(r.key, String(r.value ?? "").replace(/^"|"$/g, ""));
  }
  return {
    evolutionUrl: Deno.env.get("EVOLUTION_API_URL") || undefined,
    evolutionKey: Deno.env.get("EVOLUTION_API_KEY") || undefined,
    whapiToken: map.get("whapi_token") || Deno.env.get("WHAPI_TOKEN") || "",
    superadminConsultantId: map.get("superadmin_consultant_id") || null,
  };
}

async function processQueue(
  supabase: any,
  cfg: BoletoNotifyConfig,
  opts: { dryRun: boolean; limit: number },
): Promise<Record<string, unknown>> {
  const { data: rows, error } = await supabase
    .from("customer_auto_message_log")
    .select("id, customer_id, consultant_id, stage_key, status, customer_name")
    .like("stage_key", `${BOLETO_CHEGOU_STAGE_PREFIX}%`)
    .eq("status", "claimed")
    .order("created_at", { ascending: true })
    .limit(opts.limit);

  if (error) {
    console.warn("[boleto-notify] queue:", error.message);
    return { error: error.message, processed: 0 };
  }

  const env = await loadChannelEnv(supabase);
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const details: Array<Record<string, unknown>> = [];

  for (const row of (rows || []) as Array<{
    id: string;
    customer_id: string;
    consultant_id: string;
    stage_key: string;
    customer_name: string | null;
  }>) {
    const r = await sendOne(supabase, env, cfg, row, opts.dryRun);
    details.push({ customer_id: row.customer_id, ...r });
    if (r.status === "sent" || r.status === "dry_run") sent++;
    else if (String(r.status).startsWith("skipped") || r.status === "no_channel") skipped++;
    else failed++;
  }

  return { processed: (rows || []).length, sent, skipped, failed, details: details.slice(0, 20) };
}

async function sendOne(
  supabase: any,
  env: ChannelEnv,
  cfg: BoletoNotifyConfig,
  row: {
    id: string;
    customer_id: string;
    consultant_id: string;
    stage_key: string;
    customer_name: string | null;
  },
  dryRun: boolean,
): Promise<{ status: string; detail?: string }> {
  const { data: toggles } = await supabase
    .from("igreen_automation_settings")
    .select("auto_wa_boleto_chegou")
    .eq("consultant_id", row.consultant_id)
    .maybeSingle();
  if (!toggles?.auto_wa_boleto_chegou) {
    await mark(supabase, row.id, "skipped_toggle_off");
    return { status: "skipped_toggle_off" };
  }

  const { data: customer } = await supabase
    .from("customers")
    .select(
      "id, name, name_source, phone_whatsapp, whatsapp_chat_id, consultant_id, igreen_code, email, do_not_contact",
    )
    .eq("id", row.customer_id)
    .maybeSingle();

  if (!customer) {
    await mark(supabase, row.id, "skipped_no_customer");
    return { status: "skipped_no_customer" };
  }

  const phone = String(customer.phone_whatsapp || "");
  if (/^\d{10,15}_\d+$/.test(phone) || (phone.replace(/\D/g, "").length > 13 && /^\d+$/.test(phone))) {
    await mark(supabase, row.id, "skipped_duplicate_phone");
    return { status: "skipped_duplicate_phone" };
  }

  const contact = await assertCanContact(supabase, {
    customerId: customer.id,
    phone: customer.phone_whatsapp,
    consultantId: row.consultant_id,
    channel: "whatsapp",
  });
  if (!contact.allowed) {
    await mark(supabase, row.id, `skipped_${contact.reason || "dnc"}`);
    return { status: `skipped_${contact.reason || "dnc"}` };
  }

  if (await isPausedByPhone(supabase, customer.phone_whatsapp, row.consultant_id)) {
    await mark(supabase, row.id, "skipped_paused");
    return { status: "skipped_paused" };
  }

  const mes = parseMesFromStageKey(row.stage_key);
  const { data: boleto } = await supabase
    .from("igreen_customer_boletos")
    .select("url_boleto, total, vencimento, mes_referencia, status")
    .eq("customer_id", customer.id)
    .eq("mes_referencia", mes || "")
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Pagou antes do disparo (ou débito automático) → nada de aviso de boleto.
  if (isBoletoStatusPago(boleto?.status)) {
    await mark(supabase, row.id, "skipped_pago");
    return { status: "skipped_pago" };
  }

  const emailAcesso = customer.email || null;
  const vars = {
    name: customer.name,
    nameSource: customer.name_source,
    mes: mes || boleto?.mes_referencia || "—",
    valor: formatBoletoValor(boleto?.total),
    vencimento: formatBoletoVencimento(boleto?.vencimento),
    emailAcesso,
    urlBoleto: boleto?.url_boleto || "",
  };

  const waText = renderBoletoNotifyTemplate(cfg.wa_text, vars);
  const consAudio = await loadConsultantForBoletoAudio(supabase, row.consultant_id);
  const audioSpoken = buildBoletoAudioSpoken({
    audioBody: cfg.audio_script,
    name: customer.name,
    nameSource: customer.name_source,
    ...consAudio,
  });

  if (dryRun) {
    await mark(supabase, row.id, "dry_run", waText.slice(0, 240));
    return { status: "dry_run", detail: waText.slice(0, 80) };
  }

  const channel = await resolveChannelForCustomerWithFailover(
    supabase,
    customer.id,
    env,
  );
  if (isUnavailable(channel)) {
    await mark(supabase, row.id, "no_channel");
    return { status: "no_channel", detail: channel.detail };
  }

  const resolved = channel as ResolvedChannel;
  const jid = toJid(customer.whatsapp_chat_id || customer.phone_whatsapp);
  if (!isValidJid(jid)) {
    await mark(supabase, row.id, "skipped_bad_jid");
    return { status: "skipped_bad_jid" };
  }

  const sendCtxBase = ctx(row.consultant_id, customer.id, row.stage_key);
  const wantAudio = cfg.send_audio !== false;
  const wantText = cfg.send_text !== false;
  const wantBoletoBtn = cfg.button_enabled === true;

  let audioOk = !wantAudio;
  let textOk = !wantText;
  let appsOk = false;
  let buttonOk = !wantBoletoBtn;

  if (wantAudio) {
    try {
      const audioUrl = await renderPersonalizedTtsAudio(
        supabase,
        row.consultant_id,
        audioSpoken,
      );
      if (audioUrl) {
        const r = await resolved.adapter.sendMedia(
          jid,
          { kind: "audio", url: audioUrl, ptt: true },
          { ...sendCtxBase, idempotencyKey: `${sendCtxBase.idempotencyKey}:audio`, supabase },
        );
        audioOk = !!r.ok;
      }
    } catch (e) {
      console.warn("[boleto-notify] tts/audio:", e instanceof Error ? e.message : e);
    }
  }

  if (wantText) {
    try {
      const r = await resolved.adapter.sendText(
        jid,
        stripBoletoButtonCta(waText),
        { ...sendCtxBase, idempotencyKey: `${sendCtxBase.idempotencyKey}:text`, supabase },
      );
      textOk = !!r.ok;
    } catch (e) {
      console.warn("[boleto-notify] text:", e instanceof Error ? e.message : e);
    }
  }

  // Sempre: Android/iOS — Whapi = botões; Evolution = lista numerada com links.
  try {
    const canButtons = !!resolved.adapter.capabilities?.supportsButtons;
    if (canButtons) {
      const r = await resolved.adapter.sendChoice(
        jid,
        buildAppStoreButtonsPrompt(emailAcesso),
        { preferred: "button", options: boletoAppStoreChoiceOptions() },
        { ...sendCtxBase, idempotencyKey: `${sendCtxBase.idempotencyKey}:apps`, supabase },
      );
      appsOk = !!r.ok || r.reason === "downgraded";
      if (!appsOk) {
        const fb = await resolved.adapter.sendText(
          jid,
          buildAppStoreNumberedMessage(emailAcesso),
          { ...sendCtxBase, idempotencyKey: `${sendCtxBase.idempotencyKey}:apps_fb`, supabase },
        );
        appsOk = !!fb.ok;
      }
    } else {
      const r = await resolved.adapter.sendText(
        jid,
        buildAppStoreNumberedMessage(emailAcesso),
        { ...sendCtxBase, idempotencyKey: `${sendCtxBase.idempotencyKey}:apps`, supabase },
      );
      appsOk = !!r.ok;
    }
  } catch (e) {
    console.warn("[boleto-notify] apps:", e instanceof Error ? e.message : e);
  }

  if (wantBoletoBtn) {
    try {
      const r = await resolved.adapter.sendChoice(
        jid,
        buildBoletoButtonPrompt(cfg.button_boleto_label),
        {
          preferred: "button",
          options: [
            {
              id: BOLETO_RECEBER_DOC_BUTTON_ID,
              title: cfg.button_boleto_label.slice(0, 25),
            },
          ],
        },
        { ...sendCtxBase, idempotencyKey: `${sendCtxBase.idempotencyKey}:button`, supabase },
      );
      buttonOk = !!r.ok || r.reason === "downgraded";
    } catch (e) {
      console.warn("[boleto-notify] button:", e instanceof Error ? e.message : e);
    }
  }

  const coreOk = appsOk || textOk || audioOk;
  const status = !coreOk
    ? "failed"
    : (audioOk && textOk && appsOk && buttonOk)
    ? "sent"
    : "partial";

  await mark(supabase, row.id, status, waText.slice(0, 240), jid);
  return { status };
}

async function mark(
  supabase: any,
  id: string,
  status: string,
  preview?: string,
  remoteJid?: string,
) {
  const patch: Record<string, unknown> = { status };
  if (preview) patch.message_preview = preview;
  if (remoteJid) patch.remote_jid = remoteJid;
  await supabase.from("customer_auto_message_log").update(patch).eq("id", id);
}

async function authConsultant(
  req: Request,
  supabase: any,
  bodyConsultantId?: string | null,
): Promise<{ ok: true; consultantId: string } | { ok: false; error: string }> {
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return { ok: false, error: "Faça login para testar." };

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  const anon = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    anonKey || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error } = await anon.auth.getUser(jwt);
  const userId = userData?.user?.id;
  if (error || !userId) return { ok: false, error: "Sessão inválida. Atualize a página e entre de novo." };

  // Neste projeto consultants.id = auth.users.id (sem coluna user_id).
  const consultantId = bodyConsultantId && String(bodyConsultantId).trim()
    ? String(bodyConsultantId).trim()
    : userId;

  if (userId !== consultantId) {
    const { data: isAdmin } = await supabase.rpc("is_super_admin", { _user_id: userId });
    if (!isAdmin) {
      return { ok: false, error: "Sem permissão para testar neste consultor." };
    }
  }

  const { data: cons } = await supabase
    .from("consultants")
    .select("id")
    .eq("id", consultantId)
    .maybeSingle();
  if (!cons?.id) return { ok: false, error: "Consultor não encontrado." };
  return { ok: true, consultantId: String(cons.id) };
}

async function runTestSend(
  supabase: any,
  cfg: BoletoNotifyConfig,
  opts: { consultantId: string; phone: string; name: string },
): Promise<Record<string, unknown>> {
  const digits = String(opts.phone || "").replace(/\D/g, "");
  let phone = digits;
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
  if (phone.length < 12 || phone.length > 13) {
    return { success: false, error: "Telefone inválido. Use DDD + número." };
  }

  // Boleto aleatório com link disponível
  const { data: boletos } = await supabase
    .from("igreen_customer_boletos")
    .select("url_boleto, total, vencimento, mes_referencia, nome, idcliente, customer_id")
    .eq("consultant_id", opts.consultantId)
    .not("url_boleto", "is", null)
    .neq("url_boleto", "")
    .order("synced_at", { ascending: false })
    .limit(30);

  const list = (boletos || []) as Array<Record<string, unknown>>;
  if (list.length === 0) {
    return {
      success: false,
      error: "Nenhum boleto com link na carteira. Rode o sync de boletos antes.",
    };
  }
  const boleto = list[Math.floor(Math.random() * list.length)];

  const env = await loadChannelEnv(supabase);
  const channel = await resolveConsultantOutboundChannel(supabase, opts.consultantId, env);
  if (isUnavailable(channel)) {
    return { success: false, error: channel.detail || "WhatsApp do consultor indisponível." };
  }
  const resolved = channel as ResolvedChannel;
  const jid = toJid(phone);
  if (!isValidJid(jid)) {
    return { success: false, error: "Número inválido para WhatsApp." };
  }

  let emailAcesso: string | null = null;
  if (boleto.customer_id) {
    const { data: custEmail } = await supabase
      .from("customers")
      .select("email")
      .eq("id", String(boleto.customer_id))
      .maybeSingle();
    emailAcesso = custEmail?.email || null;
  }

  const vars = {
    name: opts.name,
    nameSource: "manual" as const,
    mes: String(boleto.mes_referencia || "—"),
    valor: formatBoletoValor(boleto.total),
    vencimento: formatBoletoVencimento(boleto.vencimento),
    emailAcesso,
    urlBoleto: String(boleto.url_boleto || ""),
  };
  const waText = renderBoletoNotifyTemplate(cfg.wa_text, vars);
  const consAudio = await loadConsultantForBoletoAudio(supabase, opts.consultantId);
  const spoken = buildBoletoAudioSpoken({
    audioBody: cfg.audio_script,
    name: opts.name,
    nameSource: "manual",
    ...consAudio,
  });

  const sendCtxBase = ctx(opts.consultantId, `test:${phone}`, "boleto_chegou:test");
  const wantAudio = cfg.send_audio !== false;
  const wantText = cfg.send_text !== false;
  const wantBoletoBtn = cfg.button_enabled === true;
  const ts = Date.now();
  let audioOk = !wantAudio;
  let textOk = !wantText;
  let appsOk = false;
  let buttonOk = !wantBoletoBtn;

  if (wantAudio) {
    try {
      const audioUrl = await renderPersonalizedTtsAudio(supabase, opts.consultantId, spoken);
      if (audioUrl) {
        const r = await resolved.adapter.sendMedia(
          jid,
          { kind: "audio", url: audioUrl, ptt: true },
          { ...sendCtxBase, idempotencyKey: `${sendCtxBase.idempotencyKey}:audio:${ts}`, supabase },
        );
        audioOk = !!r.ok;
      }
    } catch (e) {
      console.warn("[boleto-notify] test audio:", e instanceof Error ? e.message : e);
    }
  }

  if (wantText) {
    try {
      const r = await resolved.adapter.sendText(
        jid,
        stripBoletoButtonCta(waText),
        { ...sendCtxBase, idempotencyKey: `${sendCtxBase.idempotencyKey}:text:${ts}`, supabase },
      );
      textOk = !!r.ok;
    } catch (e) {
      console.warn("[boleto-notify] test text:", e instanceof Error ? e.message : e);
    }
  }

  try {
    const canButtons = !!resolved.adapter.capabilities?.supportsButtons;
    if (canButtons) {
      const r = await resolved.adapter.sendChoice(
        jid,
        buildAppStoreButtonsPrompt(vars.emailAcesso),
        { preferred: "button", options: boletoAppStoreChoiceOptions() },
        { ...sendCtxBase, idempotencyKey: `${sendCtxBase.idempotencyKey}:apps:${ts}`, supabase },
      );
      appsOk = !!r.ok || r.reason === "downgraded";
      if (!appsOk) {
        const fb = await resolved.adapter.sendText(
          jid,
          buildAppStoreNumberedMessage(vars.emailAcesso),
          { ...sendCtxBase, idempotencyKey: `${sendCtxBase.idempotencyKey}:apps_fb:${ts}`, supabase },
        );
        appsOk = !!fb.ok;
      }
    } else {
      const r = await resolved.adapter.sendText(
        jid,
        buildAppStoreNumberedMessage(vars.emailAcesso),
        { ...sendCtxBase, idempotencyKey: `${sendCtxBase.idempotencyKey}:apps:${ts}`, supabase },
      );
      appsOk = !!r.ok;
    }
  } catch (e) {
    console.warn("[boleto-notify] test apps:", e instanceof Error ? e.message : e);
  }

  if (wantBoletoBtn) {
    try {
      const r = await resolved.adapter.sendChoice(
        jid,
        buildBoletoButtonPrompt(cfg.button_boleto_label),
        {
          preferred: "button",
          options: [
            {
              id: BOLETO_RECEBER_DOC_BUTTON_ID,
              title: cfg.button_boleto_label.slice(0, 25),
            },
          ],
        },
        { ...sendCtxBase, idempotencyKey: `${sendCtxBase.idempotencyKey}:button:${ts}`, supabase },
      );
      buttonOk = !!r.ok || r.reason === "downgraded";
    } catch (e) {
      console.warn("[boleto-notify] test button:", e instanceof Error ? e.message : e);
    }
  }

  let clickArmed = false;
  if (wantBoletoBtn) {
    try {
      const phoneVariants = Array.from(
        new Set([phone, phone.slice(2), phone.length === 13 ? `${phone.slice(0, 4)}${phone.slice(5)}` : ""]),
      ).filter(Boolean);
      const { data: cust } = await supabase
        .from("customers")
        .select("id, name")
        .eq("consultant_id", opts.consultantId)
        .or(phoneVariants.map((p) => `phone_whatsapp.eq.${p}`).join(","))
        .limit(1)
        .maybeSingle();
      if (cust?.id && boleto.mes_referencia) {
        const { boletoChegouStageKey } = await import("../_shared/boleto-notify.ts");
        await supabase.from("customer_auto_message_log").upsert(
          {
            customer_id: cust.id,
            consultant_id: opts.consultantId,
            stage_key: boletoChegouStageKey(String(boleto.mes_referencia)),
            status: "sent",
            customer_name: cust.name || opts.name,
            message_preview: "teste boleto chegou",
            remote_jid: jid,
          },
          { onConflict: "customer_id,stage_key" },
        );
        clickArmed = true;
      }
    } catch {
      /* ignore */
    }
  }

  return {
    success: appsOk || textOk || audioOk,
    audio_ok: audioOk,
    text_ok: textOk,
    apps_ok: appsOk,
    button_ok: buttonOk,
    doc_ok: false,
    click_armed: clickArmed,
    spoken,
    phone,
    boleto: {
      mes: boleto.mes_referencia,
      valor: boleto.total,
      vencimento: boleto.vencimento,
      nome: boleto.nome,
      has_url: !!boleto.url_boleto,
    },
    hint: wantBoletoBtn
      ? (clickArmed
        ? "Pacote enviado. Toque em Receber boleto no Zap para o arquivo."
        : "Pacote enviado. Para o clique do arquivo, use WhatsApp de cliente da carteira.")
      : "Pacote enviado (apps Android/iOS sempre). Arquivo no Zap só com o toggle do botão ligado.",
  };
}