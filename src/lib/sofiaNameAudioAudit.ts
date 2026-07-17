/** Helpers — auditoria de intros Olá+nome / só nome (Sofia). */

export type IntroKind = "ola" | "nome";

export type MediaRow = {
  id: string;
  slot_key: string | null;
  url: string | null;
  active: boolean;
  label: string | null;
  created_at: string;
  storage_path: string | null;
};

export function normSofiaName(raw: string): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .slice(0, 40);
}

export function displaySofiaName(norm: string): string {
  if (!norm) return "—";
  return norm.charAt(0).toUpperCase() + norm.slice(1);
}

const INTRO_RE = /^intro:(ola|nome):(?:(ptbr2|ptbr3|ptbr):)?([a-z0-9]+)$/;

export function parseIntroSlot(slotKey: string | null | undefined): {
  kind: IntroKind;
  version: string | null;
  nameNorm: string;
} | null {
  const m = String(slotKey || "").match(INTRO_RE);
  if (!m) return null;
  return {
    kind: m[1] as IntroKind,
    version: m[2] || "legacy",
    nameNorm: m[3],
  };
}

export function isRiskyNomeSlot(slotKey: string | null | undefined): boolean {
  const p = parseIntroSlot(slotKey);
  if (!p || p.kind !== "nome") return false;
  return p.version !== "ptbr3";
}

export function isApprovedNomeSlot(slotKey: string | null | undefined, active: boolean): boolean {
  const p = parseIntroSlot(slotKey);
  return !!p && p.kind === "nome" && p.version === "ptbr3" && active;
}

export function isApprovedOlaSlot(slotKey: string | null | undefined, active: boolean): boolean {
  const p = parseIntroSlot(slotKey);
  if (!p || p.kind !== "ola" || !active) return false;
  return p.version === "ptbr2" || p.version === "ptbr";
}

export function pickBestIntroRow(rows: MediaRow[], kind: IntroKind): MediaRow | null {
  const parsed = rows
    .map((r) => ({ row: r, p: parseIntroSlot(r.slot_key) }))
    .filter((x) => x.p && x.p.kind === kind);

  if (!kind) return null;

  const score = (version: string | null, active: boolean) => {
    if (kind === "nome") {
      if (version === "ptbr3" && active) return 100;
      if (version === "ptbr3") return 80;
      if (active) return 10;
      return 0;
    }
    if (version === "ptbr2" && active) return 100;
    if (version === "ptbr2") return 90;
    if (version === "ptbr" && active) return 70;
    return active ? 20 : 0;
  };

  parsed.sort((a, b) => {
    const sa = score(a.p!.version, a.row.active);
    const sb = score(b.p!.version, b.row.active);
    if (sb !== sa) return sb - sa;
    return String(b.row.created_at).localeCompare(String(a.row.created_at));
  });
  return parsed[0]?.row ?? null;
}

export function groupIntroRowsByName(rows: MediaRow[]): Map<string, MediaRow[]> {
  const map = new Map<string, MediaRow[]>();
  for (const row of rows) {
    const p = parseIntroSlot(row.slot_key);
    if (!p) continue;
    const list = map.get(p.nameNorm) || [];
    list.push(row);
    map.set(p.nameNorm, list);
  }
  return map;
}

export function storagePathFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)/);
    if (m) return m[2];
    const m2 = u.pathname.match(/\/storage\/v1\/object\/sign\/([^/]+)\/(.+)/);
    if (m2) return m2[2].split("?")[0];
  } catch { /* ignore */ }
  return null;
}
