/**
 * Scripts canônicos — Venda da Plataforma (SuperAdmin).
 * Ordem fixa: bloco_nome → bloco_saudacao → corpo.
 * Isolado da cadência A/B/C, Cérebro e pós-venda.
 */

import { isUsableCustomerName } from "@/lib/customerDisplayName";

export type PlatformSalesDay = "d0" | "d1";
export type PlatformSalesChannel = "whatsapp" | "sms" | "call";

export type PlatformSalesScriptSettings = {
  bloco_nome_com: string;
  bloco_nome_sem: string;
  saudacao_manha: string;
  saudacao_tarde: string;
  saudacao_noite: string;
  corpo_wa_d0: string;
  corpo_wa_d1: string;
  corpo_sms_d0: string;
  corpo_sms_d1: string;
  corpo_call_d0: string;
  corpo_call_d1: string;
};

export const DEFAULT_PLATFORM_SALES_SCRIPTS: PlatformSalesScriptSettings = {
  bloco_nome_com: "{{nome}}, tudo bem?",
  bloco_nome_sem: "Tudo bem?",
  saudacao_manha: "Muito bom dia!",
  saudacao_tarde: "Muito boa tarde!",
  saudacao_noite: "Muito boa noite!",
  // WA: formatação WhatsApp (*negrito* + emoji). Ligação fica em corpo_call_* (sem markdown).
  corpo_wa_d0: `Sou a *Sofia*, assistente virtual do *Rafael*, gestor da *iGreen*.

Te chamo porque montamos uma *plataforma de vendas* para consultor iGreen — do primeiro contato do lead até o pós-venda.

✨ *O que ela faz na prática:*

💬 Atende no *WhatsApp*, manda *SMS* e também *liga*
📊 *Landing pages* e conversão de todos os produtos, prontas, com dados gráficos
🎯 Ajuda a *criar campanha* e organizar o lead
📝 Conduz o *cadastro pelo sistema* (menos retrabalho pra você)
🤝 Seu parceiro coloca um *banner* e o cliente dele cadastra *pra você* — o sistema cuida de tudo
🎉 Cliente aprovado → mensagem de *parabéns* + como usar o app
💚 Em 30 dias → reforço do *iGreen Club* + pedido de indicação
📅 Acompanhamento por cerca de *7 meses*, até o cliente estar pagando certinho

✅ *Resumo:* uma IA especializada em iGreen — *não* um robô genérico.

🎁 Como eu tenho certeza do que estou falando: *teste gratuito de 7 dias*, *sem nenhum depósito inicial*.

🚀 *Vamos construir uma base forte* com acompanhamento real e um sistema que evolui todos os dias.`,
  corpo_wa_d1: `👋 *Sofia* de novo.

Ontem te falei da *plataforma de vendas iGreen*:

💬 *WhatsApp* + 📲 *SMS* + 📞 *ligação*
📊 Landings e conversão com dados gráficos
📝 Cadastro pelo sistema
🤝 Banner do parceiro cadastra *pra você*
💚 Pós-venda: parabéns, app, Club em 30 dias, indicação — cerca de *7 meses*

🎁 *Teste grátis de 7 dias* — sem depósito inicial. Você experimenta antes de decidir.

🚀 *Vamos construir uma base forte* com acompanhamento real e um sistema que evolui todos os dias.

👉 Responde: *VER* | *RESUMO* | *DEPOIS*`,
  corpo_sms_d0:
    "Sofia (Rafael/iGreen). Plataforma Zap+SMS+ligacao. Teste gratis 7 dias, sem deposito inicial. Quer ver? SIM",
  corpo_sms_d1:
    "Sofia (iGreen). Ainda quer o teste gratis de 7 dias da plataforma (sem deposito)? VER ou DEPOIS",
  corpo_call_d0: `Sou a Sofia, assistente virtual do Rafael, gestor da iGreen.

Te chamo porque montamos uma plataforma de vendas para consultor iGreen — do primeiro contato do lead até o pós-venda.

O que ela faz na prática:
• Atende no WhatsApp, manda SMS e também liga
• Landing pages e conversão de todos os produtos, prontas para usar, com dados gráficos
• Ajuda a criar campanha e organizar o lead
• Conduz o cadastro pelo sistema (menos retrabalho pra você)
• Seu parceiro pode colocar um banner e qualquer cliente dele que ler nossa plataforma vai cadastrar para você — o sistema cuida de tudo
• Cliente aprovado → mensagem de parabéns + como usar o app
• Em 30 dias → reforço do iGreen Club + pedido de indicação
• Acompanhamento por cerca de 7 meses, até o cliente estar pagando certinho

Resumo: uma IA especializada em iGreen, não um robô genérico.

Como eu tenho certeza do que estou falando: você pode fazer um teste gratuito de 7 dias, sem nenhum depósito inicial.

VAMOS CONSTRUIR UMA BASE FORTE COM ACOMPANHAMENTO REAL COM UM SISTEMA QUE ESTÁ EVOLUINDO TODOS OS DIAS.`,
  corpo_call_d1: `Sofia de novo, do Rafael da iGreen.
Só confirmando se ainda faz sentido te mostrar a plataforma: Zap, SMS, ligação, landings com gráficos, banner do parceiro e pós-venda por cerca de 7 meses.
Lembra: teste gratuito de 7 dias, sem nenhum depósito inicial.
VAMOS CONSTRUIR UMA BASE FORTE COM ACOMPANHAMENTO REAL.
Prefere agora ou o resumo no WhatsApp?`,
};

/** Estágios do CRM — venda da plataforma (consultor iGreen). Isolado do Kanban de leads. */
export const PLATFORM_SALES_CRM_STAGES = [
  { id: "novo", label: "Novo" },
  { id: "contatado", label: "Contatado" },
  { id: "respondeu", label: "Respondeu" },
  { id: "demo", label: "Demo / call" },
  { id: "negociacao", label: "Negociação" },
  { id: "fechado", label: "Fechado" },
  { id: "perdido", label: "Perdido" },
] as const;

export type PlatformSalesCrmStage = (typeof PLATFORM_SALES_CRM_STAGES)[number]["id"];


/** Prenome só se texto parecer pessoa (fonte manual na lista SA). */
export function platformSalesSafeFirstName(raw: string | null | undefined): string {
  if (!isUsableCustomerName(raw)) return "";
  const first = String(raw || "").trim().split(/\s+/)[0] || "";
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export function hourBRT(now: Date = new Date()): number {
  return (
    Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        hour12: false,
      }).format(now),
    ) % 24
  );
}

export function resolveSaudacaoBlock(
  scripts: Pick<PlatformSalesScriptSettings, "saudacao_manha" | "saudacao_tarde" | "saudacao_noite">,
  now: Date = new Date(),
): string {
  const h = hourBRT(now);
  if (h < 12) return scripts.saudacao_manha;
  if (h < 18) return scripts.saudacao_tarde;
  return scripts.saudacao_noite;
}

export function resolveNomeBlock(
  scripts: Pick<PlatformSalesScriptSettings, "bloco_nome_com" | "bloco_nome_sem">,
  rawName: string | null | undefined,
): string {
  const nome = platformSalesSafeFirstName(rawName);
  if (!nome) return scripts.bloco_nome_sem;
  return scripts.bloco_nome_com.replace(/\{\{\s*nome\s*\}\}/gi, nome);
}

function pickCorpo(
  scripts: PlatformSalesScriptSettings,
  day: PlatformSalesDay,
  channel: PlatformSalesChannel,
): string {
  if (channel === "whatsapp") return day === "d0" ? scripts.corpo_wa_d0 : scripts.corpo_wa_d1;
  if (channel === "sms") return day === "d0" ? scripts.corpo_sms_d0 : scripts.corpo_sms_d1;
  return day === "d0" ? scripts.corpo_call_d0 : scripts.corpo_call_d1;
}

export type ComposePlatformSalesMessageInput = {
  scripts?: PlatformSalesScriptSettings;
  name?: string | null;
  day: PlatformSalesDay;
  channel: PlatformSalesChannel;
  now?: Date;
};

/** Monta mensagem na ordem: nome → saudação → corpo. */
export function composePlatformSalesMessage(input: ComposePlatformSalesMessageInput): string {
  const scripts = input.scripts ?? DEFAULT_PLATFORM_SALES_SCRIPTS;
  const nome = resolveNomeBlock(scripts, input.name);
  const saudacao = resolveSaudacaoBlock(scripts, input.now ?? new Date());
  const corpo = pickCorpo(scripts, input.day, input.channel).trim();
  if (input.channel === "sms") {
    return `${nome} ${saudacao} ${corpo}`.replace(/\s{2,}/g, " ").trim();
  }
  // WhatsApp: negrito no nome e na saudação (ligação/SMS não usam markdown).
  if (input.channel === "whatsapp") {
    const first = platformSalesSafeFirstName(input.name);
    const nomeWa = first ? `*${first}*, tudo bem?` : "*Tudo bem?*";
    const saudWa = `☀️ *${saudacao}*`;
    return `${nomeWa}\n${saudWa}\n\n${corpo}`.trim();
  }
  return `${nome}\n${saudacao}\n\n${corpo}`.trim();
}
