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

export function openBirthdayWhatsApp(phone: string, message: string): boolean {
  if (!isValidWhatsAppPhone(phone)) return false;
  const digits = phone.replace(/\D/g, "");
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  return true;
}
