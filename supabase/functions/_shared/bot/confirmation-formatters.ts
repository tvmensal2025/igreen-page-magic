/**
 * Textos de confirmação conta/doc (puros).
 * Compartilhado Whapi ↔ Evolution — sem mudança de comportamento.
 */

export function formatBRL(n: number): string {
  return Number(n || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function buildConfirmacaoConta(merged: any): string {
  const v = Number(merged.electricity_bill_value || 0);
  return "📋 *Dados da conta:*\n\n" +
    `👤 *Nome:* ${merged.bill_holder_name || merged.name || "❌"}\n` +
    `📍 *Endereço:* ${merged.address_street || "❌"} ${merged.address_number || ""}\n` +
    `🏘️ *Bairro:* ${merged.address_neighborhood || "❌"}\n` +
    `🏙️ *Cidade:* ${merged.address_city || "❌"} - ${merged.address_state || ""}\n` +
    `📮 *CEP:* ${merged.cep || "❌"}\n` +
    `⚡ *Distribuidora:* ${merged.distribuidora || "❌"}\n` +
    `🔢 *Nº Instalação:* ${merged.numero_instalacao || "❌"}\n` +
    `💰 *Valor:* R$ ${formatBRL(v)}\n\n` +
    "Está tudo correto?";
}

export function buildConfirmacaoDoc(merged: any): string {
  return `📋 *Confirme seus dados pessoais:*\n\n` +
    `👤 Nome: *${merged.doc_holder_name || merged.name || "—"}*\n` +
    `🆔 CPF: *${merged.cpf || "—"}*\n` +
    `🪪 RG: *${merged.rg || "—"}*\n` +
    `🎂 Nascimento: *${merged.data_nascimento || "—"}*\n\n` +
    "Está tudo correto?";
}
