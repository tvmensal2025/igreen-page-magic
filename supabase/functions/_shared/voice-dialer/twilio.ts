/**
 * Helpers Twilio Voice — módulo voice-dialer (isolado do WhatsApp).
 */

const TWILIO_API = "https://api.twilio.com/2010-04-01";

export function twilioConfigured(): boolean {
  return !!(
    Deno.env.get("TWILIO_ACCOUNT_SID")?.trim() &&
    Deno.env.get("TWILIO_AUTH_TOKEN")?.trim() &&
    Deno.env.get("TWILIO_FROM_NUMBER")?.trim()
  );
}

/** Token obrigatório na query ?auth= das URLs de webhook. */
export function webhookAuthConfigured(): boolean {
  return !!(Deno.env.get("TWILIO_WEBHOOK_AUTH")?.trim());
}

export function getWebhookAuth(): string {
  return (Deno.env.get("TWILIO_WEBHOOK_AUTH") ?? "").trim();
}

export function getTwilioFromNumber(): string {
  return (Deno.env.get("TWILIO_FROM_NUMBER") ?? "").trim();
}

export function digitsOnly(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** Normaliza telefone BR para E.164 (+55...). */
export function toE164BR(raw: string | null | undefined): string | null {
  let d = digitsOnly(raw);
  if (!d) return null;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    return `+${d}`;
  }
  if (d.length === 10 || d.length === 11) {
    return `+55${d}`;
  }
  if (d.length > 13) d = d.slice(-13);
  if (d.startsWith("55") && d.length >= 12) return `+${d}`;
  if (d.length >= 10 && d.length <= 11) return `+55${d}`;
  return null;
}

function basicAuthHeader(): string {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const token = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  return `Basic ${btoa(`${sid}:${token}`)}`;
}

export interface CreateCallOpts {
  to: string;
  twimlUrl: string;
  statusCallbackUrl: string;
  /** Callback AsyncAMD — hangup se máquina. */
  amdCallbackUrl?: string;
  machineDetection?: "Enable" | "DetectMessageEnd";
  timeLimitSec?: number;
}

export interface CreateCallResult {
  ok: boolean;
  sid?: string;
  status?: string;
  error?: string;
  raw?: Record<string, unknown>;
}

export async function createOutboundCall(opts: CreateCallOpts): Promise<CreateCallResult> {
  if (!twilioConfigured()) {
    return { ok: false, error: "twilio_not_configured" };
  }
  if (!webhookAuthConfigured()) {
    return { ok: false, error: "twilio_webhook_auth_missing" };
  }

  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const from = getTwilioFromNumber();
  const body = new URLSearchParams();
  body.set("To", opts.to);
  body.set("From", from);
  body.set("Url", opts.twimlUrl);
  body.set("Method", "POST");
  body.set("StatusCallback", opts.statusCallbackUrl);
  body.set("StatusCallbackMethod", "POST");
  for (const ev of ["initiated", "ringing", "answered", "completed"]) {
    body.append("StatusCallbackEvent", ev);
  }
  // Sync AMD: AnsweredBy vem no request do TwiML
  body.set("MachineDetection", opts.machineDetection ?? "Enable");
  // Async AMD: se detectar máquina depois, hangup via callback
  if (opts.amdCallbackUrl) {
    body.set("AsyncAmd", "true");
    body.set("AsyncAmdStatusCallback", opts.amdCallbackUrl);
    body.set("AsyncAmdStatusCallbackMethod", "POST");
  }
  body.set("TimeLimit", String(opts.timeLimitSec ?? 40));

  try {
    const res = await fetch(`${TWILIO_API}/Accounts/${sid}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        (json.message as string) ||
        (json.error_message as string) ||
        JSON.stringify(json).slice(0, 300);
      return { ok: false, error: msg, raw: json };
    }
    return {
      ok: true,
      sid: String(json.sid ?? ""),
      status: String(json.status ?? ""),
      raw: json,
    };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "network_error" };
  }
}

/** Encerra chamada em andamento (ex.: AMD detectou máquina). */
export async function hangupCall(callSid: string): Promise<boolean> {
  if (!twilioConfigured() || !callSid) return false;
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  try {
    const body = new URLSearchParams();
    body.set("Status", "completed");
    const res = await fetch(`${TWILIO_API}/Accounts/${sid}/Calls/${callSid}.json`, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function validateTwilioSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  if (!authToken || !signature) return false;

  const keys = Object.keys(params).sort();
  let data = url;
  for (const k of keys) {
    data += k + params[k];
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function twimlPlay(audioUrl: string): string {
  const url = escapeXml(audioUrl);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Play>${url}</Play><Hangup/></Response>`;
}

export function twimlHangup(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;
}

export function isMachineAnsweredBy(answeredBy: string | null | undefined): boolean {
  const a = (answeredBy || "").toLowerCase();
  return (
    a === "machine_start" ||
    a === "machine_end_beep" ||
    a === "machine_end_silence" ||
    a === "machine_end_other" ||
    a === "fax" ||
    a.startsWith("machine")
  );
}

/** Janela de discagem — sempre America/Sao_Paulo (Brasília). */
export function inCallWindow(cfg: {
  windowStart?: string;
  windowEnd?: string;
  weekdaysOnly?: boolean;
  timezone?: string;
} | null): boolean {
  if (!cfg) return true;
  const tz = cfg.timezone || "America/Sao_Paulo";
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date())) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  if (cfg.weekdaysOnly) {
    const wd = (bag.weekday || "").slice(0, 3).toLowerCase();
    if (wd === "sat" || wd === "sun") return false;
  }
  const start = cfg.windowStart || "09:00";
  const end = cfg.windowEnd || "18:00";
  const [sH, sM] = String(start).split(":").map(Number);
  const [eH, eM] = String(end).split(":").map(Number);
  const startMin = sH * 60 + (sM || 0);
  const endMin = eH * 60 + (eM || 0);
  const hourRaw = bag.hour === "24" ? "0" : bag.hour;
  const cur = Number(hourRaw) * 60 + Number(bag.minute || 0);
  if (endMin < startMin) return cur >= startMin || cur <= endMin;
  return cur >= startMin && cur <= endMin;
}

/** Monta query auth obrigatória para URLs Twilio. */
export function webhookAuthQuery(): string {
  const auth = getWebhookAuth();
  return auth ? `&auth=${encodeURIComponent(auth)}` : "";
}
