/**
 * Driver Velip Voice V2 — módulo voice-dialer (isolado do WhatsApp).
 *
 * Docs de referência: https://api.velip.com.br/ (fonte: github.com/velipbr/velip-docs).
 * Endpoints v2 usados: CreateAudioFile, MakeTTSCall, CreateCampaign,
 *   CreateDestinationBase, ChangeCampaign, GetCampaignsList,
 *   GetCallStatus, GetAudiosList, MakeSMS, GetUserID.
 *
 * Particularidades do protocolo (conferidas na doc oficial + testes reais):
 *  - Toda resposta vem no envelope `{"return": {...}}`; `status_code` é string ("0" = ok).
 *  - Ligação com áudio gravado = MakeTTSCall com `content=<id numérico sem o prefixo "tf">`.
 *    (PlayAudioFile na Velip serve para BAIXAR/stream do áudio, não para discar.)
 *  - Upload precisa de `ttswrt=1` para o asset não expirar em 1 dia.
 *  - Form-urlencoded default é ISO-8859-1 → enviar `encoding=UTF-8` junto com textos.
 *  - GetUserID NÃO retorna saldo (a API v2 não expõe saldo; consultar no painel).
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

/** Extrai o envelope `return` da resposta Velip (com fallback para a raiz). */
function velipEnvelope(json: Record<string, unknown>): Record<string, unknown> {
  const ret = json?.return;
  return ret && typeof ret === "object" ? (ret as Record<string, unknown>) : json;
}

/** Normaliza `status` da Velip (string | {0: "..."} | array). */
function normalizeVelipStatus(raw: unknown): string | undefined {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    return typeof first === "string" ? first : String(first ?? "");
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const v = o["0"] ?? o.status ?? Object.values(o)[0];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

async function velipPost(
  path: string,
  form: URLSearchParams | FormData,
  timeoutMs = 20_000,
): Promise<RawResp> {
  const headers = velipHeaders();
  if (form instanceof URLSearchParams) {
    headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
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
    // Velip responde `{"return": {"status": "OK", "status_code": "0", ...}}`
    // com status_code como STRING. Ler no envelope, com fallback na raiz.
    const env = velipEnvelope(json);
    const scRaw = env.status_code ?? json.status_code;
    const status_code = typeof scRaw === "number" ? scRaw : Number(scRaw ?? NaN);
    const status = normalizeVelipStatus(env.status) ?? normalizeVelipStatus(json.status);
    const ok = res.ok && (Number.isFinite(status_code) ? status_code === 0 : true);
    return {
      ok,
      status_code: Number.isFinite(status_code) ? status_code : undefined,
      status,
      raw: json,
      error: ok
        ? undefined
        : (status ?? `http_${res.status}`) +
          (Number.isFinite(status_code) ? `#${status_code}` : ""),
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
  // A API v2 NÃO expõe saldo (GetUserID retorna só ids + flags aut_*).
  // saldo fica null → UI mostra "—" e orienta consultar o painel Velip.
  const env = velipEnvelope((r.raw ?? {}) as Record<string, unknown>);
  const saldoRaw = env.saldo ?? env.balance ?? env.credit;
  const saldo = saldoRaw == null ? NaN : Number(saldoRaw);
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
  // Cast: TS 5.7+ exige ArrayBuffer não-compartilhado em BlobPart; os bytes
  // aqui sempre vêm de ArrayBuffer comum (fetch/File), nunca SharedArrayBuffer.
  const blob = new Blob([bytes as unknown as BlobPart], { type: contentType });
  const safeName = (name || "clipe").replace(/[^\w.-]+/g, "_").slice(0, 60) || "clipe";
  // Doc CreateAudioFile: campo de arquivo `audio` (aceita qualquer nome de
  // campo, mas `audio` é o documentado) + `name` + `ttswrt=1` para o asset
  // NÃO expirar em 1 dia (sem isso, expira amanhã e o id salvo fica inválido).
  fd.append("audio", blob, `${safeName}.mp3`);
  fd.append("name", safeName);
  fd.append("name_up", `${safeName}.mp3`);
  fd.append("ttswrt", "1");
  const r = await velipPost("/CreateAudioFile", fd, 60_000);
  // Resposta: `return.cdw_file` = "tf12345". Nas chamadas (MakeTTSCall) o
  // parâmetro `content` aceita o id com ou sem o prefixo "tf"; guardamos como veio.
  const env = velipEnvelope((r.raw ?? {}) as Record<string, unknown>);
  const audio_id = String(
    env.cdw_file ?? env.audio_id ?? env.id ?? env.aid ?? env.audio ?? "",
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
  // Resposta real: `{"return": {...}, "audios": [{"cdw_file": "tf123",
  //   "cdw_name": "...", "cdw_sec": "27.6", ...}]}` — `audios` fica na RAIZ.
  const arr = (raw.audios ?? raw.data ?? raw.list ?? []) as unknown[];
  const items: AudioListItem[] = [];
  if (Array.isArray(arr)) {
    for (const it of arr) {
      const row = it as Record<string, unknown>;
      const id = String(row.cdw_file ?? row.audio_id ?? row.id ?? "");
      if (!id) continue;
      items.push({
        audio_id: id,
        name: (row.cdw_name as string) ?? (row.name as string) ?? (row.nome as string) ?? undefined,
        duration_sec: Number(row.cdw_sec ?? row.duration_sec ?? row.duracao ?? NaN) || undefined,
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
  /** Voz TTS no formato `provider|VoiceName` (GetTTSVoices). */
  voice?: string;
  ctid: string;
  timeLimitSec?: number;
  /** Formato YYYY-MM-DD HH:MM:SS (fuso Velip) — vira `block` (não discar antes de). */
  scheduledAt?: string;
  callerId?: string;
  /**
   * `free=1` libera destino da lista Procon (BK_PROCON).
   * Usar só em testes manuais — campanhas em massa seguem a política da conta.
   */
  free?: boolean;
}

export interface MakeCallResult extends RawResp {
  cd_id?: string;
}

function baseCallForm(opts: MakeCallOpts): URLSearchParams {
  const form = new URLSearchParams();
  form.set("dest", opts.to);
  form.set("ctid", toCtid(opts.ctid));
  // Nomes oficiais MakeTTSCall: `timelimit`, `block`, `callerid`, `free`.
  if (opts.timeLimitSec) form.set("timelimit", String(opts.timeLimitSec));
  if (opts.scheduledAt) form.set("block", opts.scheduledAt);
  const bina = opts.callerId ?? Deno.env.get("VELIP_CALLER_ID")?.trim();
  if (bina) form.set("callerid", bina);
  if (opts.free) form.set("free", "1");
  return form;
}

/**
 * Liga tocando um áudio gravado.
 * ATENÇÃO: o endpoint `PlayAudioFile` da Velip serve para BAIXAR/stream do
 * áudio (não disca). Ligação com áudio gravado é `MakeTTSCall` com `content`.
 * Mantemos o nome da função para não quebrar os call-sites existentes.
 */
export async function playAudioFile(opts: MakeCallOpts): Promise<MakeCallResult> {
  if (!opts.audioId) return { ok: false, error: "missing_audio_id" };
  return await makeTTSCall(opts);
}

export async function makeTTSCall(opts: MakeCallOpts): Promise<MakeCallResult> {
  const form = baseCallForm(opts);
  if (opts.audioId) {
    // A doc diz "numeric portion (without tf)", mas NA PRÁTICA (validado
    // 2026-07-13) o content numérico faz a chamada cair ao atender (dur=0,
    // status NA) — sem o áudio. Com o prefixo "tf" toca até o fim.
    const id = String(opts.audioId).trim();
    form.set("content", /^\d+$/.test(id) ? `tf${id}` : id);
  }
  if (opts.ttsText) {
    form.set("text", opts.ttsText);
    // Form-urlencoded default é ISO-8859-1; sem isso os acentos corrompem.
    form.set("encoding", "UTF-8");
    if (opts.voice) form.set("voice", opts.voice);
  }
  const r = await velipPost("/MakeTTSCall", form);
  // Resposta: `return.cd_id` no formato "<cdcs_db>_<id>" — usar como veio
  // no GetCallStatus (doc manda passar as-is).
  const env = velipEnvelope((r.raw ?? {}) as Record<string, unknown>);
  const cd_id = String(env.cd_id ?? env.id ?? env.call_id ?? "") || undefined;
  return { ...r, cd_id: cd_id === "0" ? undefined : cd_id };
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
  form.set("name", name);
  // Doc CreateDestinationBase: lista vai no campo `datajson`, cada registro
  // com `phone` (não "dest"); extras viram extra1..extra4 (placeholders TTS).
  form.set("datajson", JSON.stringify(items.map((it) => {
    const rec: Record<string, unknown> = { phone: it.dest };
    if (it.name) rec.name = it.name;
    if (it.cod_cli) rec.cod_cli = it.cod_cli;
    (it.extras ?? []).slice(0, 4).forEach((v, i) => {
      if (v) rec[`extra${i + 1}`] = v;
    });
    return rec;
  })));
  const r = await velipPost("/CreateDestinationBase", form, 60_000);
  // Resposta: `return.cdlc_id` (+ num_dest / base_size).
  const env = velipEnvelope((r.raw ?? {}) as Record<string, unknown>);
  const base_id = String(env.cdlc_id ?? env.base_id ?? env.id ?? "") || undefined;
  return { ...r, base_id };
}

export interface CreateCampaignOpts {
  baseId: string;
  audioId: string;
  name: string;
  scheduledAt?: string;
  ctid?: string;
  /** Ligações por minuto: 1–100 ou "max" (doc Velip ChangeCampaign/CreateCampaign). */
  vel?: number | "max";
}

export interface CreateCampaignResp extends RawResp {
  cp_id?: string;
}

export async function createCampaign(opts: CreateCampaignOpts): Promise<CreateCampaignResp> {
  const form = new URLSearchParams();
  form.set("name", opts.name);
  // Doc CreateCampaign: lista = `cdlc_id`; áudio principal = `content`
  // (cd_wav.cdw_file, ex. "tf12345"); id correlação = `cp_ctid`.
  form.set("cdlc_id", opts.baseId);
  form.set("content", opts.audioId);
  if (opts.ctid) form.set("cp_ctid", toCtid(opts.ctid));
  form.set("cp_ativo", "1");
  // Velip: `vel` = ligações/minuto (1–100 ou max). Default da conta costuma ser baixo.
  const vel = opts.vel ?? "max";
  form.set("vel", String(vel));
  if (opts.scheduledAt) {
    // "YYYY-MM-DD HH:MM:SS" → date_start + time_start (roda só nesse dia).
    const [d, t] = opts.scheduledAt.split(" ");
    if (d) {
      form.set("date_start", d);
      form.set("date_end", d);
    }
    if (t) form.set("time_start", t);
  }
  const r = await velipPost("/CreateCampaign", form, 30_000);
  const env = velipEnvelope((r.raw ?? {}) as Record<string, unknown>);
  const cp_id = String(env.cp_id ?? env.campaign_id ?? env.id ?? "") || undefined;
  return { ...r, cp_id: cp_id === "0" ? undefined : cp_id };
}

export type CampaignAction = "pause" | "resume" | "cancel";

export async function changeCampaign(cp_id: string, action: CampaignAction): Promise<RawResp> {
  const form = new URLSearchParams();
  form.set("cp_id", cp_id);
  // Doc ChangeCampaign: o campo mutável é `active` (0/1). A API não tem
  // "cancel" — cancelar = pausar na Velip; o status cancelado fica no banco.
  form.set("active", action === "resume" ? "1" : "0");
  const r = await velipPost("/ChangeCampaign", form, 15_000);
  // Código 230 = "Parameters without change" (já estava no estado pedido) — tratar como ok.
  if (!r.ok && r.status_code === 230) return { ...r, ok: true };
  return r;
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
  /** Janela anti-duplicata em segundos (default Velip=10). Use 0 para desligar. */
  httpdup?: number;
}

export interface MakeSMSResult extends RawResp {
  cdls_id?: string;
}

export async function makeSMS(opts: MakeSMSOpts): Promise<MakeSMSResult> {
  const form = new URLSearchParams();
  form.set("dest", opts.to);
  // Doc MakeSMS: campo oficial `message` (aliases text/msg_text).
  // cuttext=1 evita erro 238 quando passa de 160 chars.
  form.set("message", opts.message);
  form.set("cuttext", "1");
  if (opts.ctid) form.set("ctid", toCtid(opts.ctid));
  if (opts.httpdup != null) form.set("httpdup", String(Math.max(0, Math.min(600, opts.httpdup))));
  // MakeSMS não tem agendamento na API v2 (scheduledAt fica só na interface).
  const r = await velipPost("/MakeSMS", form, 15_000);
  const env = velipEnvelope((r.raw ?? {}) as Record<string, unknown>);
  const cdls_id = String(env.cdls_id ?? env.id ?? "") || undefined;
  const id = cdls_id === "0" ? undefined : cdls_id;
  // Doc: status_code 1 + status "WR" = aceito, ainda aguardando provedor.
  // Com cdls_id presente, considerar sucesso (não marcar failed no portal).
  const waiting = r.status_code === 1 || String(r.status || "").toUpperCase() === "WR";
  const ok = r.ok || (waiting && !!id) || (!!id && (r.status_code === 0 || r.status_code == null));
  return {
    ...r,
    ok,
    cdls_id: id,
    error: ok ? undefined : r.error,
  };
}

export async function getCallStatus(cd_id: string): Promise<RawResp & { called_status?: string }> {
  const form = new URLSearchParams();
  // cd_id no formato "<cdcs_db>_<id>" exatamente como veio do MakeTTSCall.
  form.set("cd_id", cd_id);
  const r = await velipPost("/GetCallStatus", form, 15_000);
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  // Resposta: `{"return": {...}, "calls": [{"cd_status": "OK"|"NA"|..., ...}]}`
  const calls = Array.isArray(raw.calls) ? (raw.calls as Record<string, unknown>[]) : [];
  const first = calls[0] ?? {};
  const called_status = String(
    first.cd_status ?? first.cd_called_status ?? raw.cd_called_status ?? "",
  ) || undefined;
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

/** Janela de discagem — sempre America/Sao_Paulo (Brasília), não o fuso do servidor. */
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
