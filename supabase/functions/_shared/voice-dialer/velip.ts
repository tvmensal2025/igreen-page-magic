/**
 * Driver Velip Voice V2 — módulo voice-dialer (isolado do WhatsApp).
 *
 * Docs de referência: https://api.velip.com.br/  (endpoints v2 usados
 *   CreateAudioFile, PlayAudioFile, MakeTTSCall, CreateCampaign,
 *   CreateDestinationBase, ChangeCampaign, GetCampaignsList,
 *   GetCallStatus, GetUserID).
 *
 * A Velip **não assina** callbacks; segurança do webhook é ?auth=<token>.
 */

const VELIP_BASE = "https://vox.velip.com.br/api/v2";
const VELIP_IPS = new Set(["35.232.103.91", "35.184.30.236"]);

export function velipConfigured(): boolean {
  return !!Deno.env.get("VELIP_API_TOKEN")?.trim();
}

export function velipWebhookAuthConfigured(): boolean {
  return !!Deno.env.get("VELIP_WEBHOOK_AUTH")?.trim();
}

export function getVelipToken(): string {
  return (Deno.env.get("VELIP_API_TOKEN") ?? "").trim();
}

export function getVelipWebhookAuth(): string {
  return (Deno.env.get("VELIP_WEBHOOK_AUTH") ?? "").trim();
}

export function velipWebhookAuthQuery(): string {
  const t = getVelipWebhookAuth();
  return t ? `&auth=${encodeURIComponent(t)}` : "";
}

export function isVelipCallerIp(ip: string | null | undefined): boolean {
  if (!ip) return false;
  return VELIP_IPS.has(ip.trim());
}

export function digitsOnly(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** Normaliza BR para formato aceito pela Velip: `55DDNNNNNNNN` (sem "+"). */
export function toVelipBRDest(raw: string | null | undefined): string | null {
  let d = digitsOnly(raw);
  if (!d) return null;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if (d.length > 13) d = d.slice(-13);
  if (d.startsWith("55") && d.length >= 12) return d;
  if (d.length >= 10 && d.length <= 11) return `55${d}`;
  return null;
}

/** Trunca ctid p/ 15 chars (limite Velip). */
export function toCtid(id: string): string {
  return String(id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 15);
}

function velipHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${getVelipToken()}`,
    Accept: "application/json",
    ...extra,
  };
}

interface RawResp {
  ok: boolean;
  status_code?: number;
  status?: string;
  raw?: unknown;
  error?: string;
}

async function velipPost(
  path: string,
  form: URLSearchParams | FormData,
  timeoutMs = 20_000,
): Promise<RawResp> {
  const headers = velipHeaders();
  if (form instanceof URLSearchParams) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  try {
    const res = await fetch(`${VELIP_BASE}${path}`, {
      method: "POST",
      headers,
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { _raw: text };
    }
    const status_code = typeof json.status_code === "number"
      ? json.status_code
      : Number(json.status_code ?? NaN);
    const status = typeof json.status === "string" ? json.status : undefined;
    const ok = res.ok && (Number.isFinite(status_code) ? status_code === 0 : true);
    return {
      ok,
      status_code: Number.isFinite(status_code) ? status_code : undefined,
      status,
      raw: json,
      error: ok
        ? undefined
        : (status ?? `http_${res.status}`) + (status_code != null ? `#${status_code}` : ""),
    };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "network_error" };
  }
}

// ─── Health / diagnóstico ──────────────────────────────────────────────────

export interface UserIDResp extends RawResp {
  saldo?: number | null;
}

export async function getUserID(): Promise<UserIDResp> {
  const r = await velipPost("/GetUserID", new URLSearchParams(), 10_000);
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  const saldoRaw = raw.saldo ?? raw.balance ?? raw.credit ?? null;
  const saldo = typeof saldoRaw === "number" ? saldoRaw : Number(saldoRaw);
  return { ...r, saldo: Number.isFinite(saldo) ? saldo : null };
}

// ─── Áudio ─────────────────────────────────────────────────────────────────

export interface UploadAudioResp extends RawResp {
  audio_id?: string;
}

export async function uploadAudioFile(
  bytes: Uint8Array,
  name: string,
  contentType = "audio/mpeg",
): Promise<UploadAudioResp> {
  const fd = new FormData();
  const blob = new Blob([bytes], { type: contentType });
  const safeName = (name || "clipe").replace(/[^\w.-]+/g, "_").slice(0, 60) || "clipe";
  // Velip aceita `arquivo` OU `file`; enviamos ambos para robustez.
  fd.append("arquivo", blob, `${safeName}.mp3`);
  fd.append("file", blob, `${safeName}.mp3`);
  fd.append("nome", safeName);
  fd.append("name", safeName);
  const r = await velipPost("/CreateAudioFile", fd, 60_000);
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  const audio_id = String(
    raw.audio_id ?? raw.id ?? raw.aid ?? raw.audio ?? "",
  ) || undefined;
  return { ...r, audio_id };
}

export interface AudioListItem {
  audio_id: string;
  name?: string;
  duration_sec?: number;
}

export async function listAudios(): Promise<{ ok: boolean; items: AudioListItem[]; error?: string; raw?: unknown }> {
  const r = await velipPost("/GetAudiosList", new URLSearchParams(), 15_000);
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  const arr = (raw.audios ?? raw.data ?? raw.list ?? []) as unknown[];
  const items: AudioListItem[] = [];
  if (Array.isArray(arr)) {
    for (const it of arr) {
      const row = it as Record<string, unknown>;
      const id = String(row.audio_id ?? row.id ?? "");
      if (!id) continue;
      items.push({
        audio_id: id,
        name: (row.name as string) ?? (row.nome as string) ?? undefined,
        duration_sec: Number(row.duration_sec ?? row.duracao ?? NaN) || undefined,
      });
    }
  }
  return { ok: r.ok, items, error: r.error, raw };
}

// ─── Chamadas individuais ──────────────────────────────────────────────────

export interface MakeCallOpts {
  to: string;               // 55DDNNNNNNNN
  audioId?: string;
  ttsText?: string;
  ctid: string;
  timeLimitSec?: number;
  /** Formato YYYY-MM-DD HH:MM:SS (fuso Velip). */
  scheduledAt?: string;
  callerId?: string;
}

export interface MakeCallResult extends RawResp {
  cd_id?: string;
}

function baseCallForm(opts: MakeCallOpts): URLSearchParams {
  const form = new URLSearchParams();
  form.set("dest", opts.to);
  form.set("ctid", toCtid(opts.ctid));
  if (opts.timeLimitSec) form.set("time_limit", String(opts.timeLimitSec));
  if (opts.scheduledAt) form.set("scheduled_at", opts.scheduledAt);
  const bina = opts.callerId ?? Deno.env.get("VELIP_CALLER_ID")?.trim();
  if (bina) form.set("caller_id", bina);
  return form;
}

export async function playAudioFile(opts: MakeCallOpts): Promise<MakeCallResult> {
  if (!opts.audioId) return { ok: false, error: "missing_audio_id" };
  const form = baseCallForm(opts);
  form.set("audio_id", opts.audioId);
  const r = await velipPost("/PlayAudioFile", form);
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  const cd_id = String(raw.cd_id ?? raw.id ?? raw.call_id ?? "") || undefined;
  return { ...r, cd_id };
}

export async function makeTTSCall(opts: MakeCallOpts): Promise<MakeCallResult> {
  const form = baseCallForm(opts);
  if (opts.audioId) form.set("audio_id", opts.audioId);
  if (opts.ttsText) form.set("text", opts.ttsText);
  const r = await velipPost("/MakeTTSCall", form);
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  const cd_id = String(raw.cd_id ?? raw.id ?? raw.call_id ?? "") || undefined;
  return { ...r, cd_id };
}

// ─── Campanhas em lote ─────────────────────────────────────────────────────

export interface DestinationItem {
  dest: string;
  ctid?: string;
  name?: string;
  cod_cli?: string;
  extras?: string[];
}

export interface DestinationBaseResp extends RawResp {
  base_id?: string;
}

export async function createDestinationBase(
  items: DestinationItem[],
  name = `base_${Date.now()}`,
): Promise<DestinationBaseResp> {
  const form = new URLSearchParams();
  form.set("nome", name);
  form.set("name", name);
  // A Velip aceita JSON no campo `destinos`
  form.set("destinos", JSON.stringify(items.map((it) => ({
    dest: it.dest,
    ctid: it.ctid ? toCtid(it.ctid) : undefined,
    name: it.name,
    cod_cli: it.cod_cli,
    extras: it.extras,
  }))));
  const r = await velipPost("/CreateDestinationBase", form, 60_000);
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  const base_id = String(raw.base_id ?? raw.id ?? "") || undefined;
  return { ...r, base_id };
}

export interface CreateCampaignOpts {
  baseId: string;
  audioId: string;
  name: string;
  scheduledAt?: string;
  ctid?: string;
}

export interface CreateCampaignResp extends RawResp {
  cp_id?: string;
}

export async function createCampaign(opts: CreateCampaignOpts): Promise<CreateCampaignResp> {
  const form = new URLSearchParams();
  form.set("nome", opts.name);
  form.set("name", opts.name);
  form.set("base_id", opts.baseId);
  form.set("audio_id", opts.audioId);
  if (opts.scheduledAt) form.set("scheduled_at", opts.scheduledAt);
  if (opts.ctid) form.set("ctid", toCtid(opts.ctid));
  const r = await velipPost("/CreateCampaign", form, 30_000);
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  const cp_id = String(raw.cp_id ?? raw.campaign_id ?? raw.id ?? "") || undefined;
  return { ...r, cp_id };
}

export type CampaignAction = "pause" | "resume" | "cancel";

export async function changeCampaign(cp_id: string, action: CampaignAction): Promise<RawResp> {
  const form = new URLSearchParams();
  form.set("cp_id", cp_id);
  form.set("campaign_id", cp_id);
  form.set("action", action);
  form.set("acao", action === "pause" ? "pausar" : action === "resume" ? "retomar" : "cancelar");
  return await velipPost("/ChangeCampaign", form, 15_000);
}

export async function getCampaignsList(): Promise<{ ok: boolean; items: unknown[]; error?: string; raw?: unknown }> {
  const r = await velipPost("/GetCampaignsList", new URLSearchParams(), 15_000);
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  const arr = (raw.campaigns ?? raw.data ?? raw.list ?? []) as unknown[];
  return { ok: r.ok, items: Array.isArray(arr) ? arr : [], error: r.error, raw };
}

// ─── SMS ───────────────────────────────────────────────────────────────────

export interface MakeSMSOpts {
  to: string;
  message: string;
  ctid?: string;
  scheduledAt?: string;
}

export interface MakeSMSResult extends RawResp {
  cdls_id?: string;
}

export async function makeSMS(opts: MakeSMSOpts): Promise<MakeSMSResult> {
  const form = new URLSearchParams();
  form.set("dest", opts.to);
  form.set("text", opts.message);
  form.set("mensagem", opts.message);
  if (opts.ctid) form.set("ctid", toCtid(opts.ctid));
  if (opts.scheduledAt) form.set("scheduled_at", opts.scheduledAt);
  const r = await velipPost("/MakeSMS", form, 15_000);
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  const cdls_id = String(raw.cdls_id ?? raw.id ?? "") || undefined;
  return { ...r, cdls_id };
}

export async function getCallStatus(cd_id: string): Promise<RawResp & { called_status?: string }> {
  const form = new URLSearchParams();
  form.set("cd_id", cd_id);
  const r = await velipPost("/GetCallStatus", form, 15_000);
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  const called_status = String(raw.cd_called_status ?? raw.called_status ?? "") || undefined;
  return { ...r, called_status };
}

// ─── Interpretação de status ───────────────────────────────────────────────

export type VelipOutcome =
  | "answered"
  | "no_answer"
  | "invalid_number"
  | "blocked"
  | "do_not_disturb"
  | "nonexistent"
  | "unknown";

export function interpretStatus(cd_called_status: string | null | undefined): VelipOutcome {
  const s = String(cd_called_status || "").toUpperCase().trim();
  switch (s) {
    case "OK":
      return "answered";
    case "NA":
      return "no_answer";
    case "EK":
      return "invalid_number";
    case "CK":
      return "blocked";
    case "BK":
      return "do_not_disturb";
    case "IK":
      return "nonexistent";
    default:
      return "unknown";
  }
}

/** Só `no_answer` justifica retry automático. */
export function isRetryable(outcome: VelipOutcome): boolean {
  return outcome === "no_answer";
}

/** Mapeia outcome Velip → status interno do target. */
export function outcomeToTargetStatus(outcome: VelipOutcome):
  | "completed"
  | "no_answer"
  | "failed"
  | null
{
  switch (outcome) {
    case "answered":
      return "completed";
    case "no_answer":
      return "no_answer";
    case "invalid_number":
    case "blocked":
    case "do_not_disturb":
    case "nonexistent":
      return "failed";
    default:
      return null;
  }
}

export function outcomeLabelPtBR(outcome: VelipOutcome): string {
  switch (outcome) {
    case "answered": return "Atendida";
    case "no_answer": return "Não atendeu";
    case "invalid_number": return "Número inválido";
    case "blocked": return "Bloqueio operadora";
    case "do_not_disturb": return "Não perturbe";
    case "nonexistent": return "Número inexistente";
    default: return "Desconhecido";
  }
}

/** Janela de discagem BR (fuso -03) — reaproveitado. */
export function inCallWindow(cfg: {
  windowStart?: string;
  windowEnd?: string;
  weekdaysOnly?: boolean;
} | null): boolean {
  if (!cfg) return true;
  const now = new Date(Date.now() - 3 * 3600_000);
  if (cfg.weekdaysOnly) {
    const d = now.getUTCDay();
    if (d === 0 || d === 6) return false;
  }
  const start = cfg.windowStart || "09:00";
  const end = cfg.windowEnd || "18:00";
  const [sH, sM] = String(start).split(":").map(Number);
  const [eH, eM] = String(end).split(":").map(Number);
  const startMin = sH * 60 + (sM || 0);
  const endMin = eH * 60 + (eM || 0);
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (endMin < startMin) return cur >= startMin || cur <= endMin;
  return cur >= startMin && cur <= endMin;
}
