/**
 * Janela útil (America/Sao_Paulo):
 *  - Seg-Sex: 08:00 – 20:00
 *  - Sábado : 08:00 – 14:00
 *  - Domingo: off
 *
 * Usado por: cadence-tick, voice-dialer-cron, reactivation-cron,
 * send-scheduled-messages, facebook-retarget-sync.
 */

const TZ = "America/Sao_Paulo";

type WindowParts = { dow: number; hour: number; minute: number };

function nowInSP(d: Date = new Date()): WindowParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const wd = parts.find((p) => p.type === "weekday")?.value || "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: map[wd] ?? 1, hour, minute };
}

function windowFor(dow: number): { open: number; close: number } | null {
  if (dow === 0) return null; // domingo
  if (dow === 6) return { open: 8, close: 14 }; // sábado
  return { open: 8, close: 20 }; // seg-sex
}

export function isBusinessHour(now: Date = new Date()): boolean {
  const { dow, hour } = nowInSP(now);
  const w = windowFor(dow);
  if (!w) return false;
  return hour >= w.open && hour < w.close;
}

/** Retorna o próximo instante dentro da janela útil (>= now). */
export function nextBusinessSlot(now: Date = new Date()): Date {
  const d = new Date(now.getTime());
  for (let i = 0; i < 8; i++) {
    const { dow, hour, minute } = nowInSP(d);
    const w = windowFor(dow);
    if (w) {
      if (hour < w.open) {
        // hoje ainda vai abrir
        return spDateAt(d, w.open, 5);
      }
      if (hour < w.close) {
        // já está aberto
        return d;
      }
    }
    // avança 1 dia e reseta para 08:05
    d.setUTCDate(d.getUTCDate() + 1);
    const nextParts = nowInSP(d);
    const nextW = windowFor(nextParts.dow);
    if (nextW) return spDateAt(d, nextW.open, 5);
  }
  return d;
}

/** Retorna Date que corresponde ao horário local SP `hh:mm` do dia contido em `base`. */
function spDateAt(base: Date, hour: number, minute: number): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(base);
  const y = parts.find((p) => p.type === "year")!.value;
  const mo = parts.find((p) => p.type === "month")!.value;
  const da = parts.find((p) => p.type === "day")!.value;
  // Aproxima com offset BRT (-03). SP não observa horário de verão desde 2019.
  const iso = `${y}-${mo}-${da}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`;
  return new Date(iso);
}
