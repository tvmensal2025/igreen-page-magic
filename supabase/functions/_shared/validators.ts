import { isCNH } from "./document-type.ts";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ── Listas de bloqueio (placeholders / contatos do consultor) ──
const PLACEHOLDER_EMAIL_PATTERNS: RegExp[] = [
  /@lead\.igreen$/i,
  /@teste/i,
  /^teste@/i,
  /^noreply@/i,
  /^sem_email/i,
  /^sem-email/i,
  /@example\./i,
  /@exemplo\./i,
];

const PLACEHOLDER_PHONE_PATTERNS: RegExp[] = [
  /^sem_celular/i,
  /^sem-celular/i,
];

/** Valida formato básico de email */
export function isValidEmailFormat(email: string): boolean {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Detecta emails que são placeholders/de teste e nunca podem ir ao portal */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return true;
  const t = String(email).trim();
  if (t.length === 0) return true;
  return PLACEHOLDER_EMAIL_PATTERNS.some((rx) => rx.test(t));
}

/** Detecta telefones placeholder (importação iGreen sem celular) */
export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  if (!phone) return true;
  const t = String(phone).trim();
  if (t.length === 0) return true;
  return PLACEHOLDER_PHONE_PATTERNS.some((rx) => rx.test(t));
}

/** Compara dois contatos (email ou phone) ignorando formatação trivial */
export function isSameContact(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = String(a).trim().toLowerCase();
  const nb = String(b).trim().toLowerCase();
  if (na === nb) return true;
  // Para telefones: comparar apenas dígitos
  const da = na.replace(/\D/g, "");
  const db = nb.replace(/\D/g, "");
  if (da.length >= 10 && db.length >= 10) {
    return da.slice(-11) === db.slice(-11);
  }
  return false;
}

export function validateCPF(cpf: string): boolean {
  if (!cpf) return false;
  const cpfClean = cpf.replace(/\D/g, "");
  if (cpfClean.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpfClean)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpfClean.charAt(i)) * (10 - i);
  let digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  if (digit !== parseInt(cpfClean.charAt(9))) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpfClean.charAt(i)) * (11 - i);
  digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  if (digit !== parseInt(cpfClean.charAt(10))) return false;
  return true;
}

export function validatePhone(phone: string): boolean {
  if (!phone) return false;
  const phoneClean = phone.replace(/\D/g, "");
  if (phoneClean.length < 10) return false;
  const ddd = phoneClean.startsWith("55") ? phoneClean.substring(2, 4) : phoneClean.substring(0, 2);
  const dddNum = parseInt(ddd);
  return dddNum >= 11 && dddNum <= 99;
}

export function validateCustomerForPortal(customer: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Email: nunca pode ser vazio, placeholder ou do consultor dono ──
  const emailRaw = (customer.email || "").trim();
  if (!emailRaw) {
    errors.push("Email é obrigatório");
  } else if (!isValidEmailFormat(emailRaw)) {
    errors.push("Email com formato inválido");
  } else if (isPlaceholderEmail(emailRaw)) {
    errors.push("Email placeholder/temporário não pode ir ao portal");
  } else if (
    customer.consultant_email &&
    isSameContact(emailRaw, customer.consultant_email)
  ) {
    errors.push("Email do consultor não pode ser usado como email do cliente");
  }
  if (!customer.name || customer.name.trim().length < 3) errors.push("Nome inválido ou muito curto");
  if (!validateCPF(customer.cpf || "")) errors.push("CPF inválido");
  if (!customer.rg || customer.rg.trim().length < 4) errors.push("RG inválido");
  const cepClean = (customer.cep || "").replace(/\D/g, "");
  if (cepClean.length !== 8) errors.push("CEP inválido (deve ter 8 dígitos)");
  if (!customer.address_street || customer.address_street.trim().length < 3) errors.push("Endereço (rua) inválido");
  if (!customer.address_number || customer.address_number.trim().length === 0) errors.push("Número do endereço é obrigatório");
  if (!customer.address_neighborhood || customer.address_neighborhood.trim().length < 2) errors.push("Bairro inválido");
  if (!customer.address_city || customer.address_city.trim().length < 2) errors.push("Cidade inválida");
  if (!customer.address_state || customer.address_state.trim().length !== 2) errors.push("Estado (UF) inválido");
  // ── Telefone: deve estar confirmado pelo cliente no chat ──
  // O telefone que vai ao portal é phone_landline (confirmado), não phone_whatsapp (chave da conversa)
  const phoneForPortal = (customer.phone_landline || "").replace(/\D/g, "");
  const phoneConfirmed = customer.phone_contact_confirmed === true;
  if (isPlaceholderPhone(customer.phone_whatsapp)) {
    errors.push("Telefone placeholder (importação) — cliente precisa confirmar telefone real");
  } else if (!phoneConfirmed) {
    errors.push("Telefone não foi confirmado pelo cliente no chat");
  } else if (!phoneForPortal || phoneForPortal.length < 10 || phoneForPortal.length > 11) {
    errors.push("Telefone inválido (precisa ter DDD + número)");
  } else {
    const ddd = parseInt(phoneForPortal.substring(0, 2));
    if (ddd < 11 || ddd > 99) errors.push("Telefone com DDD inválido");
    // NOTA: Removida checagem "telefone do consultor" aqui.
    // Essa validação já é feita nos steps ask_phone e ask_phone_confirm.
    // Se o cliente passou por esses steps e confirmou, não bloquear na finalização.
    // Manter aqui causava loop infinito quando consultor testava com próprio número.
  }
  const billValue = typeof customer.electricity_bill_value === "string"
    ? parseFloat(customer.electricity_bill_value)
    : customer.electricity_bill_value;
  if (isNaN(billValue) || billValue <= 0) errors.push("Valor da conta inválido");
  // Distribuidora e Nº de instalação são exigidos pelo Portal 2. Normalmente
  // vêm do OCR da conta; quando faltam, o bot pede por texto (ask_distribuidora
  // / ask_installation_number) em vez de travar o lead.
  if (!customer.distribuidora || String(customer.distribuidora).trim().length < 2) errors.push("Distribuidora é obrigatória");
  if (String(customer.numero_instalacao || "").replace(/\D/g, "").length < 7) errors.push("Número de instalação é obrigatório (7+ dígitos)");
  if (!customer.electricity_bill_photo_url || customer.electricity_bill_photo_url.trim().length === 0) errors.push("Foto da conta de luz é obrigatória");
  if (!customer.document_front_url || customer.document_front_url.trim().length === 0) errors.push("Documento (frente) é obrigatório");
  // CNH não tem verso — só exigir para RG (uso normalizado para evitar variações de caixa/texto)
  if (!isCNH(customer.document_type)) {
    const verso = (customer.document_back_url || "").trim();
    if (!verso || verso === "nao_aplicavel") errors.push("Documento (verso) é obrigatório");
  }
  if (customer.name && customer.name.trim().split(/\s+/).length < 2) warnings.push("Nome parece incompleto (sem sobrenome)");
  if (billValue < 50) warnings.push("Valor da conta parece muito baixo");

  return { valid: errors.length === 0, errors, warnings };
}

export function sanitizeCustomerData(customer: any): any {
  const sanitized: any = { ...customer };
  if (sanitized.name) {
    sanitized.name = sanitized.name.trim().split(/\s+/)
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }
  if (sanitized.cpf) {
    const cpfClean = sanitized.cpf.replace(/\D/g, "");
    if (cpfClean.length === 11) sanitized.cpf = cpfClean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (sanitized.cep) {
    const cepClean = sanitized.cep.replace(/\D/g, "");
    if (cepClean.length === 8) sanitized.cep = cepClean.replace(/(\d{5})(\d{3})/, "$1-$2");
  }
  if (sanitized.phone_whatsapp) {
    const phoneClean = sanitized.phone_whatsapp.replace(/\D/g, "");
    sanitized.phone_whatsapp = phoneClean.startsWith("55") ? phoneClean : "55" + phoneClean;
  }
  if (sanitized.address_street) sanitized.address_street = sanitized.address_street.trim();
  if (sanitized.address_number) sanitized.address_number = sanitized.address_number.trim();
  if (sanitized.address_complement) sanitized.address_complement = sanitized.address_complement.trim();
  if (sanitized.address_neighborhood) sanitized.address_neighborhood = sanitized.address_neighborhood.trim();
  if (sanitized.address_city) sanitized.address_city = sanitized.address_city.trim();
  if (sanitized.address_state) sanitized.address_state = sanitized.address_state.trim().toUpperCase();
  // ⚠️ Removido: NUNCA gerar email placeholder @lead.igreen automaticamente.
  // Email só é gravado quando o cliente responde explicitamente em ask_email.
  if (sanitized.rg) sanitized.rg = sanitized.rg.trim();
  return sanitized;
}
