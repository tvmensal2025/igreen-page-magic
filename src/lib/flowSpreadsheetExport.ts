// Exporta linhas da planilha de fluxo para CSV compatível com Excel BR
// (UTF-8 BOM, separador ;).

export type SpreadsheetRow = Record<string, string | number | null | undefined>;

function escapeCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv(rows: SpreadsheetRow[], columns: { key: string; label: string }[]): string {
  const header = columns.map((c) => escapeCell(c.label)).join(";");
  const body = rows
    .map((r) => columns.map((c) => escapeCell(r[c.key])).join(";"))
    .join("\r\n");
  return `\uFEFF${header}\r\n${body}`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
