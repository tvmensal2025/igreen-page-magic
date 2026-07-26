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
  const name = prettyCampaignName(input.campaignName);
  const ruleLabel = humanizeWasteRule(input.rule);
  const motivo = humanizeWasteReason(input.reason, input.rule, input.spendCents);
  const metrics: string[] = [];
  if (input.spendCents != null) {
    metrics.push(`💸 Gasto (48h): *${brl(input.spendCents)}*`);
  }
  if (input.conversations != null) {
    metrics.push(`💬 Conversas no WhatsApp: *${input.conversations}*`);
  }
  if (input.clicks != null) {
    metrics.push(`👆 Cliques no anúncio: *${input.clicks}*`);
  }
  return [
    `🛡️ *iGreen · Campanha pausada*`,
    `━━━━━━━━━━━━━━━━`,
    ``,
    `Olá! Pausei uma campanha para *proteger seu saldo*.`,
    ``,
    `🎯 *${name}*`,
    `🕐 ${when}`,
    ...(ruleLabel ? [`📌 Motivo técnico: *${ruleLabel}*`] : []),
    ``,
    ...(metrics.length ? [`📊 *Resumo da janela*`, ...metrics, ``] : []),
    `📝 *O que aconteceu*`,
    motivo,
    ``,
    `🔒 *Próximo passo*`,
    `Ela fica *travada* até você revisar.`,
    `O sistema *não* liga sozinho de novo.`,
    ``,
    `👉 Abra a *Central de Anúncios*`,
    `→ confira o WhatsApp de destino`,
    `→ toque em *Play* quando estiver ok.`,
    ``,
    `💚 Quem já entrou no funil continua sendo atendido.`,
    ...FOOTER,
  ].join("\n");
}

/** SMS curto (≤160) em português — fallback quando o WhatsApp de aviso falha. */
export function formatCerebroWastePauseSms(input: {
  campaignName: string;
  spendCents?: number | null;
}): string {
  const name = prettyCampaignName(input.campaignName).slice(0, 32);
  const spend = input.spendCents != null
    ? brl(input.spendCents).replace(/\s/g, "")
    : null;
  const base = spend
    ? `iGreen: pausei "${name}" (${spend} sem conversa no Zap). Protegendo saldo. Abra Anúncios, revise o WhatsApp e use Play.`
    : `iGreen: pausei "${name}" sem conversa no Zap. Protegendo saldo. Abra Anúncios, revise o WhatsApp e use Play.`;
  return base.slice(0, 160);
}

function prettyCampaignName(raw: string | null | undefined): string {
  return String(raw || "Campanha")
    .replace(/\[CONS-[^\]]+\]/gi, "")
    .replace(/\s*[·—–]\s*iGreen.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60) || "Campanha";
}

function humanizeWasteRule(rule: string | null | undefined): string | null {
  const r = String(rule || "").toLowerCase();
  if (r === "zero_conv") return "gasto sem conversa no WhatsApp";
  if (r === "zero_click") return "gasto sem clique no anúncio";
  if (r === "zombie_ad") return "anúncio gastando sem conversa";
  return null;
}

function humanizeWasteReason(
  reason: string,
  rule?: string | null,
  spendCents?: number | null,
): string {
  const raw = String(reason || "").trim();
  const lower = raw.toLowerCase();
  if (lower.includes("sem conversa") || String(rule || "") === "zero_conv") {
    const spend = spendCents != null ? brl(spendCents) : null;
    return spend
      ? `A campanha gastou *${spend}* e *ninguém iniciou conversa* no WhatsApp pelo anúncio. Pausei para não queimar verba à toa.`
      : `A campanha gastou e *ninguém iniciou conversa* no WhatsApp pelo anúncio. Pausei para não queimar verba à toa.`;
  }
  if (lower.includes("sem clique") || String(rule || "") === "zero_click") {
    return `A campanha gastou e *não teve clique*. Pausei para revisar o criativo e a segmentação.`;
  }
  // Remove prefixos técnicos em inglês / códigos internos
  return raw
    .replace(/^AUTO_PERF_PAUSE:\s*/i, "")
    .replace(/\s*—\s*só reativa no Play\s*$/i, "")
    .replace(/Waste guard:\s*/i, "")
    .trim() || "Pausei por proteção de desempenho.";
}
