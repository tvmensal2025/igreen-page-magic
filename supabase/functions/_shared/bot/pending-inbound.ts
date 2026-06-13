/**
 * Drena mensagens enfileiradas em customers.pending_inbound_* quando o lock
 * estava ocupado. Evita perder a 2ª mensagem de uma rajada.
 */

export type PendingInboundReplay = {
  messageId: string;
  messageText: string;
  isFile: boolean;
  isButton: boolean;
  buttonId: string | null;
};

function normalizeReplayText(raw: string, messageType: string): string {
  const t = String(raw || "").trim();
  if (!t) return "";
  if (t === "[arquivo]" || t === "[áudio]" || messageType === "image" || messageType === "document") {
    return "";
  }
  if (t.startsWith("[áudio]")) return t.replace(/^\[áudio\]\s*/i, "").trim();
  return t;
}

/** Lê e limpa pending_inbound; retorna null se não houver nada a drenar. */
export async function claimPendingInbound(
  supabase: any,
  customerId: string,
): Promise<PendingInboundReplay | null> {
  const { data: row } = await supabase
    .from("customers")
    .select("pending_inbound_message_id, pending_inbound_at")
    .eq("id", customerId)
    .maybeSingle();

  const pendingId = String((row as any)?.pending_inbound_message_id || "").trim();
  if (!pendingId) return null;

  const since = (row as any)?.pending_inbound_at
    ? new Date((row as any).pending_inbound_at).toISOString()
    : new Date(Date.now() - 10 * 60_000).toISOString();

  const { data: convs } = await supabase
    .from("conversations")
    .select("message_text, message_type, external_message_id, created_at")
    .eq("customer_id", customerId)
    .eq("message_direction", "inbound")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(8);

  const list = Array.isArray(convs) ? convs : [];
  let match = list.find((c: any) => String(c?.external_message_id || "") === pendingId);
  if (!match && list.length > 0) match = list[0];

  await supabase.rpc("clear_pending_inbound", { _customer_id: customerId });

  if (!match) {
    console.warn(`[pending-inbound] claim sem conversation customer=${customerId} id=${pendingId}`);
    return {
      messageId: pendingId,
      messageText: "",
      isFile: false,
      isButton: false,
      buttonId: null,
    };
  }

  const messageType = String((match as any).message_type || "text");
  const messageText = normalizeReplayText(String((match as any).message_text || ""), messageType);
  const isFile = messageType === "image" || messageType === "document" || messageText === "";
  const isButton = messageType === "button";

  return {
    messageId: pendingId,
    messageText,
    isFile,
    isButton,
    buttonId: isButton ? messageText : null,
  };
}

/** Processa até `maxTurns` mensagens pendentes em sequência. */
export async function drainPendingInboundTurns(
  supabase: any,
  customerId: string,
  processTurn: (replay: PendingInboundReplay) => Promise<void>,
  maxTurns = 3,
): Promise<number> {
  let drained = 0;
  for (let i = 0; i < maxTurns; i++) {
    const replay = await claimPendingInbound(supabase, customerId);
    if (!replay) break;
    if (!replay.messageText && !replay.isFile && !replay.isButton) {
      console.warn(`[pending-inbound] skip vazio customer=${customerId} id=${replay.messageId}`);
      continue;
    }
    drained++;
    await processTurn(replay);
  }
  return drained;
}
