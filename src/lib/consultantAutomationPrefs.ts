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

/** Padrão da UI e do motor: sem row = tudo OFF (fail-closed). */
export const UI_DEFAULT_CONSULTANT_AUTOMATION_PREFS: Omit<ConsultantAutomationPrefs, "consultant_id"> = {
  ...DEFAULT_CONSULTANT_AUTOMATION_PREFS,
};

/** Sugestão só no 1º ack do modal (usuário escolhe antes de gravar). */
export const SUGGESTED_FIRST_ACK_PREFS: Omit<ConsultantAutomationPrefs, "consultant_id"> = {
  group_a_enabled: true,
  group_b_enabled: true,
  group_c_enabled: true,
  pos_venda_auto_enabled: true,
  reminders_auto_enabled: true,
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
    title: "Novos no WhatsApp",
    help: "Quem acabou de falar com você: o sistema cumprimenta e cobra resposta se a pessoa sumir.",
  },
  {
    pack: "b",
    field: "group_b_enabled",
    title: "Quem esfriou",
    help: "Quem parou de responder: o sistema tenta de novo por WhatsApp, SMS ou ligação.",
  },
  {
    pack: "c",
    field: "group_c_enabled",
    title: "Quem sumiu há meses",
    help: "Quem não fechou há bastante tempo: o sistema volta a chamar de tempos em tempos.",
  },
  {
    pack: "pos_venda",
    field: "pos_venda_auto_enabled",
    title: "Depois da venda",
    help: "Avisos automáticos para clientes que você já validou. Você ainda pode falar no chat à mão.",
  },
  {
    pack: "reminders",
    field: "reminders_auto_enabled",
    title: "Lembretes e cobranças",
    help: "Mensagens de “ainda está aí?” e textos que saem sozinhos ao mover o cliente no quadro.",
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
