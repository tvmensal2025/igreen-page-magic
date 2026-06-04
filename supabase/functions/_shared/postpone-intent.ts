// Detecta intenção de adiamento ("amanhã eu mando", "mais tarde", "tô sem luz")
// em mensagens de lead durante steps que aguardam mídia (conta de luz / documento).
//
// Filosofia: vendedor humano nunca repete "manda a foto" 9s depois do cliente
// avisar que envia amanhã. O bot precisa fazer o mesmo: confirmar com empatia
// e silenciar até o horário combinado.
//
// Nota: \b do JS não funciona ao redor de caracteres acentuados (ã, é, ç…),
// então usamos asserções de não-letra unicode: (?:^|\P{L}) ... (?:\P{L}|$).

export interface PostponeIntent {
  when: string;
  pauseUntil: string; // ISO
}

function rx(body: string): RegExp {
  return new RegExp(`(?:^|\\P{L})(?:${body})(?:\\P{L}|$)`, "iu");
}

const RX_TOMORROW = rx("amanh[ãa]|amanha");
const RX_EARLY = rx("logo cedo|logo de manh[ãa]|cedinho|de manh[ãa]|pela manh[ãa]");
const RX_LATER = rx(
  "mais tarde|daqui (?:a )?pouco|daqui (?:a )?pouquinho|j[áa] te mando|j[áa] mando|mando (?:j[áa]|assim que|quando)|te (?:envio|mando) (?:mais )?(?:tarde|depois)|depois (?:eu )?(?:te )?(?:mando|envio|vejo|olho|fa[çc]o)",
);
const RX_TONIGHT = rx("[àa] noite|hoje [àa] noite|de noite|essa noite|esta noite");
const RX_AFTERNOON = rx("[àa] tarde|hoje [àa] tarde|de tarde|essa tarde|esta tarde");
const RX_NOT_NOW = rx(
  "agora n[ãa]o|ainda n[ãa]o|n[ãa]o (?:consigo|posso|d[áa]|tenho como) agora|n[ãa]o estou em casa|n[ãa]o (?:t[ôo]|estou) em casa",
);
const RX_BUSY = rx(
  "t[oôu] (?:na rua|no trabalho|trabalhando|ocupad[ao]|dirigindo|no servi[çc]o|na correria)|estou (?:na rua|no trabalho|trabalhando|ocupad[ao]|dirigindo)",
);
const RX_NO_BILL = rx(
  "(?:t[ôo]|estou) sem (?:a )?(?:conta|fatura)|conta (?:n[ãa]o est[áa]|n[ãa]o ta) (?:aqui|comigo|em m[ãa]os)|n[ãa]o (?:estou|t[ôo]) com a conta|conta (?:t[áa]|est[áa]) em casa|preciso (?:achar|procurar|pegar) (?:a )?(?:conta|fatura)",
);
const RX_NO_LIGHT = rx(
  "(?:t[ôo]|estou) sem (?:luz|energia|internet|sinal)|caiu (?:a )?(?:luz|energia|internet)|sem (?:luz|energia|internet) aqui|escuro aqui|j[áa] anoiteceu|n[ãa]o tem luz",
);
const RX_WEEKEND_LATER = rx("segunda(?:-feira)?|na segunda|s[óo] segunda");

// "amanhã não vai dar" continua sendo adiamento.
// Só descartamos quando vem com claro "não quero / desisto".
const RX_HARD_REFUSE = rx(
  "n[ãa]o quero|desisto|n[ãa]o tenho interesse|cancela|para de me mandar|me tira (?:do|dessa|da)|n[ãa]o me (?:chama|envia) mais",
);

function startOfTomorrow9am(): Date {
  // 09:00 BRT (UTC-3) = 12:00 UTC
  const now = new Date();
  const brtNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const brtTomorrow = new Date(Date.UTC(
    brtNow.getUTCFullYear(),
    brtNow.getUTCMonth(),
    brtNow.getUTCDate() + 1,
    9, 0, 0,
  ));
  return new Date(brtTomorrow.getTime() + 3 * 60 * 60 * 1000);
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

  if (RX_NO_LIGHT.test(text) && (RX_TOMORROW.test(text) || RX_LATER.test(text) || /mando/i.test(text))) {
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
  const article = opts.waitingDoc ? "o" : "a";
  const what = opts.waitingDoc ? "documento" : "conta de luz";
  return `Combinado, ${greet}sem pressa! 💚\n\nFico no aguardo d${article} ${what} *${opts.when}*. Qualquer dúvida é só me chamar por aqui. 🤝`;
}
