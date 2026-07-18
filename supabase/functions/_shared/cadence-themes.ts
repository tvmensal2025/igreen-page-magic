/**
 * Temas da onda fria (Grupo B) — picker runtime para {{tema_whatsapp}} / {{tema_sms}}.
 * Espelha o catálogo Multicanal (theme_*), sem cruise (exige aprovação).
 */

export type CadenceThemeId =
  | "simplified_analysis"
  | "tariff_flags"
  | "no_home_panels"
  | "security"
  | "benefits_club"
  | "referral_cashback"
  | "digital_app";

export type PickedTheme = {
  id: CadenceThemeId;
  wa: string;
  sms: string;
};

/** Placeholder resolvido no tick via cadence-availability (aba Disponibilidade). */
const DISP = "{{frase_disponibilidade}}";

/** Temas seguros (sem requiresApproval). */
export const CADENCE_THEMES: ReadonlyArray<PickedTheme> = [
  {
    id: "simplified_analysis",
    wa: `Olá, {{nome}}.

Boa notícia: agora dá para começar sua análise só com o valor médio da conta — sem foto e sem burocracia.

${DISP}

Qual faixa está sua conta hoje?`,
    sms: `Rafael | iGreen: {{nome}}, agora da pra analisar so com o valor da conta. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    id: "tariff_flags",
    wa: `Olá, {{nome}}.

As bandeiras amarela e vermelha podem aumentar o valor final da conta.

O benefício de economia pode ajudar a reduzir o impacto desses aumentos, conforme o consumo e as condições aplicáveis.

Quer análise inicial pelo valor médio? Qual faixa?`,
    sms: `Rafael | Energia: bandeiras podem subir a conta. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    id: "no_home_panels",
    wa: `Olá, {{nome}}.

Para conhecer essa possibilidade de economia, não é necessário instalar placas solares na sua casa, fazer obra ou alterar sua instalação.

A análise pode começar pelo valor médio. Como prefere?`,
    sms: `Rafael | Energia: sem placas nem obra. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    id: "security",
    wa: `Olá, {{nome}}. Aqui é o Rafael.

Reforço: não pedimos Pix, depósito ou pagamento ao consultor para iniciar a análise.

${DISP}

Como prefere seguir?`,
    sms: `Rafael | iGreen: nao pedimos Pix/pagamento. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    id: "benefits_club",
    wa: `Olá, {{nome}}.

O benefício não termina na economia da conta: clientes elegíveis podem ter vantagens em estabelecimentos parceiros, conforme condições vigentes.

O que você quer conhecer?`,
    sms: `Rafael | iGreen: economia + clube de parceiros. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    id: "referral_cashback",
    wa: `Olá, {{nome}}.

Além da própria economia, também podem existir benefícios por indicação, conforme as regras vigentes.

O que você quer conhecer?`,
    sms: `Rafael | iGreen: economia + indicacao (regras). Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    id: "digital_app",
    wa: `Olá, {{nome}}.

Além da economia na conta, clientes elegíveis podem acompanhar o benefício pelo aplicativo, conforme as condições vigentes.

${DISP}

Como prefere seguir?`,
    sms: `Rafael | iGreen: economia no app. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
];

function hashPick(seed: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return mod > 0 ? h % mod : 0;
}

/** Escolhe tema ≠ lastThemeId (quando possível). */
export function pickCadenceTheme(opts: {
  customerId: string;
  stage: string;
  lastThemeId?: string | null;
}): PickedTheme {
  const pool = CADENCE_THEMES.filter((t) => t.id !== opts.lastThemeId);
  const list = pool.length > 0 ? pool : [...CADENCE_THEMES];
  const idx = hashPick(`${opts.customerId}:${opts.stage}`, list.length);
  return list[idx]!;
}

/** Último theme_id gravado no cadence_action_log.detail deste lead. */
export async function loadLastThemeId(
  supabase: any,
  customerId: string,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("cadence_action_log")
      .select("detail")
      .eq("customer_id", customerId)
      .eq("status", "sent")
      .order("created_at", { ascending: false })
      .limit(20);
    for (const row of data ?? []) {
      const d = row?.detail as { theme_id?: string } | null;
      if (d?.theme_id) return String(d.theme_id);
    }
  } catch { /* ignore */ }
  return null;
}

export function needsWhatsAppTheme(messageText: string, stage: string): boolean {
  const t = (messageText || "").trim();
  if (t.includes("{{tema_whatsapp}}")) return true;
  // Dia 2: produto exige tema rotativo mesmo se o painel ainda tiver texto antigo.
  if (stage === "COLD_2") return true;
  return false;
}

export function needsSmsTheme(messageText: string, stage: string): boolean {
  const t = (messageText || "").trim();
  if (t.includes("{{tema_sms}}")) return true;
  if (stage === "SMS_TEMA_2" || stage === "SMS_TEMA_7") return true;
  return false;
}
