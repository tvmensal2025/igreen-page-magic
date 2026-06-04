// Detecta intenção de adiamento ("amanhã eu mando", "mais tarde", "tô sem luz")
// em mensagens de lead durante steps que aguardam mídia (conta de luz / documento).
//
// Retorna null quando não há sinal de adiamento, ou um objeto com:
//   - when: rótulo legível ("amanhã cedo", "mais tarde", "à noite", "hoje à tarde",
//           "quando puder")
//   - pauseUntil: ISO timestamp até quando o bot deve segurar nudges
//
// Filosofia: vendedor humano nunca repete "manda a foto" 9s depois do cliente
// avisar que envia amanhã. O bot precisa fazer o mesmo: confirmar com empatia
// e silenciar até o horário combinado.

export interface PostponeIntent {
  when: string;
  pauseUntil: string; // ISO
}

const RX_TOMORROW = /\b(amanh[ãa]|amanha)\b/i;
const RX_EARLY = /\b(logo cedo|logo de manh[ãa]|cedinho|de manh[ãa]|pela manh[ãa])\b/i;
const RX_LATER = /\b(mais tarde|daqui (a )?pouco|daqui (a )?pouquinho|j[áa] te mando|j[áa] mando|mando (j[áa]|assim que|quando)|te (envio|mando) (mais )?(tarde|depois)|depois (eu )?(te )?(mando|envio|vejo|olho|fa[çc]o))\b/i;
const RX_TONIGHT = /\b([àa] noite|hoje [àa] noite|de noite|essa noite|esta noite)\b/i;
const RX_AFTERNOON = /\b([àa] tarde|hoje [àa] tarde|de tarde|essa tarde|esta tarde)\b/i;
const RX_NOT_NOW = /\b(agora n[ãa]o|ainda n[ãa]o|n[ãa]o (consigo|posso|d[áa]|tenho como) agora|n[ãa]o estou em casa|n[ãa]o (t[ôo]|estou) em casa)\b/i;
const RX_BUSY = /\b(t[oôu] (na rua|no trabalho|trabalhando|ocupad[ao]|dirigindo|no servi[çc]o|na correria)|estou (na rua|no trabalho|trabalhando|ocupad[ao]|dirigindo))\b/i;
const RX_NO_BILL = /\b((t[ôo]|estou) sem (a )?(conta|fatura)|conta (n[ãa]o est[áa]|n[ãa]o ta) (aqui|comigo|em m[ãa]os)|n[ãa]o (estou|t[ôo]) com a conta|conta (t[áa]|est[áa]) em casa|preciso (achar|procurar|pegar) (a )?(conta|fatura))\b/i;
const RX_NO_LIGHT = /\b((t[ôo]|estou) sem (luz|energia|internet|sinal)|caiu (a )?(luz|energia|internet)|sem (luz|energia|internet) aqui|escuro aqui|j[áa] anoiteceu|n[ãa]o tem luz)\b/i;
const RX_WEEKEND_LATER = /\b(segunda(-feira)?|amanh[ãa] cedo|na segunda|s[óo] segunda)\b/i;

// "amanhã não vai dar" continua sendo adiamento (vai mandar outro dia).
// Só descartamos quando vem com claro "não quero / desisto".
const RX_HARD_REFUSE = /\b(n[ãa]o quero|desisto|n[ãa]o tenho interesse|cancela|para de me mandar|me tira (do|dessa|da)|n[ãa]o me (chama|envia) mais)\b/i;

function startOfTomorrow9am(): Date {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() - 3); // BRT
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  // Converte de volta para UTC
  return new Date(d.getTime() + 3 * 60 * 60 * 1000);
}

function inHours(h: number): Date {
  return new Date(Date.now() + h * 60 * 60 * 1000);
}

export function detectPostponeIntent(rawText: string | null | undefined): PostponeIntent | null {
  if (!rawText) return null;
  const text = String(rawText).trim();
  if (!text) return null;

  // Recusa explícita → não é adiamento, deixa o fluxo conversacional lidar.
  if (RX_HARD_REFUSE.test(text)) return null;

  if (RX_NO_LIGHT.test(text) && (RX_TOMORROW.test(text) || RX_LATER.test(text) || /\bmando\b/i.test(text))) {
    return { when: "amanhã cedo", pauseUntil: startOfTomorrow9am().toISOString() };
  }

  if (RX_TOMORROW.test(text)) {
    const early = RX_EARLY.test(text);
    return {
      when: early ? "amanhã cedo" : "amanhã",
      pauseUntil: startOfTomorrow9am().toISOString(),
    };
  }

  if (RX_WEEKEND_LATER.test(text)) {
    return { when: "amanhã cedo", pauseUntil: startOfTomorrow9am().toISOString() };
  }

  if (RX_TONIGHT.test(text)) {
    return { when: "hoje à noite", pauseUntil: inHours(4).toISOString() };
  }

  if (RX_AFTERNOON.test(text)) {
    return { when: "hoje à tarde", pauseUntil: inHours(3).toISOString() };
  }

  if (RX_NO_BILL.test(text)) {
    return { when: "quando achar a conta", pauseUntil: inHours(3).toISOString() };
  }

  if (RX_NO_LIGHT.test(text)) {
    return { when: "quando a luz voltar", pauseUntil: inHours(2).toISOString() };
  }

  if (RX_BUSY.test(text) || RX_NOT_NOW.test(text)) {
    return { when: "quando puder", pauseUntil: inHours(3).toISOString() };
  }

  if (RX_LATER.test(text)) {
    return { when: "mais tarde", pauseUntil: inHours(3).toISOString() };
  }

  return null;
}

export function buildPostponeReply(opts: {
  firstName?: string | null;
  when: string;
  waitingDoc?: boolean;
}): string {
  const name = (opts.firstName || "").trim();
  const greet = name ? `${name}, ` : "";
  const what = opts.waitingDoc ? "o documento" : "a conta de luz";
  return `Combinado, ${greet}sem pressa! 💚\n\nFico no aguardo d${
    opts.waitingDoc ? "o" : "a"
  } ${what} *${opts.when}*. Qualquer dúvida é só me chamar por aqui. 🤝`;
}
