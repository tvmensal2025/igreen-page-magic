import { safeFirstNameForAddress } from "./customer-display-name.ts";
import { saudacaoMuitoByHourBRT } from "./quiet-hours.ts";

/** Substitui {{nome}}, {{saudacao}}, {{telefone}} (BRT). Nome vazio → limpa "Olá, .". */
export function applyOutboundTemplateVars(
  raw: string,
  opts: {
    customerName?: string | null;
    nameSource?: string | null;
    phone?: string | null;
    now?: Date;
  } = {},
): string {
  const nome = safeFirstNameForAddress(opts.customerName, opts.nameSource);
  const saudacao = saudacaoMuitoByHourBRT(opts.now ?? new Date());
  const telefone = String(opts.phone || "");
  let out = String(raw || "")
    .replace(/\{\{saudacao\}\}/gi, saudacao)
    .replace(/\{\{nome\}\}/gi, nome)
    .replace(/\{\{telefone\}\}/gi, telefone);
  // Abertura canônica "Olá, {{nome}} Tudo bem?" sem nome → "Olá. Tudo bem?"
  out = out.replace(/Ol[áa],\s+Tudo bem\?/gi, "Olá. Tudo bem?");
  // Legado: Olá, {{nome}}. com nome vazio → Olá.
  out = out.replace(/Ol[áa],\s*\./gi, "Olá.");
  out = out.replace(/Ol[áa],\s*!\s*/gi, "Olá! ");
  out = out.replace(/Ol[áa],\s*\n/gi, "Olá.\n");
  return out;
}
