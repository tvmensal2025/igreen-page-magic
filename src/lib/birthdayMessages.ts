/** Mensagens prontas de aniversário (sem IA). Use {{nome}} para o primeiro nome. */
export const BIRTHDAY_MESSAGE_TEMPLATES: readonly string[] = [
  `🎂 *Feliz aniversário, {{nome}}!* 🎉

Que este novo ciclo seja cheio de saúde, alegria e conquistas! ✨

Conte sempre com a gente. Um abraço! 💚`,

  `🥳 Oi, *{{nome}}*!

Hoje é o seu dia! 🎂🎈

Desejo muita luz, energia boa e momentos especiais ao seu lado. Parabéns! 🌟💚`,

  `💖 *Parabéns, {{nome}}!* 🎂

Que Deus abençoe cada passo deste novo ano da sua vida. 🙏✨

Você merece tudo de melhor hoje e sempre! 🎁💚`,

  `⚡ *Feliz aniversário, {{nome}}!* 🎂

Que este novo ciclo traga muita energia boa, saúde e prosperidade! 🌱✨

Parabéns pelo seu dia! 🎉💚`,

  `🎉 *{{nome}}, parabéns!* 🎂

Saúde, paz e muitas alegrias neste novo ano! 🥳💚`,

  `🎂 Olá, *{{nome}}*!

Passando aqui para desejar um *feliz aniversário* cheio de amor e boas surpresas! 🎁✨

Aproveite cada instante do seu dia! 🥳💚`,

  `🌟 *Feliz aniversário, {{nome}}!* 🎂

Que este novo capítulo seja repleto de realizações, sonhos cumpridos e muita felicidade! 🚀✨

Parabéns! 🎉💚`,

  `🎈🎂 *Hoje é dia de festa, {{nome}}!* 🎉

Desejo um aniversário maravilhoso, cercado de quem você ama! ❤️✨

Parabéns e muitas felicidades! 💚`,

  `🎂 *Parabéns pelo seu aniversário, {{nome}}!* 🎉

É uma alegria ter você conosco. Desejamos um dia especial e um ano repleto de conquistas! ✨💚`,

  `🥳 *Feliz aniversário, {{nome}}!* 🎂

Que a vida te presenteie com saúde, paz, prosperidade e muitos motivos para sorrir! 😊✨

Um grande abraço e parabéns! 💚🎁`,
] as const;

export function firstNameFrom(fullName: string | null | undefined): string {
  const name = String(fullName || "").trim();
  return name.split(/\s+/)[0] || "cliente";
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
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10;
}

/** Chave estável do WhatsApp (DDI 55 + dígitos) para deduplicar cadastros. */
export function retentionPhoneKey(phone: string | null | undefined): string | null {
  if (!isValidWhatsAppPhone(phone)) return null;
  let digits = phone!.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 12) return null;
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
