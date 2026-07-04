/**
 * whapi-history-backfill
 *
 * Puxa todo o histórico de chats + mensagens da instância Whapi ativa
 * (definida em settings.whapi_token) e materializa em public.conversations,
 * criando/atualizando public.customers pelo telefone (E.164).
 *
 * Regras de negócio:
 *  - Só super admin pode disparar (mesma checagem do whapi-admin).
 *  - Lead novo entra com bot_paused=true (não dispara bot).
 *  - Lead já existente NÃO é modificado (preserva consultant_id/bot_paused).
 *  - Clientes iGreen (com igreen_code) NUNCA têm bot_paused sobrescrito.
 *  - Grupos (@g.us) são ignorados.
 *  - Idempotente via external_message_id = 'whapi_hist:<msg.id>'.
 *  - Status/progresso persistido em settings.whapi_backfill_status (JSON).
 *  - EdgeRuntime.waitUntil() mantém o job vivo após 200 OK.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WHAPI_BASE = "https://gate.whapi.cloud";
const STATUS_KEY = "whapi_backfill_status";
const CHATS_PAGE = 500;
const MSGS_PAGE = 500;
const SLEEP_MS = 120;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizePhone(chatId: string): string | null {
  // chatId whapi: "5534998239056@s.whatsapp.net" ou "...@c.us"
  const raw = String(chatId || "").split("@")[0].replace(/\D/g, "");
  if (!raw || raw.length < 8) return null;
  return `+${raw}`;
}

function isGroup(chatId: string): boolean {
  return String(chatId || "").includes("@g.us");
}

function mapType(m: any): { type: string; text: string } {
  const t = String(m?.type || "text").toLowerCase();
  const map: Record<string, string> = {
    text: "text",
    image: "image",
    video: "video",
    audio: "audio",
    voice: "audio",
    ptt: "audio",
    document: "document",
    sticker: "sticker",
    location: "location",
    contact: "contact",
    contacts: "contact",
    interactive: "text",
    button: "text",
    list: "text",
    reaction: "reaction",
  };
  const type = map[t] || t || "text";
  let text = "";
  if (t === "text") text = m?.text?.body || "";
  else if (t === "image" || t === "video" || t === "document") {
    text = m?.[t]?.caption || `[${type}]`;
  } else if (t === "audio" || t === "voice" || t === "ptt") text = "[audio]";
  else if (t === "sticker") text = "[sticker]";
  else if (t === "location") text = "[location]";
  else if (t === "contact" || t === "contacts") text = "[contact]";
  else if (t === "reaction") text = m?.reaction?.emoji || "[reaction]";
  else if (t === "interactive" || t === "button" || t === "list") {
    text =
      m?.interactive?.body?.text ||
      m?.button?.text ||
      m?.text?.body ||
      "[interactive]";
  } else {
    text = m?.text?.body || `[${type}]`;
  }
  return { type, text: text || "" };
}

async function whapiGet(
  token: string,
  path: string,
  params: Record<string, string | number>,
): Promise<any> {
  const q = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  const url = `${WHAPI_BASE}${path}${q ? `?${q}` : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`whapi ${path} ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function updateStatus(admin: any, patch: Record<string, unknown>) {
  const { data: row } = await admin
    .from("settings")
    .select("value")
    .eq("key", STATUS_KEY)
    .maybeSingle();
  let prev: Record<string, unknown> = {};
  try {
    prev = row?.value ? JSON.parse(row.value) : {};
  } catch {
    prev = {};
  }
  const next = { ...prev, ...patch, updated_at: new Date().toISOString() };
  await admin
    .from("settings")
    .upsert(
      { key: STATUS_KEY, value: JSON.stringify(next) },
      { onConflict: "key" },
    );
}

async function runBackfill(admin: any, token: string, jobId: string) {
  const stats = {
    chats_processed: 0,
    chats_skipped_group: 0,
    chats_skipped_existing_igreen: 0,
    customers_created: 0,
    customers_reused: 0,
    messages_inserted: 0,
    messages_skipped: 0,
    errors: [] as string[],
    last_chat: null as string | null,
  };

  try {
    await updateStatus(admin, {
      job_id: jobId,
      state: "running",
      started_at: new Date().toISOString(),
      finished_at: null,
      stats,
    });

    let offset = 0;
    // Paginação de chats
    for (;;) {
      let page: any;
      try {
        page = await whapiGet(token, "/chats", {
          count: CHATS_PAGE,
          offset,
        });
      } catch (e: any) {
        stats.errors.push(`chats@${offset}: ${e.message}`);
        break;
      }
      const chats: any[] = page?.chats || page?.data || [];
      if (!chats.length) break;

      for (const chat of chats) {
        const chatId = String(chat?.id || "");
        if (!chatId) continue;
        if (isGroup(chatId)) {
          stats.chats_skipped_group++;
          continue;
        }
        const phone = normalizePhone(chatId);
        if (!phone) continue;

        try {
          // Verifica se já é cliente iGreen — nesse caso, não importa mensagens
          // (regra do usuário: importar somente o que entrou no WhatsApp,
          // não clientes já importados do iGreen).
          const { data: existing } = await admin
            .from("customers")
            .select("id, igreen_code, bot_paused")
            .eq("phone_whatsapp", phone)
            .maybeSingle();

          if (existing?.igreen_code) {
            stats.chats_skipped_existing_igreen++;
            stats.chats_processed++;
            stats.last_chat = phone;
            continue;
          }

          let customerId: string;
          if (existing?.id) {
            customerId = existing.id;
            stats.customers_reused++;
          } else {
            const insertRow = {
              phone_whatsapp: phone,
              name: chat?.name || chat?.pushname || null,
              lead_source: "whapi_backfill",
              bot_paused: true,
              bot_paused_reason: "whapi_history_import",
              bot_paused_at: new Date().toISOString(),
              status: "novo",
            };
            const { data: created, error: cErr } = await admin
              .from("customers")
              .insert(insertRow)
              .select("id")
              .maybeSingle();
            if (cErr || !created?.id) {
              stats.errors.push(`customer ${phone}: ${cErr?.message || "no id"}`);
              continue;
            }
            customerId = created.id;
            stats.customers_created++;
          }

          // Paginação de mensagens desse chat
          let mOffset = 0;
          for (;;) {
            let mPage: any;
            try {
              mPage = await whapiGet(
                token,
                `/messages/list/${encodeURIComponent(chatId)}`,
                { count: MSGS_PAGE, offset: mOffset },
              );
            } catch (e: any) {
              stats.errors.push(`msgs ${phone}@${mOffset}: ${e.message}`);
              break;
            }
            const msgs: any[] = mPage?.messages || mPage?.data || [];
            if (!msgs.length) break;

            const rows = msgs
              .map((m) => {
                const id = String(m?.id || "").trim();
                if (!id) return null;
                const { type, text } = mapType(m);
                const ts = Number(m?.timestamp || 0);
                const createdAt = ts
                  ? new Date(ts * 1000).toISOString()
                  : new Date().toISOString();
                return {
                  customer_id: customerId,
                  message_direction: m?.from_me ? "outbound" : "inbound",
                  message_text: text,
                  message_type: type,
                  conversation_step: "whapi_history",
                  external_message_id: `whapi_hist:${id}`,
                  created_at: createdAt,
                  delivery_status: m?.from_me
                    ? String(m?.status || "").toLowerCase() || null
                    : null,
                };
              })
              .filter(Boolean);

            if (rows.length) {
              const { error: iErr, count } = await admin
                .from("conversations")
                .upsert(rows as any, {
                  onConflict: "external_message_id",
                  ignoreDuplicates: true,
                  count: "exact",
                });
              if (iErr) {
                stats.errors.push(`insert ${phone}: ${iErr.message}`);
                stats.messages_skipped += rows.length;
              } else {
                const inserted = count ?? rows.length;
                stats.messages_inserted += inserted;
                stats.messages_skipped += rows.length - inserted;
              }
            }

            if (msgs.length < MSGS_PAGE) break;
            mOffset += msgs.length;
            await sleep(SLEEP_MS);
          }

          stats.chats_processed++;
          stats.last_chat = phone;

          // Salva progresso a cada 10 chats
          if (stats.chats_processed % 10 === 0) {
            await updateStatus(admin, { stats });
          }
        } catch (e: any) {
          stats.errors.push(`chat ${chatId}: ${e?.message || e}`);
        }
        await sleep(SLEEP_MS);
      }

      if (chats.length < CHATS_PAGE) break;
      offset += chats.length;
    }

    await updateStatus(admin, {
      state: "finished",
      finished_at: new Date().toISOString(),
      stats,
    });
  } catch (e: any) {
    stats.errors.push(`fatal: ${e?.message || e}`);
    await updateStatus(admin, {
      state: "error",
      finished_at: new Date().toISOString(),
      stats,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json(401, { error: "Unauthorized" });
    const userId = claims.claims.sub as string;
    const userEmail = (claims.claims.email as string | undefined)?.toLowerCase() || "";

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Autorização super admin (mesmo padrão do whapi-admin)
    let ok = userEmail === "rafael.ids@icloud.com";
    if (!ok) {
      try {
        const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: userId });
        if (isSuper === true) ok = true;
      } catch (_) {/* ignore */}
    }
    if (!ok) {
      const { data: row } = await admin
        .from("settings")
        .select("value")
        .eq("key", "superadmin_consultant_id")
        .maybeSingle();
      if (row?.value === userId) ok = true;
    }
    if (!ok) return json(403, { error: "Acesso restrito ao super admin" });

    // Já rodando?
    const { data: statusRow } = await admin
      .from("settings")
      .select("value")
      .eq("key", STATUS_KEY)
      .maybeSingle();
    let current: any = null;
    try {
      current = statusRow?.value ? JSON.parse(statusRow.value) : null;
    } catch { current = null; }

    const body = await req.json().catch(() => ({}));
    const force = !!body?.force;
    if (current?.state === "running" && !force) {
      return json(409, {
        error: "backfill_already_running",
        job_id: current.job_id,
        stats: current.stats,
      });
    }

    // Carrega token whapi
    const { data: settings } = await admin
      .from("settings")
      .select("key, value")
      .in("key", ["whapi_token"]);
    const settingsMap: Record<string, string> = {};
    settings?.forEach((r: any) => { settingsMap[r.key] = r.value; });
    const whapiToken =
      settingsMap.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
    if (!whapiToken) return json(500, { error: "WHAPI_TOKEN não configurado" });

    const jobId = crypto.randomUUID();

    // Dispara em background — retorna 202 imediato
    // deno-lint-ignore no-explicit-any
    const runtime = (globalThis as any).EdgeRuntime;
    const task = runBackfill(admin, whapiToken, jobId);
    if (runtime?.waitUntil) runtime.waitUntil(task);
    else task.catch(() => {});

    return json(202, { ok: true, job_id: jobId });
  } catch (err: any) {
    console.error("[whapi-history-backfill] erro:", err?.message || err);
    return json(500, { error: err?.message || "Erro interno" });
  }
});
