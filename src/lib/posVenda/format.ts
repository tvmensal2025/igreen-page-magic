// Formatação compartilhada para telefones e estágios pós-venda.

export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  if (!phone) return true;
  return /^sem_celular/i.test(phone) || phone.replace(/\D/g, "").length < 10;
}

export function formatPhoneBR(phone: string | null | undefined): string {
  if (!phone) return "";
  const d = phone.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) {
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 12 && d.startsWith("55")) {
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  }
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return phone;
}

/**
 * Cria um link encurtado amigável para o WhatsApp.
 */
export function createShortWhatsAppLink(phone: string, text?: string): string {
  const clean = phone.replace(/\D/g, "");
  const base = `https://wa.me/${clean}`;
  if (!text) return base;
  return `${base}?text=${encodeURIComponent(text)}`;
}

export function initialsFrom(name: string | null | undefined): string {
  const n = (name || "?").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// Cor estável a partir do nome (paleta de tokens semânticos).
const AVATAR_TONES = [
  "bg-emerald-500/15 text-emerald-300",
  "bg-sky-500/15 text-sky-300",
  "bg-amber-500/15 text-amber-300",
  "bg-violet-500/15 text-violet-300",
  "bg-rose-500/15 text-rose-300",
  "bg-teal-500/15 text-teal-300",
  "bg-indigo-500/15 text-indigo-300",
];
export function avatarTone(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length];
}

const STEP_LABELS: Record<string, string> = {
  boas_vindas: "Boas-vindas",
  fazenda_solar: "Fazenda Solar",
  apresentacao: "Apresentação",
  simulacao: "Simulação",
  foto_conta: "Foto da Conta",
  pos_cadastro: "Pós-cadastro",
  nome: "Nome",
  cpf: "CPF",
  endereco: "Endereço",
  contrato: "Contrato",
  assinatura: "Assinatura",
};

/**
 * Converte step IDs técnicos em rótulos amigáveis.
 * - Usa `title` quando existir.
 * - Mapeia slugs conhecidos.
 * - Para IDs gerados (`passo_xxxx`), retorna "Passo N" se ordem fornecida.
 */
export function prettyStepLabel(
  stepId: string,
  title?: string | null,
  orderIndex?: number,
): string {
  if (title && title.trim() && !/^passo_/i.test(title)) return title.trim();
  if (STEP_LABELS[stepId]) return STEP_LABELS[stepId];
  if (/^passo_/i.test(stepId)) {
    return typeof orderIndex === "number" ? `Passo ${orderIndex + 1}` : "Passo";
  }
  // snake_case → Title Case
  return stepId
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export type PosVendaStage = "aprovado" | "reprovado" | "d30" | "d60" | "d90" | "d120";

export const POS_VENDA_STAGES: { key: PosVendaStage; label: string; description: string }[] = [
  { key: "aprovado", label: "Aprovado", description: "Mensagem de boas-vindas após validação" },
  { key: "reprovado", label: "Reprovado", description: "Devolutiva quando o cadastro não passa" },
  { key: "d30", label: "30 dias", description: "Acompanhamento no primeiro mês" },
  { key: "d60", label: "60 dias", description: "Check-in de segundo mês" },
  { key: "d90", label: "90 dias", description: "Reativação trimestral" },
  { key: "d120", label: "120 dias", description: "Reaquecimento longo prazo" },
];
