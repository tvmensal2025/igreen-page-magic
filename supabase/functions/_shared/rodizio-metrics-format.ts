// Monta a mensagem WhatsApp de "atualização do rodízio" enviada a cada 10 min
// para cada parceiro de um pool. Puro / testável isolado.

export interface RodizioMetricsInput {
  campaignName: string;
  campaignStatus: string; // active | paused | ...
  spendTodayCents: number;
  reachToday: number;
  leadsToday: number;
  spend7dCents: number;
  leads7d: number;
  partnerPosition: number; // 1-based
  partnerPoolSize: number;
  partnerLeadsTotal: number;
  partnerNewLeadsSinceLast: number; // leads que ele recebeu desde o último envio
  minutesSinceLastLeadInCampaign: number | null; // null = sem leads ainda
  nowLabel: string; // "12/07 14:30"
}

function brl(cents: number): string {
  const v = (cents || 0) / 100;
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ordinal(n: number): string {
  return `${n}º`;
}

export function formatRodizioMetricsMessage(m: RodizioMetricsInput): string {
  const lines: string[] = [];

  // Cabeçalho — muda por situação
  if (m.partnerNewLeadsSinceLast > 0) {
    lines.push(`🔥 *VOCÊ RECEBEU ${m.partnerNewLeadsSinceLast} LEAD${m.partnerNewLeadsSinceLast > 1 ? "S" : ""} NOVO${m.partnerNewLeadsSinceLast > 1 ? "S" : ""}!*`);
    lines.push(``);
  }

  lines.push(`📊 *RODÍZIO — Atualização*`);
  lines.push(`━━━━━━━━━━━━━━━━━━`);
  lines.push(`🎯 *Campanha:* ${m.campaignName}`);
  lines.push(`🕐 ${m.nowLabel}`);

  if (m.campaignStatus !== "active") {
    lines.push(``);
    lines.push(`⚠️ *Status:* ${m.campaignStatus.toUpperCase()}`);
  }

  // Hoje
  lines.push(``);
  lines.push(`💰 *Hoje*`);
  lines.push(`├ Gasto: R$ ${brl(m.spendTodayCents)}`);
  lines.push(`├ Alcance: ${m.reachToday.toLocaleString("pt-BR")} pessoas`);
  lines.push(`├ Leads recebidos: ${m.leadsToday}`);
  const cpl = m.leadsToday > 0 ? `R$ ${brl(Math.round(m.spendTodayCents / m.leadsToday))}` : "—";
  lines.push(`└ Custo/lead: ${cpl}`);

  // 7 dias
  lines.push(``);
  lines.push(`📆 *Últimos 7 dias*`);
  lines.push(`├ Investido: R$ ${brl(m.spend7dCents)}`);
  lines.push(`└ Leads: ${m.leads7d}`);

  // Você no rodízio
  lines.push(``);
  lines.push(`👥 *Você no rodízio*`);
  lines.push(`├ Posição na fila: ${ordinal(m.partnerPosition)} de ${m.partnerPoolSize}`);
  lines.push(`└ Seus leads (total): ${m.partnerLeadsTotal}`);

  // Rodapé com humor
  lines.push(``);
  if (m.leadsToday === 0 && m.campaignStatus === "active") {
    lines.push(`😴 Ainda sem leads hoje, mas a campanha está rodando.`);
  } else if (m.minutesSinceLastLeadInCampaign !== null && m.minutesSinceLastLeadInCampaign < 15) {
    lines.push(`🚀 Bora! Campanha aquecida.`);
  } else if (m.leadsToday > 0) {
    lines.push(`✅ Campanha entregando leads.`);
  }
  lines.push(``);
  lines.push(`_Próxima atualização em ~10 min_`);

  return lines.join("\n");
}
