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

/** true se há inbound enfileirado (lock ocupado / cascata de mídia em andamento). */
export async function customerHasPendingInbound(
  supabase: any,
  customerId: string,
): Promise<boolean> {
  if (!customerId) return false;
  try {
    const { data: row } = await supabase
      .from("customers")
      .select("pending_inbound_message_id")
      .eq("id", customerId)
      .maybeSingle();
    return !!String((row as any)?.pending_inbound_message_id || "").trim();
  } catch {
    return false;
  }
}

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

export type PendingInboundClaimOptions = {
  /**
   * Início do turno que segurou o lock. `pending_inbound_message_id` guarda
   * só o ÚLTIMO id enfileirado (o RPC sobrescreve), então usar o começo do
   * turno como janela é o que recupera a rajada inteira.
   */
  since?: string | null;
  /** Ids de mensagem já processados neste turno (não podem ser reprocessados). */
  excludeMessageIds?: string[];
  /** Ids de linha em `conversations` já processados (cobre inbound sem id). */
  excludeConversationIds?: string[];
  /** Teto de mensagens devolvidas nesta rodada. */
  max?: number;
};

export type PendingInboundBatchItem = PendingInboundReplay & {
  conversationId: string | null;
};

/**
 * Drena a rajada inteira: lê o marcador, devolve TODOS os inbounds ainda não
 * processados da janela (ordem cronológica) e limpa o marcador.
 *
 * Auditoria 2026-08: a versão anterior devolvia uma única mensagem e, quando
 * o id do marcador não batia com nenhuma linha, reproduzia o inbound mais
 * recente — perdendo as mensagens do meio da rajada e podendo repetir a
 * mensagem errada.
 */
export async function claimPendingInboundBatch(
  supabase: any,
  customerId: string,
  opts: PendingInboundClaimOptions = {},
): Promise<PendingInboundBatchItem[]> {
  if (!customerId) return [];
  const { data: row } = await supabase
    .from("customers")
    .select("pending_inbound_message_id, pending_inbound_at")
    .eq("id", customerId)
    .maybeSingle();

  const pendingId = String((row as any)?.pending_inbound_message_id || "").trim();
  if (!pendingId) return [];

  const windowStart = opts.since
    || ((row as any)?.pending_inbound_at
      ? new Date((row as any).pending_inbound_at).toISOString()
      : new Date(Date.now() - 10 * 60_000).toISOString());

  const { data: convs } = await supabase
    .from("conversations")
    .select("id, message_text, message_type, external_message_id, created_at")
    .eq("customer_id", customerId)
    .eq("message_direction", "inbound")
    .gte("created_at", windowStart)
    .order("created_at", { ascending: true })
    .limit(20);

  await supabase.rpc("clear_pending_inbound", { _customer_id: customerId });

  const skipMessageIds = new Set((opts.excludeMessageIds || []).filter(Boolean).map(String));
  const skipConversationIds = new Set((opts.excludeConversationIds || []).filter(Boolean).map(String));
  const seen = new Set<string>();
  const out: PendingInboundBatchItem[] = [];
  const max = Math.max(1, opts.max ?? 3);

  for (const c of Array.isArray(convs) ? convs : []) {
    const conversationId = (c as any)?.id ? String((c as any).id) : null;
    const externalId = String((c as any)?.external_message_id || "").trim();
    if (conversationId && skipConversationIds.has(conversationId)) continue;
    if (externalId && skipMessageIds.has(externalId)) continue;
    const dedupeKey = externalId || conversationId || "";
    if (dedupeKey && seen.has(dedupeKey)) continue;
    if (dedupeKey) seen.add(dedupeKey);

    const messageType = String((c as any).message_type || "text");
    const messageText = normalizeReplayText(String((c as any).message_text || ""), messageType);
    const isFile = messageType === "image" || messageType === "document" || messageText === "";
    const isButton = messageType === "button";
    if (!messageText && !isFile && !isButton) continue;

    out.push({
      messageId: externalId || pendingId,
      messageText,
      isFile,
      isButton,
      buttonId: isButton ? messageText : null,
      conversationId,
    });
    if (out.length >= max) break;
  }

  if (out.length === 0) {
    console.warn(`[pending-inbound] marcador sem inbound novo customer=${customerId} id=${pendingId}`);
  }
  return out;
}

/** Processa até `maxTurns` mensagens pendentes em sequência. */
export async function drainPendingInboundTurns(
  supabase: any,
  customerId: string,
  processTurn: (replay: PendingInboundReplay) => Promise<void>,
  maxTurns = 3,
  opts: PendingInboundClaimOptions = {},
): Promise<number> {
  let drained = 0;
  const seenMessageIds = [...(opts.excludeMessageIds || [])];
  const seenConversationIds = [...(opts.excludeConversationIds || [])];

  // Cada rodada consome a rajada acumulada; novas mensagens que chegarem
  // durante o replay reaparecem no marcador e entram na rodada seguinte.
  for (let round = 0; round < maxTurns && drained < maxTurns; round++) {
    const batch = await claimPendingInboundBatch(supabase, customerId, {
      since: opts.since ?? null,
      excludeMessageIds: seenMessageIds,
      excludeConversationIds: seenConversationIds,
      max: maxTurns - drained,
    });
    if (batch.length === 0) break;
    for (const replay of batch) {
      if (replay.messageId) seenMessageIds.push(replay.messageId);
      if (replay.conversationId) seenConversationIds.push(replay.conversationId);
      drained++;
      await processTurn(replay);
    }
  }
  return drained;
}
