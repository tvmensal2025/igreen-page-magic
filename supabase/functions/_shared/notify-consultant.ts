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
  const digits = String(targetPhone).replace(/\D/g, "");
  const number = digits.startsWith("55") ? digits : `55${digits}`;
  const to = `${number}@s.whatsapp.net`;

  // 1) Whapi (canal ativo)
  const whapiToken = Deno.env.get("WHAPI_TOKEN");
  const whapiUrl = (Deno.env.get("WHAPI_API_URL") || "https://gate.whapi.cloud").replace(/\/+$/, "");
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
  column: "last_new_lead_notified_at" | "last_handoff_notified_at",
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
  lead: { id?: string; name?: string | null; phone_whatsapp?: string | null; is_sandbox?: boolean | null },
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
  const text =
    `🎉 *NOVO LEAD CHEGOU!*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 *Nome:* ${lead.name?.trim() || "(sem nome ainda)"}\n` +
    `📱 *WhatsApp:* ${formatPhoneBR(lead.phone_whatsapp)}\n` +
    `🕐 *Entrou em:* ${nowBRT()}\n\n` +
    `🤖 A IA Camila já iniciou o atendimento.\n` +
    `Acompanhe no painel do CRM.`;
  return sendRawToAlertNumber(consultantId, text);
}

export async function notifyHandoff(
  consultantId: string,
  lead: { id?: string; name?: string | null; phone_whatsapp?: string | null; conversation_step?: string | null; is_sandbox?: boolean | null },
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
    `🆘 *LEAD PRECISA DE VOCÊ*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 ${lead.name?.trim() || "(sem nome)"}\n` +
    `📱 ${formatPhoneBR(lead.phone_whatsapp)}\n` +
    `📍 *Passo:* ${stepHuman}\n\n` +
    `💬 *Última mensagem:*\n"${lastQuestion.slice(0, 300)}"\n\n` +
    `⚠️ A IA pausou porque ${reasonLabel}.\n` +
    `Assuma a conversa no CRM.`;
  return sendRawToAlertNumber(consultantId, text);
}