/** Horário padrão BR — America/Sao_Paulo (Brasília). Sem depender do fuso do navegador. */

export const BRASILIA_TZ = "America/Sao_Paulo";

type WallParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function partsInTz(date: Date, timeZone: string): WallParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  const hourRaw = bag.hour === "24" ? "0" : bag.hour;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(hourRaw),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

/** Offset ms: wall(TZ) − UTC no instante `date`. Ex.: BRT ≈ −3h. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const p = partsInTz(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/**
 * Converte `YYYY-MM-DDTHH:mm` (relógio de Brasília) → ISO UTC.
 * Não usa `new Date(local)` (que depende do fuso do browser).
 */
export function brasiliaWallToUtcIso(wall: string): string | null {
  const m = String(wall || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6] || 0);
  if (![y, mo, d, h, mi, s].every((n) => Number.isFinite(n))) return null;

  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  let utcMs = wallAsUtc;
  for (let i = 0; i < 3; i++) {
    const offset = tzOffsetMs(new Date(utcMs), BRASILIA_TZ);
    utcMs = wallAsUtc - offset;
  }
  return new Date(utcMs).toISOString();
}

/** Agora no formato `datetime-local` já em Brasília (para default/min). */
export function nowBrasiliaDatetimeLocal(): string {
  const p = partsInTz(new Date(), BRASILIA_TZ);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** HH:mm atual em Brasília. */
export function nowBrasiliaHm(): string {
  const p = partsInTz(new Date(), BRASILIA_TZ);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Janela de discagem em Brasília (espelha `inCallWindow` do voice-dialer).
 * Sem config → liberado.
 */
export function inBrasiliaCallWindow(cfg: {
  windowStart?: string;
  windowEnd?: string;
  weekdaysOnly?: boolean;
  timezone?: string;
} | null | undefined): boolean {
  if (!cfg) return true;
  const tz = cfg.timezone || BRASILIA_TZ;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date())) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  if (cfg.weekdaysOnly) {
    const wd = (bag.weekday || "").slice(0, 3).toLowerCase();
    if (wd === "sat" || wd === "sun") return false;
  }
  const start = cfg.windowStart || "09:00";
  const end = cfg.windowEnd || "18:00";
  const [sH, sM] = String(start).split(":").map(Number);
  const [eH, eM] = String(end).split(":").map(Number);
  const startMin = sH * 60 + (sM || 0);
  const endMin = eH * 60 + (eM || 0);
  const hourRaw = bag.hour === "24" ? "0" : bag.hour;
  const cur = Number(hourRaw) * 60 + Number(bag.minute || 0);
  if (endMin < startMin) return cur >= startMin || cur <= endMin;
  return cur >= startMin && cur <= endMin;
}
