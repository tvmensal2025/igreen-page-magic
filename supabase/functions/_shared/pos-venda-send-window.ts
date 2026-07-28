/**
 * Janela de envio do pós-venda (America/Sao_Paulo):
 *  - Segunda a sábado: 08:00 – 20:00
 *  - Domingo: fechado (após 20:00 de domingo → só na segunda 08:00+)
 *
 * Diferente de quiet-hours (21:30→08:00, todo dia) e de business-window
 * (sábado fecha 14:00). Fora da janela o cron NÃO envia — o hub mostra
 * agendado para o próximo slot.
 */

const TZ = "America/Sao_Paulo";

type Parts = { dow: number; hour: number; minute: number };

function nowInSP(d: Date = new Date()): Parts {
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
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return { dow: map[wd] ?? 1, hour, minute };
}

/** Seg–sáb 08–20; domingo null. */
function windowFor(dow: number): { open: number; close: number } | null {
  if (dow === 0) return null;
  return { open: 8, close: 20 };
}

export function isPosVendaSendWindow(now: Date = new Date()): boolean {
  const { dow, hour } = nowInSP(now);
  const w = windowFor(dow);
  if (!w) return false;
  return hour >= w.open && hour < w.close;
}

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
  const iso = `${y}-${mo}-${da}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`;
  return new Date(iso);
}

/** Próximo instante dentro da janela (>= now). Se já estiver aberto, retorna now. */
export function nextPosVendaSendSlot(now: Date = new Date()): Date {
  const probe = new Date(now.getTime());
  for (let i = 0; i < 10; i++) {
    const { dow, hour } = nowInSP(probe);
    const w = windowFor(dow);
    if (w) {
      if (hour < w.open) return spDateAt(probe, w.open, 5);
      if (hour < w.close) return i === 0 ? now : spDateAt(probe, w.open, 5);
    }
    // Próximo dia civil em SP
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(probe);
    const [y, m, d] = ymd.split("-").map(Number);
    // Meio-dia do dia seguinte em SP (evita ambiguidade de DST)
    probe.setTime(new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T12:00:00-03:00`).getTime());
    probe.setTime(probe.getTime() + 24 * 60 * 60 * 1000);
  }
  return now;
}

/** Se `raw` cai fora da janela, empurra para o próximo slot; senão mantém. */
export function clampToPosVendaSendWindow(raw: Date, now: Date = new Date()): Date {
  const candidate = raw.getTime() < now.getTime() ? now : raw;
  if (isPosVendaSendWindow(candidate)) return candidate;
  return nextPosVendaSendSlot(candidate);
}

export function formatPosVendaSendSlotBR(at: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

export function logPosVendaWindowSkip(fn: string, extra: Record<string, unknown> = {}): void {
  try {
    console.log(JSON.stringify({
      level: "info",
      event: "pos_venda_send_window_skip",
      function: fn,
      next_slot: nextPosVendaSendSlot().toISOString(),
      ...extra,
    }));
  } catch {
    /* noop */
  }
}
