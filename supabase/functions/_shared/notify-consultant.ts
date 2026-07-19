// Envia alerta WhatsApp para o próprio consultor quando algo dá errado
// (campanha, automação, validação de imagem, etc).
// Usa a instância Evolution do próprio consultor para mandar a mensagem
// para o número pessoal dele (consultants.phone).
import { adminClient } from "./fb-graph.ts";

export type AlertLevel = "info" | "warning" | "error";

const ICON: Record<AlertLevel, string> = {
  info: "ℹ️",
  warning: "⚠️",
  error: "🚨",
};

export async function notifyConsultant(
  consultantId: string,
  level: AlertLevel,
  title: string,
  body: string,
): Promise<boolean> {
  try {
    const evolutionUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");
    if (!evolutionUrl || !evolutionKey) {
      console.warn("[notify] Evolution não configurada — skip");
      return false;
    }

    const admin = adminClient();
    const { data: consultant } = await admin
      .from("consultants")
      .select("phone, notification_phone, name")
      .eq("id", consultantId)
      .maybeSingle();
    const targetPhone = (consultant as any)?.notification_phone || consultant?.phone;
    if (!targetPhone) {
      console.warn("[notify] consultor sem phone:", consultantId);
      return false;
    }

    const { data: inst } = await admin
      .from("whatsapp_instances")
      .select("instance_name, connected_phone")
      .eq("consultant_id", consultantId)
      .maybeSingle();
    if (!inst?.instance_name) {
      console.warn("[notify] consultor sem instance Evolution:", consultantId);
      return false;
    }

    // Normaliza número: só dígitos, garante DDI 55
    const digits = String(targetPhone).replace(/\D/g, "");
    const number = digits.startsWith("55") ? digits : `55${digits}`;

    const text = `${ICON[level]} *${title}*\n\n${body}\n\n_Mensagem automática iGreen_`;

    // INTENTIONAL: staff alert — bypasses anti-ban guard (notifica consultor sobre eventos críticos)
    const res = await fetch(`${evolutionUrl.replace(/\/+$/, "")}/message/sendText/${inst.instance_name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: evolutionKey },
      body: JSON.stringify({ number, text }),
    });
    if (!res.ok) {
      console.warn("[notify] Evolution falhou:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("[notify] erro:", (e as Error).message);
    return false;
  }
}

// ─── Envia texto bruto para o número de alertas ──
// Tenta Whapi primeiro (canal ativo hoje); cai em Evolution só se Whapi falhar/não configurado.
async function sendRawToAlertNumber(consultantId: string, text: string): Promise<boolean> {
  const admin = adminClient();
  const { data: consultant } = await admin
    .from("consultants")
    .select("phone, notification_phone")
    .eq("id", consultantId)
    .maybeSingle();
  const targetPhone = (consultant as any)?.notification_phone || consultant?.phone;
  if (!targetPhone) {
    console.warn("[notify-raw] consultor sem phone:", consultantId);
    return false;
  }
  return sendRawToNumber(consultantId, targetPhone, text);
}

// ─── Envia texto bruto para um número arbitrário usando a instância do consultor ──
// Mesma estratégia do sendRawToAlertNumber (Whapi primeiro, Evolution fallback),
// mas o destino é um telefone explícito (ex.: número de aviso de um parceiro).
export async function sendRawToNumber(
  consultantId: string,
  targetPhone: string,
  text: string,
): Promise<boolean> {
  const admin = adminClient();
  if (!targetPhone) {
    console.warn("[notify-raw] número de destino vazio");
    return false;
  }
  const digits = String(targetPhone).replace(/\D/g, "");
  const number = digits.startsWith("55") ? digits : `55${digits}`;
  const to = `${number}@s.whatsapp.net`;

  // 1) Whapi (canal ativo) — settings.whapi_token tem prioridade sobre env
  let whapiToken = Deno.env.get("WHAPI_TOKEN") || "";
  let whapiUrl = (Deno.env.get("WHAPI_API_URL") || "https://gate.whapi.cloud").replace(/\/+$/, "");
  try {
    const { data: whapiRows } = await admin
      .from("settings")
      .select("key, value")
      .in("key", ["whapi_token", "whapi_api_url"]);
    for (const r of (whapiRows as Array<{ key: string; value: unknown }> | null) || []) {
      const v = typeof r.value === "string" ? r.value : String(r.value ?? "");
      if (r.key === "whapi_token" && v) whapiToken = v;
      if (r.key === "whapi_api_url" && v) whapiUrl = v.replace(/\/+$/, "");
    }
  } catch { /* usa env */ }
  if (whapiToken) {
    try {
      const res = await fetch(`${whapiUrl}/messages/text`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${whapiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ to, body: text, typing_time: 1 }),
      });
      if (res.ok) {
        console.log(`✅ [notify-raw] enviado via whapi -> ${number}`);
        return true;
      }
      console.warn("[notify-raw] whapi falhou:", res.status, (await res.text()).slice(0, 200));
    } catch (e) {
      console.warn("[notify-raw] whapi erro:", (e as Error).message);
    }
  }

  // 2) Fallback Evolution
  try {
    const evolutionUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");
    if (!evolutionUrl || !evolutionKey) return false;
    const { data: inst } = await admin
      .from("whatsapp_instances")
      .select("instance_name, status")
      .eq("consultant_id", consultantId)
      .maybeSingle();
    if (!inst?.instance_name || inst.status === "needs_reconnect") return false;
    // INTENTIONAL: staff alert — bypasses anti-ban guard (notificação direta ao consultor)
    const res = await fetch(`${evolutionUrl.replace(/\/+$/, "")}/message/sendText/${inst.instance_name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: evolutionKey },
      body: JSON.stringify({ number, text }),
    });
    if (res.ok) {
      console.log(`✅ [notify-raw] enviado via evolution -> ${number}`);
      return true;
    }
    console.warn("[notify-raw] evolution falhou:", res.status);
    return false;
  } catch (e) {
    console.error("[notify-raw] evolution erro:", (e as Error).message);
    return false;
  }
}

function formatPhoneBR(raw?: string | null): string {
  if (!raw) return "(sem número)";
  const d = String(raw).replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw;
}

/** Link wa.me pronto para o parceiro abrir a conversa do lead. */
function waMeLink(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 10) return null;
  const number = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${number}`;
}

function nowBRT(): string {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

// Cache em memória para evitar duplicatas (key: consultant+type+customer, TTL 60s)
const recentAlerts = new Map<string, number>();
function shouldSend(key: string, ttlMs = 60_000): boolean {
  const now = Date.now();
  const last = recentAlerts.get(key);
  if (last && now - last < ttlMs) return false;
  recentAlerts.set(key, now);
  // GC simples
  if (recentAlerts.size > 500) {
    for (const [k, t] of recentAlerts) if (now - t > ttlMs) recentAlerts.delete(k);
  }
  return true;
}

// Dedup persistente via DB. O Map in-memory acima morre a cada cold-boot
// das Edge Functions (acontece a cada poucos segundos), então sem persistir
// o consultor recebia "NOVO LEAD CHEGOU" a cada mensagem do mesmo lead.
async function shouldSendPersisted(
  customerId: string | undefined,
  column: "last_new_lead_notified_at" | "last_handoff_notified_at" | "last_partner_notified_at",
  windowMs: number,
): Promise<boolean> {
  if (!customerId) return true; // sem id, deixa o cache em memória decidir
  try {
    const admin = adminClient();
    const { data } = await admin
      .from("customers")
      .select(column)
      .eq("id", customerId)
      .maybeSingle();
    const lastIso = (data as any)?.[column] as string | null | undefined;
    if (lastIso) {
      const last = new Date(lastIso).getTime();
      if (Date.now() - last < windowMs) return false;
    }
    await admin
      .from("customers")
      .update({ [column]: new Date().toISOString() } as any)
      .eq("id", customerId);
    return true;
  } catch (e) {
    console.warn("[notify dedup] erro, deixando passar:", (e as Error).message);
    return true;
  }
}

export async function notifyNewLead(
  consultantId: string,
  lead: { id?: string; name?: string | null; name_source?: string | null; phone_whatsapp?: string | null; is_sandbox?: boolean | null },
): Promise<boolean> {
  if (lead?.is_sandbox) {
    console.log(`[notify-new-lead] sandbox_skip lead=${lead.id}`);
    return false;
  }
  // Cache rápido em memória (evita dupla chamada no mesmo isolate)
  const memKey = `newlead:${consultantId}:${lead.id || lead.phone_whatsapp || ""}`;
  if (!shouldSend(memKey, 60_000)) return false;
  // Persistente: 24h por lead
  if (!(await shouldSendPersisted(lead.id, "last_new_lead_notified_at", 24 * 60 * 60_000))) {
    console.log(`[notify-new-lead] skip dedup-db lead=${lead.id}`);
    return false;
  }
  // Nome configurado da IA pelo consultor. Sem configuração, usa "Aline"
  // como padrão (persona oficial da iGreen) — nunca expor "Sua IA" genérico.
  let assistantName = "Aline";
  try {
    const admin = adminClient();
    const { data: c } = await admin
      .from("consultants")
      .select("assistant_name")
      .eq("id", consultantId)
      .maybeSingle();
    const nm = (c as any)?.assistant_name?.trim();
    if (nm) assistantName = nm;
  } catch (_e) { /* usa default */ }
  const text =
    `🎉 *Novo lead chegou!*\n` +
    `\n` +
    `👤 *Nome:* ${lead.name?.trim() || "(sem nome ainda)"}\n` +
    `📱 *WhatsApp:* ${formatPhoneBR(lead.phone_whatsapp)}\n` +
    `🕐 *Entrou:* ${nowBRT()}\n` +
    `🤖 *Atendido por:* ${assistantName} (IA)\n\n` +
    `${assistantName} já iniciou o atendimento. Acompanhe no painel.`;
  return sendRawToAlertNumber(consultantId, text);
}


export async function notifyHandoff(
  consultantId: string,
  lead: { id?: string; name?: string | null; name_source?: string | null; phone_whatsapp?: string | null; conversation_step?: string | null; is_sandbox?: boolean | null },
  lastQuestion: string,
  reason = "duvida_fora_faq",
): Promise<boolean> {
  if (lead?.is_sandbox) {
    console.log(`[notify-handoff] sandbox_skip lead=${lead.id}`);
    return false;
  }
  const memKey = `handoff:${consultantId}:${lead.id || lead.phone_whatsapp || ""}`;
  if (!shouldSend(memKey, 5 * 60_000)) return false;
  // Persistente: 30 min por lead
  if (!(await shouldSendPersisted(lead.id, "last_handoff_notified_at", 30 * 60_000))) {
    console.log(`[notify-handoff] skip dedup-db lead=${lead.id}`);
    return false;
  }
  const stepHuman = String(lead.conversation_step || "").replace(/^(ask_|aguardando_|editing_)/, "").replace(/_/g, " ") || "cadastro";
  const reasonLabel = reason === "duvida_fora_faq" ? "não soube responder a dúvida" : reason;
  const text =
    `🆘 *Lead precisa de você*\n` +
    `\n` +
    `👤 ${lead.name?.trim() || "(sem nome)"}\n` +
    `📱 ${formatPhoneBR(lead.phone_whatsapp)}\n` +
    `📍 *Passo:* ${stepHuman}\n\n` +
    `💬 *Última mensagem:*\n"${lastQuestion.slice(0, 300)}"\n\n` +
    `⚠️ A IA pausou porque ${reasonLabel}.\n` +
    `Assuma a conversa no CRM.`;
  const ok = await sendRawToAlertNumber(consultantId, text);
  // 📣 Espelha para o parceiro dono do lead (dedup próprio por lead × step).
  if (lead?.id) {
    notifyPartnerStep(consultantId, lead.id, "handoff", { note: reasonLabel })
      .catch((e) => console.warn("[notify-handoff] partner mirror:", (e as Error).message));
  }
  return ok;
}

// ─── Aviso: cliente respondeu enquanto o HUMANO está no atendimento ────────
// Quando o bot está pausado por handoff humano (assigned_human_id) e o cliente
// manda uma nova mensagem, o webhook só registra e fica em silêncio (correto —
// o robô não atropela o atendimento). O risco é o consultor não perceber a
// resposta e o lead esfriar. Aqui mandamos um ping discreto pro consultor.
//
// Dedup só em memória (janela 10 min): evita spam a cada mensagem da rajada sem
// exigir nova coluna no banco. Como o isolate recicla, no pior caso o consultor
// recebe um lembrete a mais — aceitável e melhor que perder o lead.
export type InboundNotifyKind = "text" | "image" | "audio" | "video" | "document" | "unknown";

function describeInboundKind(kind: InboundNotifyKind | undefined, lastMessage: string): {
  title: string;
  preview: string;
} {
  switch (kind) {
    case "image":
      return { title: "📷 Nova imagem recebida", preview: lastMessage?.trim() || "O cliente enviou uma foto." };
    case "audio":
      return { title: "🎤 Novo áudio recebido", preview: "O cliente enviou um áudio." };
    case "video":
      return { title: "🎬 Novo vídeo recebido", preview: "O cliente enviou um vídeo." };
    case "document":
      return { title: "📄 Novo documento recebido", preview: lastMessage?.trim() || "O cliente enviou um arquivo." };
    case "text":
    default:
      return {
        title: "💬 Nova mensagem recebida",
        preview: lastMessage?.trim()
          ? `"${String(lastMessage).slice(0, 280)}"`
          : "O cliente enviou uma mensagem.",
      };
  }
}

export async function notifyClientReplyWhilePaused(
  consultantId: string,
  lead: {
    id?: string;
    name?: string | null;
    name_source?: string | null;
    phone_whatsapp?: string | null;
    conversation_step?: string | null;
    tracking_protocol?: string | null;
    is_sandbox?: boolean | null;
  },
  lastMessage: string,
  opts?: { kind?: InboundNotifyKind },
): Promise<boolean> {
  try {
    if (!consultantId) return false;
    if (lead?.is_sandbox) return false;
    const memKey = `pausedreply:${consultantId}:${lead.id || lead.phone_whatsapp || ""}`;
    if (!shouldSend(memKey, 3 * 60_000)) return false;
    const stepHuman = String(lead.conversation_step || "")
      .replace(/^(ask_|aguardando_|editing_|flow:)/, "")
      .replace(/_/g, " ") || "atendimento";
    const { title, preview } = describeInboundKind(opts?.kind, lastMessage);
    const protocolLine = lead.tracking_protocol
      ? `📋 *Chamado:* ${lead.tracking_protocol}\n`
      : "";
    const text =
      `${title}\n` +
      `\n` +
      `👤 ${lead.name?.trim() || "(sem nome)"}\n` +
      `📱 ${formatPhoneBR(lead.phone_whatsapp)}\n` +
      protocolLine +
      `📍 *Etapa:* ${stepHuman}\n` +
      `🤖 *Bot DESLIGADO* neste lead — só religa no painel.\n` +
      `🕐 ${nowBRT()}\n\n` +
      `${preview}\n\n` +
      `_Atendimento humano ativo — responda no painel._`;
    return sendRawToAlertNumber(consultantId, text);
  } catch (e) {
    console.warn("[notify-paused-reply] erro:", (e as Error).message);
    return false;
  }
}

/**
 * Lead escreveu enquanto o bot NÃO pode falar (kill switch global ou IA do
 * consultor OFF). Inbound já foi/será salvo; só avisamos o responsável.
 */
export async function notifyInboundWhileBotOff(
  consultantId: string,
  lead: {
    id?: string;
    name?: string | null;
    name_source?: string | null;
    phone_whatsapp?: string | null;
    conversation_step?: string | null;
    tracking_protocol?: string | null;
    is_sandbox?: boolean | null;
  },
  lastMessage: string,
  opts?: { kind?: InboundNotifyKind; reason?: string },
): Promise<boolean> {
  try {
    if (!consultantId) return false;
    if (lead?.is_sandbox) return false;
    const memKey = `botoff:${consultantId}:${lead.id || lead.phone_whatsapp || ""}`;
    if (!shouldSend(memKey, 3 * 60_000)) return false;
    const stepHuman = String(lead.conversation_step || "")
      .replace(/^(ask_|aguardando_|editing_|flow:)/, "")
      .replace(/_/g, " ") || "entrada";
    const { title, preview } = describeInboundKind(opts?.kind, lastMessage);
    const why = opts?.reason || "bot_off";
    const text =
      `📩 *Lead escreveu — bot NÃO respondeu*\n` +
      `\n` +
      `👤 ${lead.name?.trim() || "(sem nome)"}\n` +
      `📱 ${formatPhoneBR(lead.phone_whatsapp)}\n` +
      `📍 *Etapa:* ${stepHuman}\n` +
      `🤖 Motivo: ${why}\n` +
      `🕐 ${nowBRT()}\n\n` +
      `${title}\n${preview}\n\n` +
      `_Mensagem gravada no painel. Responda manualmente ou religue o bot._`;
    return sendRawToAlertNumber(consultantId, text);
  } catch (e) {
    console.warn("[notify-bot-off] erro:", (e as Error).message);
    return false;
  }
}

// ─── Aviso ao PARCEIRO indicador / consultor parceiro ──────────────────────
// Quando um lead é atribuído a um parceiro (referral_partner_id) e esse
// parceiro tem notification_phone configurado, avisa o número dele que um
// cliente entrou em contato. É um aviso EXTRA — o consultor dono continua
// recebendo o seu via notifyNewLead. Usa a instância do consultor dono para
// enviar (Whapi/Evolution), igual aos outros alertas.
//
// Dedup persistente reaproveitado: 24h por lead (mesma janela do novo lead),
// porém com chave própria (last_partner_notified_at) para não colidir com o
// aviso do dono.
// ─── Resolve telefone do parceiro (notification_phone) ─────────────────────
async function resolvePartnerContact(
  partnerId: string,
  ownerConsultantId: string,
): Promise<{ phone: string | null; name: string | null }> {
  try {
    const admin = adminClient();
    const { data, error } = await admin
      .from("referral_partners")
      .select("nome, notification_phone, is_active, consultant_id")
      .eq("id", partnerId)
      .eq("consultant_id", ownerConsultantId)
      .maybeSingle();
    if (error) {
      console.warn("[resolve-partner-contact] query falhou:", error.message);
      return { phone: null, name: null };
    }
    if (!data || (data as any).is_active === false) return { phone: null, name: null };
    const phone = String((data as any).notification_phone || "").trim() || null;
    return { phone, name: (data as any).nome || null };
  } catch (e) {
    console.warn("[resolve-partner-contact] erro:", (e as Error).message);
    return { phone: null, name: null };
  }
}

// Dedup persistente (1× por parceiro × lead × etapa) via outbound_message_log.
async function dedupPartnerStep(
  customerId: string,
  partnerId: string,
  step: string,
): Promise<boolean> {
  try {
    const admin = adminClient();
    const idemKey = `partner_step:${partnerId}:${customerId}:${step}`;
    const { error } = await admin.from("outbound_message_log").insert({
      idempotency_key: idemKey,
      customer_id: customerId,
      result_status: `queued_partner_${step}`,
    });
    if (error) {
      if ((error as any)?.code === "23505") return false; // já avisado
      console.warn("[notify-partner-step] dedup log falhou:", error.message);
    }
    return true;
  } catch (e) {
    console.warn("[notify-partner-step] dedup erro:", (e as Error).message);
    return true;
  }
}

function partnerStepLabel(step: string): string {
  const map: Record<string, string> = {
    arrived: "Atendimento iniciado",
    bill_received: "Conta de luz recebida",
    cadastro_complete: "Dados do cliente completos",
    portal_sent: "Cadastro enviado à iGreen",
    handoff: "Precisa da sua atenção",
  };
  return map[step] || "Atualização do indicado";
}

/** Rodapé amigável do acompanhamento — sem nomes técnicos de step. */
function partnerFooter(step: string): string {
  const journey = [
    { key: "arrived", label: "Atendimento iniciado" },
    { key: "bill_received", label: "Conta de luz recebida" },
    { key: "cadastro_complete", label: "Dados completos" },
    { key: "portal_sent", label: "Enviado à iGreen" },
  ];
  const idx = journey.findIndex((s) => s.key === step);
  if (step === "handoff") {
    return `📍 *${partnerStepLabel("handoff")}*\n_Acompanhamento do seu indicado · iGreen_ 🌱`;
  }
  if (idx < 0) {
    return `_Acompanhamento do seu indicado · iGreen_ 🌱`;
  }
  return (
    `📍 Etapa *${idx + 1} de ${journey.length}* — ${journey[idx].label}\n` +
    `_Acompanhamento do seu indicado · iGreen_ 🌱`
  );
}

export async function notifyPartnerNewLead(
  ownerConsultantId: string,
  partnerId: string,
  lead: { id?: string; name?: string | null; name_source?: string | null; phone_whatsapp?: string | null; is_sandbox?: boolean | null; tracking_protocol?: string | null },
  opts?: { force?: boolean; manual?: boolean },
): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (lead?.is_sandbox) return { ok: false, reason: "sandbox" };
    if (!partnerId) return { ok: false, reason: "no_partner" };

    const { phone, name: partnerName } = await resolvePartnerContact(partnerId, ownerConsultantId);
    if (!phone) {
      console.warn(`[notify-partner-lead] parceiro ${partnerId} sem notification_phone`);
      return { ok: false, reason: "partner_no_phone" };
    }

    const force = opts?.force === true;
    const manual = opts?.manual === true;

    const memKey = `partnerlead:${partnerId}:${lead.id || lead.phone_whatsapp || ""}:${manual ? "manual" : "auto"}`;
    if (!force && !shouldSend(memKey, 60_000)) {
      return { ok: false, reason: "dedup_memory" };
    }

    // Dedup DB: só LÊ o timestamp. Só grava DEPOIS do envio OK —
    // antes marcava antes de enviar e, se o WhatsApp falhasse, o parceiro
    // ficava 24h sem receber o lead.
    if (!force && lead.id) {
      try {
        const { data: prev } = await adminClient()
          .from("customers")
          .select("last_partner_notified_at")
          .eq("id", lead.id)
          .maybeSingle();
        const lastIso = (prev as any)?.last_partner_notified_at as string | null | undefined;
        if (lastIso && Date.now() - new Date(lastIso).getTime() < 24 * 60 * 60_000) {
          console.log(`[notify-partner-lead] skip dedup-db lead=${lead.id}`);
          return { ok: false, reason: "dedup_db" };
        }
      } catch (e) {
        console.warn("[notify-partner-lead] dedup check falhou:", (e as Error).message);
      }
    }

    let protocol = (lead.tracking_protocol || "").trim();
    if (!protocol && lead.id) {
      try {
        const { data: cRow } = await adminClient()
          .from("customers")
          .select("tracking_protocol")
          .eq("id", lead.id)
          .maybeSingle();
        protocol = String((cRow as any)?.tracking_protocol || "").trim();
      } catch { /* ignore */ }
    }

    const hi = partnerName ? `Olá, ${partnerName.split(" ")[0]}! 👋\n\n` : "";
    const phoneNice = formatPhoneBR(lead.phone_whatsapp);
    const link = waMeLink(lead.phone_whatsapp);
    const title = manual ? "✅ *Lead atribuído a você!*" : "🎉 *Novo lead pra você!*";

    const lines = [
      `${hi}${title}`,
      ``,
      `👤 *Nome:* ${lead.name?.trim() || "(ainda coletando…)"}`,
      `📱 *WhatsApp:* ${phoneNice}`,
    ];
    if (link) lines.push(`🔗 *Abrir conversa:* ${link}`);
    lines.push(`🕐 *${manual ? "Atribuído" : "Chegou"}:* ${nowBRT()}`);
    if (protocol) {
      lines.push(``);
      lines.push(`📋 *Código:* \`${protocol}\``);
      lines.push(`_(só se precisar falar com o suporte)_`);
    }
    lines.push(``);
    if (manual) {
      lines.push(`📌 Atribuído pelo consultor — já é seu!`);
    } else {
      lines.push(`🤖 A Sofia já iniciou o atendimento e está coletando os dados.`);
      lines.push(`📲 Você recebe um aviso a cada etapa importante do cadastro — não o chat completo.`);
    }
    lines.push(``);
    lines.push(partnerFooter("arrived"));

    const text = lines.join("\n");

    const sent = await sendRawToNumber(ownerConsultantId, phone, text);
    if (!sent) {
      return { ok: false, reason: "send_failed" };
    }

    if (lead.id) {
      try {
        await adminClient()
          .from("customers")
          .update({ last_partner_notified_at: new Date().toISOString() })
          .eq("id", lead.id);
      } catch { /* ignore */ }
    }

    return { ok: true };
  } catch (e) {
    console.warn("[notify-partner-lead] erro:", (e as Error).message);
    return { ok: false, reason: (e as Error).message };
  }
}

// ─── Passo a passo do lead para o parceiro ─────────────────────────────────
// Dispara UMA mensagem por etapa (dedup por parceiro × lead × step). Se o
// customer tem `referral_partner_id`, o parceiro recebe atualização sempre
// que o lead avança: conta recebida → cadastro completo → enviado ao portal
// → (opcional) handoff.
export type PartnerStepKind =
  | "bill_received"
  | "cadastro_complete"
  | "portal_sent"
  | "handoff";

export async function notifyPartnerStep(
  ownerConsultantId: string,
  customerId: string,
  step: PartnerStepKind,
  extra?: { note?: string },
): Promise<boolean> {
  try {
    if (!ownerConsultantId || !customerId) return false;

    const admin = adminClient();
    const { data: customer } = await admin
      .from("customers")
      .select("id, name, phone_whatsapp, is_sandbox, referral_partner_id")
      .eq("id", customerId)
      .maybeSingle();
    if (!customer) return false;
    if ((customer as any).is_sandbox) return false;

    const partnerId = (customer as any).referral_partner_id as string | null;
    if (!partnerId) return false;

    const { phone, name: partnerName } = await resolvePartnerContact(partnerId, ownerConsultantId);
    if (!phone) return false;

    // Cache rápido em memória.
    const memKey = `partnerstep:${partnerId}:${customerId}:${step}`;
    if (!shouldSend(memKey, 60_000)) return false;
    // Dedup persistente.
    if (!(await dedupPartnerStep(customerId, partnerId, step))) {
      console.log(`[notify-partner-step] skip dedup step=${step} lead=${customerId}`);
      return false;
    }

    const lead = ((customer as any).name || "").trim() || "(sem nome)";
    const leadPhone = formatPhoneBR((customer as any).phone_whatsapp);
    const hi = partnerName ? `Olá, ${partnerName.split(" ")[0]}! 👋\n\n` : "";

    let title = "";
    let body = "";
    switch (step) {
      case "bill_received":
        title = `📄 *${partnerStepLabel("bill_received")}*`;
        body =
          `Recebemos a conta de luz de *${lead}* e já estamos analisando.\n\n` +
          `_Próxima etapa: completar os dados do cadastro._`;
        break;
      case "cadastro_complete":
        title = `🎯 *${partnerStepLabel("cadastro_complete")}*`;
        body =
          `Os dados de *${lead}* estão completos. ✅\n\n` +
          `_Próxima etapa: enviar o cadastro à iGreen._`;
        break;
      case "portal_sent":
        title = `🚀 *${partnerStepLabel("portal_sent")}*`;
        body =
          `O cadastro de *${lead}* foi enviado à iGreen. ✅\n\n` +
          `O cliente recebe o código de verificação no WhatsApp — ` +
          `cuidamos disso automaticamente.\n\n` +
          `Quando for aprovado, ele entra na sua carteira! 🎉`;
        break;
      case "handoff":
        title = `🆘 *${partnerStepLabel("handoff")}*`;
        body =
          `O atendimento de *${lead}* foi pausado porque ` +
          `${extra?.note || "surgiu uma dúvida que precisa de uma pessoa"}.\n\n` +
          `_Vale assumir a conversa no CRM enquanto o lead está quente._`;
        break;
    }

    const text =
      `${hi}${title}\n` +
      `\n` +
      `👤 ${lead}\n` +
      `📱 ${leadPhone}\n` +
      `🕐 ${nowBRT()}\n\n` +
      `${body}\n\n` +
      partnerFooter(step);

    return sendRawToNumber(ownerConsultantId, phone, text);
  } catch (e) {
    console.warn("[notify-partner-step] erro:", (e as Error).message);
    return false;
  }
}

// ─── Aviso ao SUPER ADMIN quando um lead whapi não bate em campanha clara ───
// Dispara quando o lead-attribution caiu em fallback (frase-âncora do Meta,
// pool única) ou ficou unmatched mesmo com regex de anúncio batendo. Serve
// pra o Rafael saber que algo no rastreio de campanhas está pendente.
// Dedup persistente por customer_id via `outbound_message_log.idempotency_key`
// (chave única) — nunca avisa 2x o mesmo lead.
export async function notifySuperAdminUnmatchedLead(
  superAdminConsultantId: string,
  lead: { id?: string; name?: string | null; name_source?: string | null; phone_whatsapp?: string | null; is_sandbox?: boolean | null },
  method: string,
  assignedPartnerName?: string | null,
): Promise<boolean> {
  try {
    if (!superAdminConsultantId || !lead?.id) return false;
    if (lead?.is_sandbox) return false;

    const admin = adminClient();
    const idemKey = `superadmin_fallback_alert:${lead.id}`;

    // Tenta dedup via insert idempotente. Se já existe, retorna sem enviar.
    const { error: insErr } = await admin
      .from("outbound_message_log")
      .insert({
        idempotency_key: idemKey,
        customer_id: lead.id,
        consultant_id: superAdminConsultantId,
        result_status: "queued_superadmin_alert",
      });
    if (insErr) {
      // conflict (23505) = já avisado, silencia
      const code = (insErr as any)?.code;
      if (code === "23505") {
        console.log(`[notify-superadmin] já avisado lead=${lead.id}`);
        return false;
      }
      console.warn("[notify-superadmin] insert log falhou:", insErr.message);
      // segue mesmo assim
    }

    const assigned = assignedPartnerName
      ? `Atribuído a: ${assignedPartnerName}`
      : `Atribuído ao fallback (você)`;

    const text =
      `⚠️ *Lead sem campanha clara*\n` +
      `\n` +
      `👤 ${lead.name?.trim() || "(sem nome)"}\n` +
      `📱 ${formatPhoneBR(lead.phone_whatsapp)}\n\n` +
      `🔎 Motivo: \`${method}\`\n` +
      `${assigned}.\n\n` +
      `_Confira se a campanha do anúncio está cadastrada com a frase de abertura correta._`;

    return sendRawToAlertNumber(superAdminConsultantId, text);
  } catch (e) {
    console.warn("[notify-superadmin] erro:", (e as Error).message);
    return false;
  }
}

// ─── Aviso ao dono quando lead vai para a FILA DE REVISÃO MANUAL ───────────
// Usado quando o rodízio não pôde ser aplicado com segurança (sem campanha
// identificada, pool vazia, erro na RPC). O lead **não** é distribuído — fica
// esperando o dono revisar e atribuir manualmente pelo /admin. Dedup por lead
// via `outbound_message_log.idempotency_key` (nunca avisa 2x o mesmo lead).
export async function notifyOwnerManualReview(
  ownerConsultantId: string,
  lead: { id?: string; name?: string | null; name_source?: string | null; phone_whatsapp?: string | null; is_sandbox?: boolean | null },
  reason:
    | "no_campaign_ctwa_phrase"
    | "rodizio_pool_empty"
    | "rodizio_rpc_error"
    | "no_campaign_generic",
): Promise<boolean> {
  try {
    if (!ownerConsultantId || !lead?.id) return false;
    if (lead?.is_sandbox) return false;

    const admin = adminClient();
    const idemKey = `owner_manual_review:${lead.id}`;

    const { error: insErr } = await admin
      .from("outbound_message_log")
      .insert({
        idempotency_key: idemKey,
        customer_id: lead.id,
        consultant_id: ownerConsultantId,
        result_status: "queued_manual_review_alert",
      });
    if (insErr) {
      const code = (insErr as any)?.code;
      if (code === "23505") return false; // já avisado
      console.warn("[notify-owner-review] insert log falhou:", insErr.message);
    }

    const reasonText: Record<string, string> = {
      no_campaign_ctwa_phrase:
        "Lead chegou do anúncio (frase genérica do Meta) sem AD ID, sem ctwa_clid e sem protocolo FB-xxxxx na mensagem. Com 2+ campanhas ativas o sistema não chuta — atribua manualmente ou garanta o protocolo na mensagem do anúncio.",
      rodizio_pool_empty: "A pool de rodízio dessa campanha está vazia ou inativa.",
      rodizio_rpc_error:
        "Erro técnico ao consultar o próximo parceiro da fila (o lead não foi distribuído).",
      no_campaign_generic: "Sinal genérico de anúncio detectado, mas sem campanha vinculada.",
    };

    const text =
      `🟡 *Lead para revisão manual*\n` +
      `\n` +
      `👤 ${lead.name?.trim() || "(sem nome)"}\n` +
      `📱 ${formatPhoneBR(lead.phone_whatsapp)}\n\n` +
      `❗ ${reasonText[reason] || reason}\n\n` +
      `✅ Para o rodízio rodar sozinho:\n` +
      `• Mensagem do anúncio com *Protocolo FB-xxxxx*\n` +
      `• Ou 1 única campanha com pool ativa\n\n` +
      `➡️ Painel Admin → Meus Parceiros → Fila de revisão.`;

    return sendRawToAlertNumber(ownerConsultantId, text);
  } catch (e) {
    console.warn("[notify-owner-review] erro:", (e as Error).message);
    return false;
  }
}


