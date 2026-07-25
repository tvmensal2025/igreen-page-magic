/**
 * Mensagens WhatsApp do Cérebro Ads (consultor).
 * Estilo alinhado a brain-budget-scale / rodizio-metrics-format.
 */

function brl(cents: number): string {
  const v = (Number(cents) || 0) / 100;
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function nowBrLabel(): string {
  try {
    return new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date().toISOString().slice(0, 16).replace("T", " ");
  }
}

const FOOTER = [
  ``,
  `💪 Seguimos no piloto automático.`,
  `✨ _iGreen Ads · Cérebro_`,
];

/** Snapshot após ensure de slots preferidos (ativa/pausa/alinha budget). */
export function formatCerebroSlotsWhatsApp(input: {
  explorers: string[];
  anchorBudgetCents: number;
  explorerBudgetCents: number;
  ageMin: number;
  activated?: string[];
  paused?: string[];
}): string {
  const explorers = (input.explorers || []).filter(Boolean);
  const activated = (input.activated || []).filter(Boolean);
  const paused = (input.paused || []).filter(Boolean);
  const when = nowBrLabel();
  const lines = [
    `🧠✨ *Cérebro iGreen · Autopilot*`,
    `━━━━━━━━━━━━━━━━`,
    `🗺️ *Mapa de praças atualizado*`,
    ``,
    `🕐 ${when}`,
    ``,
    `📍 *Âncora*`,
    `🏙️ Uberlândia · ${brl(input.anchorBudgetCents)}/dia`,
    ``,
    `🚀 *Exploradoras no ar* (${explorers.length})`,
    explorers.length
      ? explorers.map((c) => `• ${c}`).join("\n")
      : `• _(nenhuma no momento)_`,
    `💵 Budget exploradora: *${brl(input.explorerBudgetCents)}*/dia`,
    `👤 Idade preferida: *${input.ageMin}+*`,
  ];
  if (activated.length) {
    lines.push(``, `✅ *Entraram no ar*`, ...activated.map((c) => `• ${c}`));
  }
  if (paused.length) {
    lines.push(
      ``,
      `⏸️ *Voltaram pra fila*`,
      ...paused.map((c) => `• ${c}`),
      `_Só reativam no Play ou se voltarem ao preferred._`,
    );
  }
  lines.push(
    ``,
    `💡 *Leitura rápida*`,
    `O Cérebro mantém as praças com melhor sinal`,
    `e guarda o resto na fila — sem gastar à toa.`,
    ...FOOTER,
  );
  return lines.join("\n");
}

/** Nova cidade semeada (queue_only / pausada na fila). */
export function formatCerebroSeedWhatsApp(input: {
  cityName: string;
  budgetCents: number;
  protocol?: string | null;
  campaignId?: string | null;
}): string {
  const when = nowBrLabel();
  return [
    `🧠✨ *Cérebro iGreen · Autopilot*`,
    `━━━━━━━━━━━━━━━━`,
    `🌱 *Nova praça semeada*`,
    ``,
    `🏙️ *${input.cityName}*`,
    `🕐 ${when}`,
    ``,
    `📦 Status: *na fila* (pausada)`,
    `💵 Budget preparado: *${brl(input.budgetCents)}*/dia`,
    ...(input.protocol ? [`📋 Protocolo interno: \`${input.protocol}\``] : []),
    ``,
    `💡 *O que isso significa*`,
    `A campanha já existe na Meta, com criativo`,
    `vencedor e copy da cidade — *sem gastar ainda*.`,
    ``,
    `Quando sobrar slot e saldo, o Cérebro`,
    `liga sozinho (ou você dá Play no painel).`,
    ...FOOTER,
  ].join("\n");
}

/** Exploradora ativada (slot livre + saldo). */
export function formatCerebroActivateWhatsApp(input: {
  cityName: string;
  budgetCents: number;
}): string {
  const when = nowBrLabel();
  return [
    `🧠✨ *Cérebro iGreen · Autopilot*`,
    `━━━━━━━━━━━━━━━━`,
    `🟢 *Praça no ar!*`,
    ``,
    `🏙️ *${input.cityName}*`,
    `🕐 ${when}`,
    ``,
    `💵 Investimento: *${brl(input.budgetCents)}*/dia`,
    `📡 Status: *ativa* na Meta`,
    ``,
    `💡 *Leitura rápida*`,
    `Entrou no rodízio de slots do Cérebro.`,
    `Waste guard e escala de âncora seguem`,
    `cuidando do custo por conversa.`,
    ...FOOTER,
  ].join("\n");
}

/** Waste guard — mensagem rica pro consultor (parceiro usa rodizio-pause-notify). */
export function formatCerebroWastePauseWhatsApp(input: {
  campaignName: string;
  reason: string;
  spendCents?: number | null;
  conversations?: number | null;
  clicks?: number | null;
  rule?: string | null;
}): string {
  const when = nowBrLabel();
  const name = String(input.campaignName || "Campanha").slice(0, 60);
  const metrics: string[] = [];
  if (input.spendCents != null) {
    metrics.push(`💸 Gasto 48h: *${brl(input.spendCents)}*`);
  }
  if (input.conversations != null) {
    metrics.push(`💬 Conversas: *${input.conversations}*`);
  }
  if (input.clicks != null) {
    metrics.push(`👆 Cliques: *${input.clicks}*`);
  }
  return [
    `🧠✨ *Cérebro iGreen · Autopilot*`,
    `━━━━━━━━━━━━━━━━`,
    `🛡️ *Pausa por performance*`,
    ``,
    `🎯 *${name}*`,
    `🕐 ${when}`,
    ...(input.rule ? [`📌 Regra: \`${input.rule}\``] : []),
    ``,
    ...(metrics.length ? [`📊 *Janela 48h*`, ...metrics, ``] : []),
    `📝 *Motivo*`,
    input.reason,
    ``,
    `🔒 *Importante*`,
    `Fica *travada* (AUTO_PERF) — o Cérebro`,
    `*não* reativa sozinho.`,
    `Só volta com *Play* no painel, depois da sua revisão.`,
    ``,
    `💚 Leads que já chegaram seguem no funil.`,
    `✨ _iGreen Ads · Cérebro_`,
  ].join("\n");
}
