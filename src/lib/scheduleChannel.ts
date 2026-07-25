/**
 * Instância gravada em `scheduled_messages.instance_name` conforme o canal
 * do consultor conectado: Whapi → whapi-superadmin; Evolution → instanceName.
 *
 * Exige conexão real (`isConnected`) para não agendar em Evolution offline.
 */
export type ScheduleChannelReady =
  | { ok: true; instanceName: string; channel: "whapi" | "evolution" }
  | { ok: false; reason: string; pending: "whatsapp_disconnected" | "channel_unknown" };

export function resolveScheduleChannel(opts: {
  isWhapi?: boolean;
  instanceName?: string | null;
  /** false = QR/desconectado / needs_reconnect — não permite agendar. */
  isConnected?: boolean;
}): ScheduleChannelReady {
  if (opts.isWhapi) {
    if (opts.isConnected === false) {
      return {
        ok: false,
        reason:
          "WhatsApp desconectado ou indisponível. Reconecte na aba Conversas e agende de novo.",
        pending: "whatsapp_disconnected",
      };
    }
    const name =
      opts.instanceName?.startsWith("whapi") ? opts.instanceName : "whapi-superadmin";
    return { ok: true, instanceName: name, channel: "whapi" };
  }
  const name = (opts.instanceName || "").trim();
  if (opts.isConnected === false) {
    return {
      ok: false,
      reason:
        "WhatsApp desconectado. Conecte o WhatsApp na aba Conversas para agendar. Se houver outra pendência, resolva antes.",
      pending: "whatsapp_disconnected",
    };
  }
  if (name && !name.startsWith("whapi")) {
    return { ok: true, instanceName: name, channel: "evolution" };
  }
  if (name.startsWith("whapi")) {
    return { ok: true, instanceName: name, channel: "whapi" };
  }
  return {
    ok: false,
    reason:
      "Conecte o WhatsApp para agendar. Se faltar conexão ou outra pendência, resolva na aba Conversas e tente de novo.",
    pending: "whatsapp_disconnected",
  };
}

/** Helper com narrow via `in` — `tsc -b` não estreita bem o discriminante `ok`. */
export function scheduleChannelBlockedReason(
  channel: ScheduleChannelReady,
): string | null {
  if ("reason" in channel) return channel.reason;
  return null;
}
