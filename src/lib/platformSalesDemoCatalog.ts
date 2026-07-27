/**
 * Catálogo demo pós-venda (painel SuperAdmin) — espelho do menu 1–8 da edge.
 * Textos reais vêm de pos_venda_default_media no banco.
 */
import { hourBRT } from "@/lib/platformSalesScripts";

export const PS_DEMO_CLIENT_NAME = "Maria";

export const PLATFORM_SALES_DEMO_MENU = [
  { n: 1, stage: "aprovado", label: "Aprovado" },
  { n: 2, stage: "d30", label: "30 dias" },
  { n: 3, stage: "d60", label: "60 dias" },
  { n: 4, stage: "d90", label: "90 dias" },
  { n: 5, stage: "d120", label: "120 dias" },
  { n: 6, stage: "d150", label: "150 dias" },
  { n: 7, stage: "d180", label: "180 dias" },
  { n: 8, stage: "d210", label: "210 dias" },
] as const;

export type PlatformSalesDemoStage = (typeof PLATFORM_SALES_DEMO_MENU)[number]["stage"];

export const PS_DEMO_CTA_LABEL =
  "Quer ouvir as mensagens enviadas ao cliente até o fechamento?";

function saudacaoBRT(now: Date = new Date()): string {
  const h = hourBRT(now);
  if (h < 12) return "Muito bom dia";
  if (h < 18) return "Muito boa tarde";
  return "Muito boa noite";
}

/** Substitui {{nome}} / {{saudacao}} como na edge (preview). */
export function composePlatformSalesDemoPreview(
  rawTemplate: string,
  now: Date = new Date(),
): string {
  const saudacao = saudacaoBRT(now);
  let out = String(rawTemplate || "")
    .replace(/\{\{saudacao\}\}/gi, saudacao)
    .replace(/\{\{nome\}\}/gi, PS_DEMO_CLIENT_NAME)
    .replace(/\{\{telefone\}\}/gi, "");
  out = out.replace(/Ol[áa],\s+Tudo bem\?/gi, "Olá. Tudo bem?");
  return out.trim();
}

export function buildPlatformSalesDemoMenuPreview(): string {
  const lines = PLATFORM_SALES_DEMO_MENU.map((m) => `*${m.n}.* ${m.label}`);
  return (
    `Quer ouvir qual mensagem o *cliente* recebe?\n\n` +
    `${lines.join("\n")}\n\n` +
    `_Digite o número (1 a 8)._`
  );
}
