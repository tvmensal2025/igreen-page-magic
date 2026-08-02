/** Mensagens prontas de aniversário (sem IA). Use {{nome}} para o primeiro nome. */
export const BIRTHDAY_MESSAGE_TEMPLATES: readonly string[] = [
  `🎂 *Feliz aniversário, {{nome}}!* 🎉

Que este novo ciclo seja cheio de *saúde*, *alegria* e conquistas! ✨

Um abraço da equipe *iGreen*. 💚⚡`,

  `🥳 Oi, *{{nome}}*!

Hoje é o *seu dia*! 🎂🎈

Desejo muita felicidade, paz e momentos especiais ao seu lado. 🌟

Parabéns da equipe *iGreen*! 💚⚡`,

  `💖 *Parabéns, {{nome}}!* 🎂

Que Deus abençoe cada passo deste novo ano da sua vida. 🙏✨

Você merece tudo de melhor.
Com carinho, equipe *iGreen*. 🎁💚`,

  `🎂 *Feliz aniversário, {{nome}}!* ⚡

Que este novo ciclo traga *saúde*, prosperidade e muita felicidade! 🌱✨

Parabéns pelo seu dia!
Equipe *iGreen*. 🎉💚`,

  `🎉 *{{nome}}, parabéns!* 🎂

Saúde, paz e muitas alegrias neste novo ano! 🥳

Um abraço da *iGreen*. 💚⚡`,

  `🎂 Olá, *{{nome}}*!

Passando pra desejar um *feliz aniversário* cheio de amor e boas surpresas! 🎁✨

Aproveite cada instante do seu dia.
Equipe *iGreen*. 🥳💚⚡`,

  `🌟 *Feliz aniversário, {{nome}}!* 🎂

Que este novo capítulo seja repleto de realizações e muita felicidade! ✨

Parabéns da equipe *iGreen*! 🎉💚⚡`,

  `🎈🎂 *Hoje é dia de festa, {{nome}}!* 🎉

Desejo um aniversário maravilhoso, cercado de quem você ama! ❤️✨

Parabéns e muitas felicidades!
Equipe *iGreen*. 💚⚡`,

  `🎂 *Parabéns pelo seu aniversário, {{nome}}!* 🎉

É uma alegria ter você conosco.

Desejamos um dia especial e um ano repleto de conquistas!
Equipe *iGreen*. ✨💚⚡`,

  `🥳 *Feliz aniversário, {{nome}}!* 🎂

Que a vida te presenteie com saúde, paz e muitos motivos pra sorrir! 😊✨

Um grande abraço da equipe *iGreen*.
Parabéns! 💚🎁⚡`,
] as const;

/** Primeiro nome legível (evita RAFAEL em caixa alta no WhatsApp). */
export function firstNameFrom(fullName: string | null | undefined): string {
  const raw = String(fullName || "").trim().split(/\s+/)[0] || "cliente";
  if (raw === "cliente") return raw;
  const lower = raw.toLocaleLowerCase("pt-BR");
  return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
}

export function fillBirthdayMessage(template: string, customerName: string | null | undefined): string {
  const first = firstNameFrom(customerName);
  return template.replace(/\{\{?\s*nome\s*\}?\}/gi, first);
}

export function pickRandomBirthdayMessage(): string {
  const idx = Math.floor(Math.random() * BIRTHDAY_MESSAGE_TEMPLATES.length);
  return BIRTHDAY_MESSAGE_TEMPLATES[idx];
}

export function isValidWhatsAppPhone(phone: string | null | undefined): boolean {
  if (!phone || phone.startsWith("sem_celular_")) return false;
  // Sync grava colisão como `55…_<igreen_code>` — validar só a parte do número.
  const base = String(phone).split("_")[0]?.trim() || "";
  if (!base || base.startsWith("sem_celular")) return false;
  const digits = base.replace(/\D/g, "");
  return digits.length >= 10;
}

/**
 * Chave estável do WhatsApp (DDI 55 + dígitos) para deduplicar cadastros.
 * Ignora sufixo `_codigo` do sync (ex.: 5511…_1137420 → mesmo Zap).
 */
export function retentionPhoneKey(phone: string | null | undefined): string | null {
  if (!isValidWhatsAppPhone(phone)) return null;
  const base = String(phone).split("_")[0]?.trim() || "";
  let digits = base.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  // Número BR com DDI: 12–13 dígitos. Sufixo já foi cortado acima.
  if (digits.length < 12 || digits.length > 13) return null;
  return digits;
}

function retentionSentKey(consultantId: string, phoneKey: string, day: string) {
  return `igreen:retention-wa-sent:${consultantId}:${day}:${phoneKey}`;
}

function todayIsoLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Já abriu WhatsApp de retenção/aniversário para este número hoje? */
export function wasRetentionWhatsAppOpenedToday(
  consultantId: string | null | undefined,
  phone: string | null | undefined,
): boolean {
  if (!consultantId || typeof localStorage === "undefined") return false;
  const key = retentionPhoneKey(phone);
  if (!key) return false;
  try {
    return localStorage.getItem(retentionSentKey(consultantId, key, todayIsoLocal())) === "1";
  } catch {
    return false;
  }
}

export function markRetentionWhatsAppOpenedToday(
  consultantId: string | null | undefined,
  phone: string | null | undefined,
): void {
  if (!consultantId || typeof localStorage === "undefined") return;
  const key = retentionPhoneKey(phone);
  if (!key) return;
  try {
    localStorage.setItem(retentionSentKey(consultantId, key, todayIsoLocal()), "1");
  } catch {
    /* ignore */
  }
}

export function openBirthdayWhatsApp(phone: string, message: string): boolean {
  if (!isValidWhatsAppPhone(phone)) return false;
  const digits = retentionPhoneKey(phone) || phone.replace(/\D/g, "");
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  return true;
}

const preferredKey = (consultantId: string) => `igreen:birthday-msg:${consultantId}`;

/** Mensagem preferida do consultor (local). Mantém {{nome}} para personalizar no envio. */
export function getPreferredBirthdayTemplate(consultantId?: string | null): string {
  if (!consultantId || typeof localStorage === "undefined") {
    return BIRTHDAY_MESSAGE_TEMPLATES[0];
  }
  try {
    const raw = localStorage.getItem(preferredKey(consultantId));
    if (raw && raw.trim().length > 0) return raw;
  } catch {
    /* ignore */
  }
  return BIRTHDAY_MESSAGE_TEMPLATES[0];
}

export function setPreferredBirthdayTemplate(consultantId: string, template: string): void {
  if (!consultantId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(preferredKey(consultantId), template);
  } catch {
    /* ignore */
  }
}
