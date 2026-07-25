/**
 * Espelho UI das prefs de automação por consultor.
 * Fonte da verdade Deno: supabase/functions/_shared/consultant-automation-prefs.ts
 */

export type ConsultantAutoPack = "a" | "b" | "c" | "pos_venda" | "reminders";

export type ConsultantAutomationPrefs = {
  consultant_id: string;
  group_a_enabled: boolean;
  group_b_enabled: boolean;
  group_c_enabled: boolean;
  pos_venda_auto_enabled: boolean;
  reminders_auto_enabled: boolean;
  acked_at: string | null;
};

export const DEFAULT_CONSULTANT_AUTOMATION_PREFS: Omit<ConsultantAutomationPrefs, "consultant_id"> = {
  group_a_enabled: false,
  group_b_enabled: false,
  group_c_enabled: false,
  pos_venda_auto_enabled: false,
  reminders_auto_enabled: false,
  acked_at: null,
};

export const CONSULTANT_AUTO_PACKS: Array<{
  pack: ConsultantAutoPack;
  field: keyof Omit<ConsultantAutomationPrefs, "consultant_id" | "acked_at">;
  title: string;
  help: string;
}> = [
  {
    pack: "a",
    field: "group_a_enabled",
    title: "Captação — Grupo A",
    help: "Leads em conversa no WhatsApp (saudação, nudges e escada de silêncio).",
  },
  {
    pack: "b",
    field: "group_b_enabled",
    title: "Reengajamento — Grupo B",
    help: "Leads frios (COLD) e reaquecimento diário por WhatsApp, SMS e ligação.",
  },
  {
    pack: "c",
    field: "group_c_enabled",
    title: "Recall — Grupo C",
    help: "Retomada longa (60 dias em diante) para quem não converteu.",
  },
  {
    pack: "pos_venda",
    field: "pos_venda_auto_enabled",
    title: "Pós-venda automático",
    help: "Mensagens D30–D210 após você validar o cliente. Chat manual continua liberado.",
  },
  {
    pack: "reminders",
    field: "reminders_auto_enabled",
    title: "Lembretes automáticos",
    help: "Follow-ups, FAQ, retenção e mensagens automáticas do kanban CRM.",
  },
];

export function isConsultantAutoAllowed(
  prefs: Pick<
    ConsultantAutomationPrefs,
    | "group_a_enabled"
    | "group_b_enabled"
    | "group_c_enabled"
    | "pos_venda_auto_enabled"
    | "reminders_auto_enabled"
  > | null | undefined,
  pack: ConsultantAutoPack,
): boolean {
  if (!prefs) return false;
  switch (pack) {
    case "a":
      return !!prefs.group_a_enabled;
    case "b":
      return !!prefs.group_b_enabled;
    case "c":
      return !!prefs.group_c_enabled;
    case "pos_venda":
      return !!prefs.pos_venda_auto_enabled;
    case "reminders":
      return !!prefs.reminders_auto_enabled;
    default:
      return false;
  }
}

export function anyPackOff(prefs: ConsultantAutomationPrefs | null | undefined): boolean {
  if (!prefs) return true;
  return CONSULTANT_AUTO_PACKS.some((p) => !prefs[p.field]);
}

export function needsAutomationPrefsAck(prefs: ConsultantAutomationPrefs | null | undefined): boolean {
  if (!prefs) return true;
  if (!prefs.acked_at) return true;
  return false;
}
