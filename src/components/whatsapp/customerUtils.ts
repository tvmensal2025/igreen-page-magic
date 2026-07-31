import type { LucideIcon } from "lucide-react";

export interface Customer {
  id: string;
  name: string | null;
  phone_whatsapp: string;
  electricity_bill_value?: number | null;
  email?: string | null;
  cpf?: string | null;
  rg?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_street?: string | null;
  address_neighborhood?: string | null;
  address_complement?: string | null;
  address_number?: string | null;
  cep?: string | null;
  numero_instalacao?: string | null;
  data_nascimento?: string | null;
  status?: string | null;
  created_at?: string | null;
  distribuidora?: string | null;
  registered_by_name?: string | null;
  registered_by_igreen_id?: string | null;
  media_consumo?: number | null;
  desconto_cliente?: number | null;
  andamento_igreen?: string | null;
  devolutiva?: string | null;
  observacao?: string | null;
  igreen_code?: string | null;
  data_cadastro?: string | null;
  data_ativo?: string | null;
  data_validado?: string | null;
  status_financeiro?: string | null;
  cashback?: string | null;
  nivel_licenciado?: string | null;
  assinatura_cliente?: string | null;
  assinatura_igreen?: string | null;
  link_assinatura?: string | null;
  customer_referred_by_name?: string | null;
  customer_referred_by_phone?: string | null;
  tipo_produto?: string | null;
  customer_origin?: string | null;
}

export interface ParsedCustomer {
  phone: string;
  name: string | null;
  status: string;
  /** true quando a planilha realmente trouxe a coluna de status para esta linha */
  hasStatus?: boolean;
  data: Record<string, unknown>;
  isNew: boolean;
}


export type StatusFilter = "all" | "approved" | "pending" | "devolutiva" | "awaiting_signature" | "lead" | "rejected";

export const APPROVED_STAGES = [
  { key: "aprovado", label: "Aprovado", color: "bg-green-500" },
  { key: "30_dias", label: "30 dias", color: "bg-sky-500" },
  { key: "60_dias", label: "60 dias", color: "bg-yellow-500" },
  { key: "90_dias", label: "90 dias", color: "bg-orange-500" },
  { key: "120_dias", label: "120 dias", color: "bg-violet-500" },
] as const;

export const REJECTED_STAGES = [
  { key: "reprovado", label: "Reprovado", color: "bg-red-500" },
  { key: "60_dias", label: "60 dias", color: "bg-yellow-500" },
] as const;

export function formatPhoneDisplay(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 5)} ${d.slice(5, 9)}-${d.slice(9)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 3)} ${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

export function formatCpfDisplay(cpf: string): string {
  const d = cpf.replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return cpf;
}

export function getInitials(name: string | null): string {
  if (!name || name.trim() === "" || name === "Sem nome") return "?";
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export function getStatusBadge(status: string | null | undefined) {
  switch (status) {
    case "approved": return { label: "Aprovado", className: "bg-green-500/15 text-green-400 border-green-500/20" };
    case "rejected": return { label: "Reprovado", className: "bg-red-900/20 text-red-300 border-red-800/30" };
    case "devolutiva": return { label: "Devolutiva", className: "bg-red-500/15 text-red-400 border-red-500/20" };
    case "awaiting_signature": return { label: "Falta Assinatura", className: "bg-orange-500/15 text-orange-400 border-orange-500/20" };
    case "pending": return { label: "Pendente", className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20" };
    case "lead": return { label: "Lead", className: "bg-blue-500/15 text-blue-400 border-blue-500/20" };
    default: return { label: status || "Novo", className: "bg-muted text-muted-foreground border-border" };
  }
}

export function normalizePhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 0) return "";
  // Já com país BR (55 + DDD + 8/9)
  if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) return digits;
  // Celular/fixo nacional com DDD
  if (digits.length === 11 || digits.length === 10) return `55${digits}`;
  // 12–13 dígitos sem 55 reconhecível → mantém (já internacional/legado)
  if (digits.length >= 12 && digits.length <= 13) return digits;
  // Curto demais (<10) ou longo demais → vazio (não inventa DDD/país)
  return "";
}

export function normalizeCustomerPhone(value: string | null | undefined): string {
  return normalizePhone(String(value || "").split("@")[0].split("_")[0]);
}

export function mapStatus(andamento: string | undefined): string {
  if (!andamento) return "pending";
  const lower = andamento.toLowerCase().trim();
  if (lower === "validado" || lower === "aprovado" || lower === "ativo") return "approved";
  if (lower === "devolutiva") return "devolutiva";
  if (lower === "reprovado" || lower === "cancelado") return "rejected";
  if (lower.includes("falta assinatura") || lower.includes("assinatura")) return "awaiting_signature";
  if (lower.includes("facial") || lower.includes("biometr")) return "pending";
  if (lower.includes("otp") || lower.includes("token")) return "pending";
  if (lower.includes("aguardando") || lower.includes("em análise") || lower.includes("em analise")) {
    return "pending";
  }
  if (lower === "pendente") return "pending";
  if (lower === "lead" || lower === "novo") return "lead";
  if (lower === "dados completos" || lower === "data_complete") return "data_complete";
  if (lower === "registrado" || lower === "registered_igreen") return "registered_igreen";
  if (lower === "contrato enviado" || lower === "contract_sent") return "contract_sent";
  // Status desconhecido do portal: pending explícito (não inventa approved)
  return "pending";
}

export function safeString(val: unknown): string | null {
  if (val == null || val === "" || val === undefined) return null;
  const s = String(val).trim();
  return s.length > 0 ? s : null;
}

export function safeNumber(val: unknown): number | null {
  if (val == null || val === "" || val === undefined) return null;
  const n = parseFloat(String(val).replace(",", ".").replace("%", ""));
  return isNaN(n) ? null : n;
}

export function findColumnValue(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] != null && row[key] !== "") return row[key];
    const found = Object.keys(row).find((k) => k.toLowerCase().trim() === key.toLowerCase().trim());
    if (found && row[found] != null && row[found] !== "") return row[found];
  }
  return null;
}

export function buildWhatsAppMessage(customer: Customer): string {
  const nome = customer.name || "cliente";
  if (customer.devolutiva || customer.andamento_igreen?.toLowerCase().includes("devolutiva")) {
    return `Olá ${nome}! 👋\n\nIdentificamos uma pendência no seu cadastro de energia solar:\n\n⚠️ *Devolutiva:* ${customer.devolutiva || customer.andamento_igreen || "Verificar pendência"}\n${customer.distribuidora ? `📍 *Distribuidora:* ${customer.distribuidora}` : ""}\n\nPodemos resolver isso juntos? Me avise se precisar de ajuda! 🙏`;
  }
  if (customer.andamento_igreen?.toLowerCase().includes("falta assinatura")) {
    return `Olá ${nome}! 👋\n\nSeu cadastro de energia solar está quase pronto! Falta apenas a *assinatura* para concluir o processo. ✍️\n${customer.distribuidora ? `📍 *Distribuidora:* ${customer.distribuidora}` : ""}\n\nPode assinar o quanto antes para garantir seu desconto? 💚`;
  }
  return `Olá ${nome}! 👋\n\nTudo bem? Estou entrando em contato sobre seu cadastro de energia solar.\n${customer.distribuidora ? `📍 *Distribuidora:* ${customer.distribuidora}` : ""}\n\nPosso te ajudar com alguma dúvida? 💚`;
}

export function isDevolutiva(c: Customer): boolean {
  return !!(c.devolutiva || c.andamento_igreen?.toLowerCase().includes("devolutiva"));
}

export function getStageDotsForCustomer(status: string | null | undefined, deal?: { stage: string; deal_origin?: string | null }) {
  const isRejected = deal?.deal_origin === "reprovado" || deal?.stage === "reprovado" || status === "rejected";
  const stages = isRejected ? REJECTED_STAGES : APPROVED_STAGES;
  const currentIdx = deal ? stages.findIndex((item) => item.key === deal.stage) : -1;

  return stages.map((item, idx) => ({
    ...item,
    reached: currentIdx >= idx,
  }));
}

export function buildCustomerData(row: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  const tipoProduto = safeString(findColumnValue(row, "Tipo Produto", "tipo_produto", "Tipo", "tipo", "Segmento", "segmento"));
  if (tipoProduto) {
    const lower = tipoProduto.toLowerCase();
    if (lower.includes("telecom") || lower.includes("telefon") || lower.includes("celular") || lower.includes("plano")) {
      data.tipo_produto = "telefonia";
    } else {
      data.tipo_produto = "energia";
    }
  }
  const mediaConsumo = safeNumber(findColumnValue(row, "Consumo Médio", "Consumo Medio", "Consumo", "consumo"));
  if (mediaConsumo != null) data.media_consumo = mediaConsumo;

  const cpf = safeString(findColumnValue(row, "Documento", "CPF", "cpf", "CNPJ"));
  if (cpf) data.cpf = cpf.replace(/\D/g, "");

  const instalacao = safeString(findColumnValue(row, "Instalação", "Instalacao", "Nº Instalação", "N Instalacao"));
  if (instalacao) data.numero_instalacao = instalacao;

  const cidade = safeString(findColumnValue(row, "Cidade", "cidade", "Municipio", "Município"));
  if (cidade) data.address_city = cidade;

  const uf = safeString(findColumnValue(row, "UF", "uf", "Estado", "estado"));
  if (uf) data.address_state = (uf as string).toUpperCase();

  const distribuidora = safeString(findColumnValue(row, "Distribuidora", "distribuidora"));
  if (distribuidora) data.distribuidora = distribuidora;

  const email = safeString(findColumnValue(row, "E-mail", "Email", "email", "EMAIL"));
  if (email) data.email = email;

  const desconto = safeNumber(findColumnValue(row, "Desconto Cliente", "Desconto", "desconto"));
  if (desconto != null) data.desconto_cliente = desconto;

  const nascimento = safeString(findColumnValue(row, "Data Nascimento", "Nascimento", "data_nascimento"));
  if (nascimento) data.data_nascimento = nascimento;

  const licenciado = safeString(findColumnValue(row, "Licenciado", "licenciado", "LICENCIADO", "Nome Licenciado", "Nome do Licenciado", "Consultor", "consultor", "Representante", "representante"));
  if (licenciado) data.registered_by_name = licenciado;

  const codigoLic = safeString(findColumnValue(row, "Código Licenciado", "Codigo Licenciado", "código licenciado", "CÓDIGO LICENCIADO", "Cod Licenciado", "Cod. Licenciado", "ID Licenciado", "Cód Licenciado", "Cód. Licenciado"));
  if (codigoLic) data.registered_by_igreen_id = codigoLic;

  const andamento = safeString(findColumnValue(row, "Andamento", "andamento"));
  if (andamento) data.andamento_igreen = andamento;

  const devolutiva = safeString(findColumnValue(row, "Devolutiva", "devolutiva"));
  if (devolutiva) data.devolutiva = devolutiva;

  const observacao = safeString(findColumnValue(row, "Observação", "Observacao", "observação", "observacao", "Obs"));
  if (observacao) data.observacao = observacao;

  const igreenCode = safeString(findColumnValue(row, "Código", "Codigo", "código", "codigo"));
  if (igreenCode) data.igreen_code = igreenCode;

  const dataCadastro = safeString(findColumnValue(row, "Data Cadastro", "data_cadastro"));
  if (dataCadastro) data.data_cadastro = dataCadastro;

  const dataAtivo = safeString(findColumnValue(row, "Data Ativo", "data_ativo"));
  if (dataAtivo) data.data_ativo = dataAtivo;

  const dataValidado = safeString(findColumnValue(row, "Data Validado", "data_validado"));
  if (dataValidado) data.data_validado = dataValidado;

  const statusFinanceiro = safeString(findColumnValue(row, "Status Financeiro", "status_financeiro"));
  if (statusFinanceiro) data.status_financeiro = statusFinanceiro;

  const cashbackVal = safeString(findColumnValue(row, "Cashback", "cashback"));
  if (cashbackVal) data.cashback = cashbackVal;

  const nivel = safeString(findColumnValue(row, "Nível", "Nivel", "nível", "nivel"));
  if (nivel) data.nivel_licenciado = nivel;

  const assinaturaCliente = safeString(findColumnValue(row, "Assinatura Cliente", "assinatura_cliente"));
  if (assinaturaCliente) data.assinatura_cliente = assinaturaCliente;

  const assinaturaIgreen = safeString(findColumnValue(row, "Assinatura iGreen", "Assinatura Igreen", "assinatura_igreen"));
  if (assinaturaIgreen) data.assinatura_igreen = assinaturaIgreen;

  const linkAssinatura = safeString(findColumnValue(row, "Link Assinatura", "link_assinatura"));
  if (linkAssinatura) data.link_assinatura = linkAssinatura;

  const indicador = safeString(findColumnValue(row, "Indicador", "indicador", "Indicado Por", "indicado_por", "Quem Indicou", "Referido Por"));
  if (indicador) data.customer_referred_by_name = indicador;

  const indicadorPhone = safeString(findColumnValue(row, "Telefone Indicador", "telefone_indicador", "Celular Indicador"));
  if (indicadorPhone) data.customer_referred_by_phone = indicadorPhone;

  return data;
}
