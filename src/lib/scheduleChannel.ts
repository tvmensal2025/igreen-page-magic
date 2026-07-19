/**
 * Instância gravada em `scheduled_messages.instance_name` conforme o canal
 * do consultor conectado: Whapi → whapi-superadmin; Evolution → instanceName.
 */
export type ScheduleChannelReady =
  | { ok: true; instanceName: string; channel: "whapi" | "evolution" }
  | { ok: false; reason: string; pending: "whatsapp_disconnected" | "channel_unknown" };

export function resolveScheduleChannel(opts: {
  isWhapi?: boolean;
  instanceName?: string | null;
}): ScheduleChannelReady {
  if (opts.isWhapi) {
    const name =
      opts.instanceName?.startsWith("whapi") ? opts.instanceName : "whapi-superadmin";
    return { ok: true, instanceName: name, channel: "whapi" };
  }
  const name = (opts.instanceName || "").trim();
  if (name && !name.startsWith("whapi")) {
    return { ok: true, instanceName: name, channel: "evolution" };
  }
  if (name.startsWith("whapi")) {
    return { ok: true, instanceName: name, channel: "whapi" };
  }
  return {
    ok: false,
    reason:
      "Conecte o WhatsApp (Whapi ou Evolution) para agendar. Se faltar conexão ou outra pendência, resolva na aba Conversas e tente de novo.",
    pending: "whatsapp_disconnected",
  };
}
