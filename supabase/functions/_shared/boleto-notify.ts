/**
 * Aviso "boleto chegou" → iGreen Club.
 * Copy leigo: NÃO usar a palavra "PDF" em textos ao cliente.
 *
 * Pacote (toggles):
 * - send_audio / send_text — áudio e/ou texto
 * - button_enabled — opt-in do botão "Receber boleto" (arquivo no Zap)
 * - Apps Android/iOS — SEMPRE (mensagem própria com links das lojas)
 */
import { safeFirstNameForAddress } from "./customer-display-name.ts";
import {
  doDaConsultor,
  oAConsultor,
  possessiveConsultantFallback,
  resolveAssistantDisplayName,
  resolveConsultantRoleGender,
  resolvePublicConsultantFirstName,
} from "./consultant-public-label.ts";
import { hourBRT } from "./quiet-hours.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

/** Id interno do botão (nunca mostrado ao cliente). */
export const BOLETO_RECEBER_DOC_BUTTON_ID = "boleto_receber_doc";
export const BOLETO_APP_ANDROID_BUTTON_ID = "boleto_app_android";
export const BOLETO_APP_IOS_BUTTON_ID = "boleto_app_ios";

export const BOLETO_CHEGOU_STAGE_PREFIX = "boleto_chegou:";

/** Apps oficiais iGreen Club (worker-club/APP-LINKS-CLIENTE.md). */
export const IGREEN_CLUB_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.embarcadero.iGreenConnect";
export const IGREEN_CLUB_APP_STORE_URL =
  "https://apps.apple.com/br/app/igreen-club/id6444493340";

export type BoletoNotifyConfig = {
  id: string;
  sync_enabled: boolean;
  cron_hour_brt: number;
  cron_daily: boolean;
  audio_script: string;
  wa_text: string;
  /** Enviar áudio Sofia. */
  send_audio: boolean;
  /** Enviar texto (mensagem formatada). */
  send_text: boolean;
  button_boleto_label: string;
  /** Opt-in: botão que manda o arquivo no Zap. */
  button_enabled: boolean;
  doc_caption: string;
};

/**
 * Corpo do áudio (a abertura “Olá, Nome! Tudo bem?” é prefixada no envio).
 * Variáveis: {{assistente}} (IA do consultor), {{posse_consultor}} (do Rafael / da Ana),
 * {{chamar_consultor}} (o Rafael / a Ana / o seu consultor).
 */
export const DEFAULT_BOLETO_AUDIO_BODY =
  `Aqui é {{assistente}}, assistente virtual {{posse_consultor}}, e estou passando com uma notícia importante: o seu boleto de energia deste mês já está disponível!

A iGreen realiza o envio oficial do boleto, mas o jeito mais seguro, rápido e completo de acompanhar tudo é pelo aplicativo iGreen Club.

Acesse o app para conferir a sua fatura, a data de vencimento e aproveitar descontos especiais em farmácias, restaurantes, cinemas e milhares de estabelecimentos parceiros.

E olha que notícia incrível: hoje, já somos mais de oitocentas mil pessoas economizando com a iGreen! É muita gente economizando junto!

Se precisar de ajuda, é só chamar {{chamar_consultor}}. Até mais!`;

export const DEFAULT_BOLETO_NOTIFY_CONFIG: BoletoNotifyConfig = {
  id: "global",
  sync_enabled: true,
  cron_hour_brt: 8,
  cron_daily: true,
  audio_script: DEFAULT_BOLETO_AUDIO_BODY,
  wa_text: `{{saudacao}}seu boleto de *{{mes}}* já está disponível 💚

Valor: *R$ {{valor}}*
Vencimento: *{{vencimento}}*

A iGreen cuida do envio oficial do boleto. Aqui o nosso recado é te lembrar e te levar ao lugar mais completo: o app *iGreen Club*.

Qualquer dúvida, responde aqui 💚`,
  send_audio: true,
  send_text: true,
  button_boleto_label: "Receber boleto",
  /** Default off — empresa já manda o boleto; toggle libera o arquivo no Zap. */
  button_enabled: false,
  doc_caption: "Segue seu boleto. O lugar oficial continua no app iGreen Club 👆",
};

/** Vars do roteiro de áudio — IA e consultor por conta (nunca Sofia/Rafael fixos). */
export function resolveBoletoAudioConsultantVars(opts: {
  assistantName?: string | null;
  consultantName?: string | null;
  consultantDisplayName?: string | null;
  consultantGender?: string | null;
}): { assistente: string; posse_consultor: string; chamar_consultor: string } {
  const assistente = resolveAssistantDisplayName(opts.assistantName);
  const gender = resolveConsultantRoleGender(
    opts.consultantGender,
    opts.consultantName || opts.consultantDisplayName,
  );
  const first = resolvePublicConsultantFirstName(
    opts.consultantName,
    opts.consultantDisplayName,
  );
  const doDa = doDaConsultor(gender);
  const oA = oAConsultor(gender);
  if (first) {
    return {
      assistente,
      posse_consultor: `${doDa} ${first}`,
      chamar_consultor: `${oA} ${first}`,
    };
  }
  const posse = possessiveConsultantFallback(gender);
  return {
    assistente,
    posse_consultor: `${doDa} ${posse}`,
    chamar_consultor: posse,
  };
}

export function renderBoletoAudioBody(
  audioBody: string,
  vars: { assistente: string; posse_consultor: string; chamar_consultor: string },
): string {
  return String(audioBody || DEFAULT_BOLETO_AUDIO_BODY)
    .replace(/\{\{assistente\}\}/gi, vars.assistente)
    .replace(/\{\{posse_consultor\}\}/gi, vars.posse_consultor)
    .replace(/\{\{chamar_consultor\}\}/gi, vars.chamar_consultor)
    .replace(/\{\{consultor\}\}/gi, vars.chamar_consultor)
    .trim();
}

/**
 * Áudio falado = “Olá, Nome! Tudo bem?” (canônico) + corpo com IA/consultor do dono.
 * Sem nome usável do cliente → só o corpo (sem inventar saudação).
 */
export function buildBoletoAudioSpoken(opts: {
  audioBody: string;
  name?: string | null;
  nameSource?: string | null;
  assistantName?: string | null;
  consultantName?: string | null;
  consultantDisplayName?: string | null;
  consultantGender?: string | null;
}): string {
  const vars = resolveBoletoAudioConsultantVars(opts);
  let body = renderBoletoAudioBody(opts.audioBody, vars);
  // Remove saudação colada no corpo (roteiros antigos "Oi! Tudo bem?") — a abertura canônica manda.
  body = body.replace(/^(Oi|Olá)([!,]\s*[^!]*)?!?\s*Tudo bem\?\s*/i, "").trim();
  const first = safeFirstNameForAddress(opts.name, opts.nameSource);
  if (!first) return body;
  return `Olá, ${first}! Tudo bem? ${body}`;
}

export async function loadConsultantForBoletoAudio(
  supabase: SB,
  consultantId: string,
): Promise<{
  assistantName: string | null;
  consultantName: string | null;
  consultantDisplayName: string | null;
  consultantGender: string | null;
}> {
  try {
    const { data } = await supabase
      .from("consultants")
      .select("name, display_name, assistant_name, gender")
      .eq("id", consultantId)
      .maybeSingle();
    return {
      assistantName: data?.assistant_name ?? null,
      consultantName: data?.name ?? null,
      consultantDisplayName: data?.display_name ?? null,
      consultantGender: data?.gender ?? null,
    };
  } catch {
    return {
      assistantName: null,
      consultantName: null,
      consultantDisplayName: null,
      consultantGender: null,
    };
  }
}

/**
 * Convite do botão, sempre em mensagem própria (nunca colado no texto longo).
 * Whapi vira quick_reply; Evolution vira "*1.* <label>" numa mensagem curta.
 */
export function buildBoletoButtonPrompt(buttonLabel?: string | null): string {
  const label = String(buttonLabel || "Receber boleto").trim() || "Receber boleto";
  return `Quer o boleto aqui no Zap? É só tocar em *${label}* 👇`;
}

/**
 * Remove a chamada do botão do corpo do texto. Configs antigas (e textos que o
 * consultor editar) ainda terminam com "toque em Receber boleto (ou digite 1)";
 * sem isso o convite apareceria duas vezes.
 */
export function stripBoletoButtonCta(waText: string): string {
  return String(waText || "")
    .split("\n")
    .filter((line) => !/(toque|clique|digite|responda)[^\n]*\b(receber\s+boleto|\*1\*)\b/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** E-mail de acesso válido, ou null (não inventa nem mostra lixo). */
export function normalizeClubAccessEmail(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return null;
  return s;
}

/**
 * E-mail de acesso do cliente. O objeto vindo dos webhooks não garante a
 * coluna `email`, então busca no banco quando não veio.
 */
export async function fetchCustomerAccessEmail(
  supabase: SB,
  customerId: string,
  known?: string | null,
): Promise<string | null> {
  const norm = normalizeClubAccessEmail(known);
  if (norm) return norm;
  if (!customerId) return null;
  try {
    const { data } = await supabase
      .from("customers")
      .select("email")
      .eq("id", customerId)
      .maybeSingle();
    return normalizeClubAccessEmail(data?.email);
  } catch {
    return null;
  }
}

/**
 * Como o cliente entra no app. Nunca o link com id — a empresa já manda o
 * boleto e o acesso do Club é pelo e-mail do cadastro.
 */
export function buildClubAccessLine(emailAcesso?: string | null): string {
  const email = normalizeClubAccessEmail(emailAcesso);
  if (email) return `Seu acesso é o e-mail *${email}*`;
  return "Para entrar, use o e-mail do seu cadastro.";
}

/** Prompt curto p/ Whapi (botões reais Android / iPhone). */
export function buildAppStoreButtonsPrompt(emailAcesso?: string | null): string {
  return `📱 *Baixe o iGreen Club* — qual celular você usa?

${buildClubAccessLine(emailAcesso)}

Toque no botão 👇`;
}

/**
 * Evolution (sem botão visual): lista numerada com links clicáveis.
 * Não usar sendChoice aqui — ele re-numera e esconde as URLs.
 */
export function buildAppStoreNumberedMessage(emailAcesso?: string | null): string {
  return `📱 *Baixe o iGreen Club — escolha seu celular:*

*1.* 🤖 *Android* (Play Store)
${IGREEN_CLUB_PLAY_STORE_URL}

*2.* 🍎 *iPhone* (App Store)
${IGREEN_CLUB_APP_STORE_URL}

${buildClubAccessLine(emailAcesso)}

_Digite *1* ou *2*, ou toque no link._`;
}

/** @deprecated — preferir buttons/numbered específicos do canal. */
export function buildAppStoreInviteMessage(emailAcesso?: string | null): string {
  return buildAppStoreNumberedMessage(emailAcesso);
}

export function boletoAppStoreChoiceOptions(): Array<{ id: string; title: string }> {
  return [
    { id: BOLETO_APP_ANDROID_BUTTON_ID, title: "Android" },
    { id: BOLETO_APP_IOS_BUTTON_ID, title: "iPhone" },
  ];
}

/**
 * Clique Android/iPhone (Whapi buttonId) ou texto "android"/"iphone".
 * Evolution: links já vão na lista numerada — não usa "1"/"2" aqui
 * (conflita com Receber boleto = *1*).
 */
export function resolveBoletoAppStoreChoice(opts: {
  buttonId?: string | null;
  text?: string | null;
}): "android" | "ios" | null {
  const id = String(opts.buttonId || "").trim().toLowerCase();
  if (id === BOLETO_APP_ANDROID_BUTTON_ID) return "android";
  if (id === BOLETO_APP_IOS_BUTTON_ID) return "ios";

  const raw = String(opts.text || "").trim().toLowerCase();
  if (!raw) return null;
  if (/^(android|play\s*store)$/i.test(raw)) return "android";
  if (/^(iphone|ios|app\s*store)$/i.test(raw)) return "ios";
  return null;
}

export function buildAppStoreLinkReply(
  kind: "android" | "ios",
  emailAcesso?: string | null,
): string {
  const acesso = buildClubAccessLine(emailAcesso);
  if (kind === "android") {
    return `🤖 *Android — Play Store:*
${IGREEN_CLUB_PLAY_STORE_URL}

${acesso}`;
  }
  return `🍎 *iPhone — App Store:*
${IGREEN_CLUB_APP_STORE_URL}

${acesso}`;
}

export function boletoChegouStageKey(mesReferencia: string): string {
  const mes = String(mesReferencia || "").trim();
  return `${BOLETO_CHEGOU_STAGE_PREFIX}${mes || "sem-mes"}`;
}

export function parseMesFromStageKey(stageKey: string): string | null {
  if (!stageKey.startsWith(BOLETO_CHEGOU_STAGE_PREFIX)) return null;
  const mes = stageKey.slice(BOLETO_CHEGOU_STAGE_PREFIX.length).trim();
  return mes || null;
}

/**
 * @deprecated Não usar em mensagem ao cliente: o acesso ao Club vai pelo
 * e-mail do cadastro (buildClubAccessLine). Mantido para telas internas.
 */
export function buildClubLink(igreenId: string | number | null | undefined): string {
  const id = String(igreenId ?? "").replace(/\D/g, "");
  return id ? `https://club.igreenenergy.com.br/?id=${id}` : "https://club.igreenenergy.com.br/";
}

export function formatBoletoValor(total: unknown): string {
  const n = typeof total === "number" ? total : Number(total);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatBoletoVencimento(raw: unknown): string {
  const s = String(raw || "").trim();
  if (!s) return "—";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  return s;
}

export function renderBoletoNotifyTemplate(
  raw: string,
  vars: {
    name?: string | null;
    nameSource?: string | null;
    mes?: string | null;
    valor?: string | null;
    vencimento?: string | null;
    emailAcesso?: string | null;
    linkPlay?: string | null;
    linkAppStore?: string | null;
    urlBoleto?: string | null;
  },
): string {
  const first = safeFirstNameForAddress(vars.name, vars.nameSource);
  const saudacao = first ? `Oi ${first}, ` : "";
  const emailAcesso = normalizeClubAccessEmail(vars.emailAcesso) || "";
  return String(raw || "")
    .replace(/\{\{saudacao\}\}/gi, saudacao)
    .replace(/\{\{nome\}\}/gi, first || "")
    .replace(/\{\{mes\}\}/gi, String(vars.mes || "—"))
    .replace(/\{\{valor\}\}/gi, String(vars.valor || "—"))
    .replace(/\{\{vencimento\}\}/gi, String(vars.vencimento || "—"))
    .replace(/\{\{email_acesso\}\}/gi, emailAcesso)
    // Legado: textos salvos antes da mudança traziam o link com id do cliente.
    .replace(/\{\{link_club\}\}/gi, emailAcesso)
    .replace(/\{\{link_play\}\}/gi, String(vars.linkPlay || IGREEN_CLUB_PLAY_STORE_URL))
    .replace(/\{\{link_appstore\}\}/gi, String(vars.linkAppStore || IGREEN_CLUB_APP_STORE_URL))
    .replace(/\{\{url_boleto\}\}/gi, String(vars.urlBoleto || ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function loadBoletoNotifyConfig(supabase: SB): Promise<BoletoNotifyConfig> {
  try {
    const { data, error } = await supabase
      .from("boleto_notify_config")
      .select("*")
      .eq("id", "global")
      .maybeSingle();
    if (error || !data) return { ...DEFAULT_BOLETO_NOTIFY_CONFIG };
    return {
      ...DEFAULT_BOLETO_NOTIFY_CONFIG,
      ...data,
      audio_script: String(data.audio_script || DEFAULT_BOLETO_NOTIFY_CONFIG.audio_script),
      wa_text: String(data.wa_text || DEFAULT_BOLETO_NOTIFY_CONFIG.wa_text),
      button_boleto_label: String(data.button_boleto_label || "Receber boleto").slice(0, 25),
      doc_caption: String(data.doc_caption || DEFAULT_BOLETO_NOTIFY_CONFIG.doc_caption),
      cron_hour_brt: Number.isFinite(Number(data.cron_hour_brt))
        ? Math.max(0, Math.min(23, Number(data.cron_hour_brt)))
        : 8,
      cron_daily: data.cron_daily !== false,
      sync_enabled: data.sync_enabled !== false,
      send_audio: data.send_audio !== false,
      send_text: data.send_text !== false,
      // Opt-in explícito: default off (empresa já manda o boleto no Zap).
      button_enabled: data.button_enabled === true,
    };
  } catch {
    return { ...DEFAULT_BOLETO_NOTIFY_CONFIG };
  }
}

/** true se o tick deve rodar sync/envio nesta hora BRT. */
export function shouldRunBoletoNotifyNow(
  cfg: Pick<BoletoNotifyConfig, "cron_hour_brt" | "cron_daily">,
  now: Date = new Date(),
): boolean {
  if (hourBRT(now) !== cfg.cron_hour_brt) return false;
  if (cfg.cron_daily) return true;
  // dias úteis BRT (seg=1 … sex=5); 0=dom … 6=sáb
  const day = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }),
  ).getDay();
  return day >= 1 && day <= 5;
}

/**
 * Detecta clique/número pedindo o boleto no Zap.
 * Whapi: buttonId = boleto_receber_doc
 * Evolution: "1" ou texto do label (ex. "Receber boleto")
 */
export function isBoletoReceberDocIntent(opts: {
  buttonId?: string | null;
  text?: string | null;
  buttonLabel?: string | null;
}): boolean {
  const id = String(opts.buttonId || "").trim().toLowerCase();
  if (id === BOLETO_RECEBER_DOC_BUTTON_ID) return true;

  const raw = String(opts.text || "").trim().toLowerCase();
  if (!raw) return false;
  if (raw === "1" || raw === "1." || raw === "*1*" || raw === "*1.*") return true;

  const label = String(opts.buttonLabel || "Receber boleto")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const norm = raw.replace(/\s+/g, " ");
  if (label && (norm === label || norm.includes(label))) return true;
  // sinônimos leigos (sem "pdf")
  if (/^(quero\s+)?(o\s+)?boleto(\s+aqui)?$/i.test(norm)) return true;
  if (/receber\s+boleto/i.test(norm)) return true;
  return false;
}

/** Boleto já quitado no portal iGreen — não avisar "chegou". */
export function isBoletoStatusPago(status?: string | null): boolean {
  const s = String(status || "").toLowerCase();
  if (!s) return false;
  return (
    s.includes("pago") ||
    s.includes("baixad") ||
    s.includes("liquidad") ||
    s.includes("quitad")
  );
}

export type NewBoletoCandidate = {
  idcliente: number;
  mes_referencia: string;
  url_boleto: string | null;
  total: number | null;
  vencimento: string | null;
  nome: string | null;
  customer_id: string | null;
  status?: string | null;
};

/**
 * Enfileira avisos idempotentes em customer_auto_message_log.
 * status inicial: claimed (dispatcher envia) — sem WA no sync.
 */
export async function enqueueBoletoChegouCandidates(
  supabase: SB,
  consultantId: string,
  candidates: NewBoletoCandidate[],
): Promise<{ queued: number; skipped_pago: number }> {
  if (!consultantId || !candidates.length) return { queued: 0, skipped_pago: 0 };

  let queued = 0;
  let skippedPago = 0;
  for (const c of candidates) {
    if (!c.customer_id || !c.mes_referencia) continue;
    // Boleto que já chegou pago não vira aviso de cobrança.
    if (isBoletoStatusPago(c.status)) {
      skippedPago += 1;
      continue;
    }
    const stageKey = boletoChegouStageKey(c.mes_referencia);
    const preview = [
      `boleto ${c.mes_referencia}`,
      c.total != null ? `R$ ${formatBoletoValor(c.total)}` : null,
      c.url_boleto ? "com link" : "sem link",
    ]
      .filter(Boolean)
      .join(" · ");

    const { error } = await supabase.from("customer_auto_message_log").upsert(
      {
        customer_id: c.customer_id,
        consultant_id: consultantId,
        stage_key: stageKey,
        status: "claimed",
        customer_name: c.nome || null,
        message_preview: preview.slice(0, 240),
      },
      { onConflict: "customer_id,stage_key", ignoreDuplicates: true },
    );
    if (!error) queued += 1;
    else if (!String(error.message || "").includes("duplicate")) {
      console.warn("[boleto-notify] enqueue:", error.message);
    }
  }
  return { queued, skipped_pago: skippedPago };
}

/** Busca url_boleto do mês (ou o mais recente aberto) para o clique. */
export async function resolveBoletoDocUrl(
  supabase: SB,
  customerId: string,
  mesReferencia?: string | null,
): Promise<{ url: string | null; mes: string | null }> {
  let q = supabase
    .from("igreen_customer_boletos")
    .select("url_boleto, mes_referencia, status, synced_at")
    .eq("customer_id", customerId)
    .not("url_boleto", "is", null)
    .order("synced_at", { ascending: false })
    .limit(5);

  if (mesReferencia) {
    q = supabase
      .from("igreen_customer_boletos")
      .select("url_boleto, mes_referencia, status, synced_at")
      .eq("customer_id", customerId)
      .eq("mes_referencia", mesReferencia)
      .not("url_boleto", "is", null)
      .order("synced_at", { ascending: false })
      .limit(1);
  }

  const { data } = await q;
  const rows = (data || []) as Array<{
    url_boleto: string | null;
    mes_referencia: string | null;
    status: string | null;
  }>;
  for (const r of rows) {
    if (isBoletoStatusPago(r.status)) continue;
    if (r.url_boleto) return { url: String(r.url_boleto), mes: r.mes_referencia };
  }
  const first = rows[0];
  if (first?.url_boleto) {
    return { url: String(first.url_boleto), mes: first.mes_referencia };
  }
  return { url: null, mes: null };
}

/**
 * Handler inbound: cliente pediu o boleto no Zap.
 * Retorna handled=true para consumir o turno (não cair no canal genérico).
 */
export async function tryHandleBoletoReceberDoc(opts: {
  supabase: SB;
  customer: {
    id: string;
    igreen_code?: string | number | null;
    name?: string | null;
    name_source?: string | null;
    email?: string | null;
  };
  buttonId?: string | null;
  text?: string | null;
  sendDocument: (url: string, caption: string) => Promise<boolean>;
  sendText: (text: string) => Promise<boolean>;
}): Promise<{ handled: boolean; sent: boolean; reason: string }> {
  const cfg = await loadBoletoNotifyConfig(opts.supabase);
  if (!isBoletoReceberDocIntent({
    buttonId: opts.buttonId,
    text: opts.text,
    buttonLabel: cfg.button_boleto_label,
  })) {
    return { handled: false, sent: false, reason: "not_intent" };
  }

  // Preferir mês do último aviso enviado
  let mes: string | null = null;
  const { data: lastLog } = await opts.supabase
    .from("customer_auto_message_log")
    .select("stage_key, status, created_at")
    .eq("customer_id", opts.customer.id)
    .like("stage_key", `${BOLETO_CHEGOU_STAGE_PREFIX}%`)
    .in("status", ["sent", "claimed", "partial"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastLog?.stage_key) mes = parseMesFromStageKey(String(lastLog.stage_key));

  const emailAcesso = await fetchCustomerAccessEmail(
    opts.supabase,
    opts.customer.id,
    opts.customer.email,
  );

  const resolved = await resolveBoletoDocUrl(opts.supabase, opts.customer.id, mes);
  if (!resolved.url) {
    await opts.sendText(
      `Não achei o boleto agora. Confira no aplicativo *iGreen Club*.\n\n${
        buildClubAccessLine(emailAcesso)
      }`,
    );
    return { handled: true, sent: true, reason: "no_url" };
  }

  const caption = renderBoletoNotifyTemplate(cfg.doc_caption, {
    name: opts.customer.name,
    nameSource: opts.customer.name_source,
    mes: resolved.mes,
    emailAcesso,
  });
  const ok = await opts.sendDocument(resolved.url, caption);
  return { handled: true, sent: ok, reason: ok ? "sent_doc" : "send_failed" };
}

/** FAQ leve quando o cliente demonstra medo/dúvida de boleto. */
export function isBoletoFearOrDoubtText(text: string | null | undefined): boolean {
  const t = String(text || "").toLowerCase();
  if (!t) return false;
  return (
    /\bboleto\b/.test(t) ||
    /\bfatura\b/.test(t) ||
    /\bgolpe\b/.test(t) ||
    /é\s+golpe/.test(t) ||
    /esse\s+link/.test(t) ||
    /verdade\??/.test(t) ||
    /confiar/.test(t)
  );
}

export function buildBoletoFearFaqReply(opts: {
  name?: string | null;
  nameSource?: string | null;
  igreenCode?: string | number | null;
  email?: string | null;
}): string {
  const first = safeFirstNameForAddress(opts.name, opts.nameSource);
  const oi = first ? `Oi ${first}, ` : "";
  return `${oi}pode ficar tranquilo(a) 💚

É o *boleto normal* da sua energia iGreen do mês — a empresa cuida do envio oficial.

O lugar mais seguro e completo para conferir é o aplicativo *iGreen Club*.

${buildClubAccessLine(opts.email)}

Qualquer dúvida, responde aqui.`;
}
