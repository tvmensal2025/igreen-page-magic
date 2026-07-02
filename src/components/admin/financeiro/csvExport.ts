import type { BoletoAdminRow } from "./hooks";

/**
 * Exporta boletos filtrados como CSV (separador `;`, encoding UTF-8 com BOM
 * para abrir corretamente no Excel em pt-BR).
 */
export function exportBoletosCsv(rows: BoletoAdminRow[], filename = "boletos.csv") {
  const header = [
    "Cliente",
    "Consultor",
    "Cidade",
    "UF",
    "Distribuidora",
    "Mes Ref",
    "Vencimento",
    "Pagamento",
    "Total",
    "Status",
    "Dias Atraso",
    "URL Boleto",
    "URL NF",
    "Telefone",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    if (/[";\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = rows.map((r) =>
    [
      r.nome || r.customer_name || "",
      r.consultant_name || "",
      r.cidade || "",
      r.uf || "",
      r.fornecedora || "",
      r.mes_referencia || "",
      r.vencimento || "",
      r.pagamento || "",
      Number(r.total || 0).toFixed(2).replace(".", ","),
      r.status || "",
      r.dias_atraso ?? "",
      r.url_boleto || "",
      r.url_invoice || "",
      r.phone_whatsapp || "",
    ].map(esc).join(";"),
  );
  const csv = "\uFEFF" + header.join(";") + "\n" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
