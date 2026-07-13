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

// Base "agora" injetável para testes determinísticos.
function brtParts(at: Date): { y: number; m: number; d: number; hour: number; min: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
    weekday: "short",
  }).formatToParts(at).reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: Number(parts.year), m: Number(parts.month), d: Number(parts.day),
    hour: Number(parts.hour) % 24, min: Number(parts.minute),
    weekday: weekdayMap[parts.weekday] ?? 0,
  };
}

/** Data absoluta para `daysAhead` dias à frente às hh:00 BRT. */
function brtAt(base: Date, daysAhead: number, hourBRT: number): Date {
  const p = brtParts(base);
  const utcMidnight = Date.UTC(p.y, p.m - 1, p.d + daysAhead, hourBRT, 0, 0);
  // BRT = UTC-3 (sem DST desde 2019). Somar 3h converte a "parede" BRT em UTC.
  return new Date(utcMidnight + 3 * 60 * 60 * 1000);
}

function startOfTomorrow9am(base: Date = new Date()): Date {
  return brtAt(base, 1, 9);
}

/** Próxima segunda-feira 09:00 BRT (se hoje é segunda, vai para a próxima). */
function nextMonday9am(base: Date = new Date()): Date {
  const p = brtParts(base);
  const daysUntilMonday = ((1 - p.weekday) + 7) % 7 || 7;
  return brtAt(base, daysUntilMonday, 9);
}

/**
 * "Hoje à noite" → 19:00 BRT de hoje (mínimo agora+1h). Se já passou de 20h,
 * cai para amanhã 09:00 — cutucar às 23h não é o que o cliente pediu.
 */
function tonightAnchor(base: Date = new Date()): Date {
  const p = brtParts(base);
  if (p.hour >= 20) return startOfTomorrow9am(base);
  const anchor = brtAt(base, 0, 19);
  const minimum = new Date(base.getTime() + 60 * 60 * 1000);
  return anchor > minimum ? anchor : minimum;
}

/**
 * "Hoje à tarde" → 14:00 BRT de hoje (mínimo agora+1h). Depois das 17h,
 * comporta-se como "à noite".
 */
function afternoonAnchor(base: Date = new Date()): Date {
  const p = brtParts(base);
  if (p.hour >= 17) return tonightAnchor(base);
  const anchor = brtAt(base, 0, 14);
  const minimum = new Date(base.getTime() + 60 * 60 * 1000);
  return anchor > minimum ? anchor : minimum;
}

function inHours(h: number, base: Date = new Date()): Date {
  return new Date(base.getTime() + h * 60 * 60 * 1000);
}

export function detectPostponeIntent(
  rawText: string | null | undefined,
  now: Date = new Date(),
): PostponeIntent | null {
  if (!rawText) return null;
  const text = String(rawText).trim();
  if (!text) return null;

  // Recusa explícita → não é adiamento, deixa o fluxo conversacional lidar.
  if (RX_HARD_REFUSE.test(text)) return null;

  if (RX_NO_LIGHT.test(text) && (RX_TOMORROW.test(text) || RX_LATER.test(text) || /mando/i.test(text))) {
    return { when: "amanhã cedo", pauseUntil: startOfTomorrow9am(now).toISOString() };
  }

  if (RX_TOMORROW.test(text)) {
    const early = RX_EARLY.test(text);
    return {
      when: early ? "amanhã cedo" : "amanhã",
      pauseUntil: startOfTomorrow9am(now).toISOString(),
    };
  }

  // "segunda" agenda para a PRÓXIMA segunda-feira 09:00 BRT.
  // (Antes devolvia "amanhã cedo" — num sábado o bot cobrava no domingo.)
  if (RX_WEEKEND_LATER.test(text)) {
    return { when: "segunda-feira", pauseUntil: nextMonday9am(now).toISOString() };
  }

  if (RX_TONIGHT.test(text)) {
    return { when: "hoje à noite", pauseUntil: tonightAnchor(now).toISOString() };
  }

  if (RX_AFTERNOON.test(text)) {
    return { when: "hoje à tarde", pauseUntil: afternoonAnchor(now).toISOString() };
  }

  if (RX_NO_BILL.test(text)) {
    return { when: "quando achar a conta", pauseUntil: inHours(3, now).toISOString() };
  }

  if (RX_NO_LIGHT.test(text)) {
    return { when: "quando a luz voltar", pauseUntil: inHours(2, now).toISOString() };
  }

  if (RX_BUSY.test(text) || RX_NOT_NOW.test(text)) {
    return { when: "quando puder", pauseUntil: inHours(3, now).toISOString() };
  }

  if (RX_LATER.test(text)) {
    return { when: "mais tarde", pauseUntil: inHours(3, now).toISOString() };
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
