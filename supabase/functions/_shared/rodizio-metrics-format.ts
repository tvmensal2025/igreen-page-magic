// Monta a mensagem WhatsApp de "atualização do rodízio" enviada de tempos em
// tempos para cada parceiro de um pool. Puro / testável isolado.

export interface RodizioMetricsInput {
  campaignName: string;
  campaignStatus: string; // active | paused | ...
  // Métricas AO VIVO da Meta (sempre passar os números reais da Graph API)
  spendTodayCents: number;
  reachToday: number;
  impressionsToday: number;
  conversationsStartedToday: number; // messaging_conversation_started_7d (Meta)
  spend7dCents: number;
  conversations7d: number;
  // Leads reais do CRM (customers.source_campaign_id)
  leadsCrmToday: number;
  leadsCrm7d: number;
  // Parceiro
  partnerPosition: number; // 1-based
  partnerPoolSize: number;
  partnerLeadsTotal: number;
  partnerNewLeadsSinceLast: number;
  nowLabel: string; // "08/07 15:20"
  intervalMinutes: number; // para o rodapé
}

function brl(cents: number): string {
  const v = (cents || 0) / 100;
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ordinal(n: number): string {
  return `${n}º`;
}

function intervalLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = min / 60;
  return h === 1 ? "1 hora" : `${h} horas`;
}

export function formatRodizioMetricsMessage(m: RodizioMetricsInput): string {
  const lines: string[] = [];

  if (m.partnerNewLeadsSinceLast > 0) {
    lines.push(`🔥 *VOCÊ RECEBEU ${m.partnerNewLeadsSinceLast} LEAD${m.partnerNewLeadsSinceLast > 1 ? "S" : ""} NOVO${m.partnerNewLeadsSinceLast > 1 ? "S" : ""}!*`);
    lines.push(``);
  }

  lines.push(`📊 *RODÍZIO — Atualização*`);
  lines.push(`━━━━━━━━━━━━━━━━━━`);
  lines.push(`🎯 ${m.campaignName}`);
  lines.push(`🕐 ${m.nowLabel}`);

  if (m.campaignStatus !== "active") {
    lines.push(``);
    lines.push(`⚠️ *Status:* ${m.campaignStatus.toUpperCase()}`);
  }

  lines.push(``);
  lines.push(`💰 *Hoje (ao vivo da Meta)*`);
  lines.push(`├ Investido: R$ ${brl(m.spendTodayCents)}`);
  lines.push(`├ Alcance: ${m.reachToday.toLocaleString("pt-BR")} pessoas`);
  lines.push(`├ Impressões: ${m.impressionsToday.toLocaleString("pt-BR")}`);
  lines.push(`├ Conversas iniciadas: ${m.conversationsStartedToday}`);
  lines.push(`└ Leads no CRM: ${m.leadsCrmToday}`);

  lines.push(``);
  lines.push(`📆 *Últimos 7 dias*`);
  lines.push(`├ Investido: R$ ${brl(m.spend7dCents)}`);
  lines.push(`├ Conversas: ${m.conversations7d}`);
  lines.push(`└ Leads no CRM: ${m.leadsCrm7d}`);

  lines.push(``);
  lines.push(`👥 *Você no rodízio*`);
  lines.push(`├ Posição: ${ordinal(m.partnerPosition)} de ${m.partnerPoolSize}`);
  lines.push(`└ Seus leads totais: ${m.partnerLeadsTotal}`);

  lines.push(``);
  if (m.spendTodayCents === 0 && m.impressionsToday === 0 && m.campaignStatus === "active") {
    lines.push(`🌱 Campanha acabou de sair. Meta começa a entregar em até 24h.`);
  } else if (m.conversationsStartedToday === 0 && m.impressionsToday > 0) {
    lines.push(`😴 Já teve entrega, mas ninguém clicou pra conversar ainda. Aguardando.`);
  } else if (m.leadsCrmToday > 0) {
    lines.push(`✅ Campanha entregando leads hoje.`);
  } else if (m.conversationsStartedToday > 0) {
    lines.push(`💬 Conversas iniciadas na Meta — leads devem cair no CRM em minutos.`);
  }
  lines.push(``);
  lines.push(`_Próxima atualização em ~${intervalLabel(m.intervalMinutes)}_`);
  lines.push(`_Dados ao vivo da Meta Ads_`);

  return lines.join("\n");
}

export function formatRodizioFallbackMessage(campaignName: string, nowLabel: string, intervalMinutes: number): string {
  return [
    `📊 *RODÍZIO — Atualização*`,
    `━━━━━━━━━━━━━━━━━━`,
    `🎯 ${campaignName}`,
    `🕐 ${nowLabel}`,
    ``,
    `⚠️ Não consegui puxar as métricas ao vivo da Meta agora.`,
    `Vou tentar de novo em ~${intervalLabel(intervalMinutes)}.`,
  ].join("\n");
}
