// Janela de silêncio do bot: 21:30 → 08:00 (horário de Brasília).
// Bloqueia envios AUTOMÁTICOS (bot/IA/cron de cadência, follow-up, reheat…).
// NÃO usar em send-scheduled-messages — agenda manual do consultor envia na hora marcada.

export function isQuietHourBRT(now: Date = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now); // "HH:MM"
  const [h, m] = fmt.split(":").map(Number);
  const minutes = h * 60 + m;
  const start = 21 * 60 + 30; // 21:30
  const end = 8 * 60; // 08:00
  return minutes >= start || minutes < end;
}

/** Hora 0–23 em America/Sao_Paulo. */
export function hourBRT(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }).format(now),
  ) % 24;
}

/**
 * Saudação longa p/ pós-venda / áudio: "Muito bom dia|boa tarde|boa noite".
 * Faixas iguais ao attendance (`greetingByHour`): <12 dia, <18 tarde, senão noite.
 */
export function saudacaoMuitoByHourBRT(now: Date = new Date()): string {
  const h = hourBRT(now);
  if (h < 12) return "Muito bom dia";
  if (h < 18) return "Muito boa tarde";
  return "Muito boa noite";
}

// Retorna ISO do próximo 08:00 BRT (hoje se ainda for madrugada, senão amanhã).
export function nextQuietWindowEndISO(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  const hhmm = Number(parts.hour) * 60 + Number(parts.minute);
  let targetDate: string;
  if (hhmm < 8 * 60) {
    targetDate = `${parts.year}-${parts.month}-${parts.day}`;
  } else {
    const d = new Date(
      Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1),
    );
    targetDate = d.toISOString().slice(0, 10);
  }
  return new Date(`${targetDate}T08:00:00-03:00`).toISOString();
}

export function logQuietSkip(fn: string, extra: Record<string, unknown> = {}): void {
  try {
    console.log(JSON.stringify({ level: "info", event: "quiet_hours_skip", function: fn, ...extra }));
  } catch {
    /* noop */
  }
}
