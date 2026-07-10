// Monta a mensagem WhatsApp de "atualização do rodízio" enviada de tempos em
// tempos para cada parceiro de um pool. Puro / testável isolado.
// Regra: só números reais da Meta/CRM — nunca inventa.

export interface RodizioMetricsInput {
  campaignName: string;
  campaignStatus: string; // active | paused | ...
  // Métricas AO VIVO da Meta (sempre passar os números reais da Graph API)
  spendTodayCents: number;
  reachToday: number;
  impressionsToday: number;
  clicksToday: number;
  conversationsStartedToday: number; // messaging_conversation_started (Meta)
  spend7dCents: number;
  conversations7d: number;
  clicks7d: number;
  // Leads reais do CRM com prova Meta (AD ID / ctwa_clid + source_campaign_id)
  leadsCrmToday: number;
  leadsCrm7d: number;
  // Parceiro (leads do rodízio — sem exigir prova Meta; só quantidade)
  partnerPosition: number; // 1-based
  partnerPoolSize: number;
  partnerLeadsTotal: number;
  partnerNewLeadsSinceLast: number;
  nowLabel: string; // "09/07 14:00"
  intervalMinutes: number; // para o rodapé
}

function brl(cents: number): string {
  const v = (cents || 0) / 100;
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function n(v: number): string {
  return Number(v || 0).toLocaleString("pt-BR");
}

function ordinal(num: number): string {
  return `${num}º`;
}

function intervalLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = min / 60;
  return h === 1 ? "1 hora" : `${h} horas`;
}

/** Nome amigável: tira [CONS-...], data e sufixo longo. */
export function shortCampaignName(raw: string): string {
  let s = String(raw || "").trim();
  s = s.replace(/^\[CONS-[^\]]+\]\s*/i, "");
  // "Jaraguá · iGreen — Jaraguá, Setor Oeste..." → pega o trecho antes do em-dash longo
  const em = s.split(/\s*[—–]\s*/);
  if (em.length > 1 && em[0].length >= 3) s = em[0];
  s = s.replace(/\s*·\s*\d{4}-\d{2}-\d{2}.*$/, "").trim();
  // Se ainda ficou "X · iGreen", mantém; se ficou só "iGreen", usa original limpo
  if (s.length < 3) {
    s = String(raw || "").replace(/^\[CONS-[^\]]+\]\s*/i, "").trim();
  }
  if (s.length > 60) s = s.slice(0, 57) + "…";
  return s || "Campanha";
}

function cplCents(spend: number, leads: number): number | null {
  if (!leads || leads <= 0 || !spend || spend <= 0) return null;
  return Math.round(spend / leads);
}

export function formatRodizioMetricsMessage(m: RodizioMetricsInput): string {
  const lines: string[] = [];
  const name = shortCampaignName(m.campaignName);

  // Safety: 7d nunca menor que hoje (caller já soma last_7d+today; CRM pode divergir)
  const spend7d = Math.max(Number(m.spend7dCents || 0), Number(m.spendTodayCents || 0));
  const conv7d = Math.max(Number(m.conversations7d || 0), Number(m.conversationsStartedToday || 0));
  const clicks7d = Math.max(Number(m.clicks7d || 0), Number(m.clicksToday || 0));
  const leads7d = Math.max(Number(m.leadsCrm7d || 0), Number(m.leadsCrmToday || 0));

  if (m.partnerNewLeadsSinceLast > 0) {
    const q = m.partnerNewLeadsSinceLast;
    lines.push(`🔥 *Você recebeu ${q} lead${q > 1 ? "s" : ""} novo${q > 1 ? "s" : ""}!*`);
    lines.push(``);
  }

  lines.push(`📊 *Atualização do anúncio*`);
  lines.push(``);
  lines.push(`🎯 *${name}*`);
  lines.push(`🕐 ${m.nowLabel}`);
  if (m.campaignStatus === "active") {
    lines.push(`🟢 Status: no ar`);
  } else if (m.campaignStatus) {
    lines.push(`⚠️ Status: ${m.campaignStatus}`);
  }

  lines.push(``);
  lines.push(`☀️ *Hoje*`);
  lines.push(`💰 Gasto: *R$ ${brl(m.spendTodayCents)}*`);
  lines.push(`👀 Alcance: *${n(m.reachToday)}* pessoas`);
  lines.push(`📢 Visualizações: *${n(m.impressionsToday)}*`);
  lines.push(`👆 Cliques: *${n(m.clicksToday)}*`);
  lines.push(`💬 Conversas (Meta): *${n(m.conversationsStartedToday)}*`);
  lines.push(`📥 Leads no WhatsApp: *${n(m.leadsCrmToday)}*`);
  const cplToday = cplCents(m.spendTodayCents, m.leadsCrmToday);
  if (cplToday != null) {
    lines.push(`🎯 Custo por lead: *R$ ${brl(cplToday)}*`);
  }

  lines.push(``);
  lines.push(`📅 *Últimos 7 dias*`);
  lines.push(`💰 Gasto: *R$ ${brl(spend7d)}*`);
  lines.push(`👆 Cliques: *${n(clicks7d)}*`);
  lines.push(`💬 Conversas: *${n(conv7d)}*`);
  lines.push(`📥 Leads no WhatsApp: *${n(leads7d)}*`);
  const cpl7 = cplCents(spend7d, leads7d);
  if (cpl7 != null) {
    lines.push(`🎯 Custo por lead: *R$ ${brl(cpl7)}*`);
  }

  lines.push(``);
  lines.push(`👥 *Seu rodízio*`);
  lines.push(`🏅 Posição: *${ordinal(m.partnerPosition)}* de ${m.partnerPoolSize}`);
  lines.push(`📈 Seus leads nesta campanha: *${n(m.partnerLeadsTotal)}*`);

  lines.push(``);
  // Insight honesto — só com base nos números reais
  if (m.spendTodayCents === 0 && m.impressionsToday === 0 && m.campaignStatus === "active") {
    lines.push(`🌱 Campanha no ar — a Meta começa a entregar em até 24h.`);
  } else if (m.leadsCrmToday > 0) {
    lines.push(`✅ Hoje já entrou lead no WhatsApp. Bom ritmo!`);
  } else if (m.conversationsStartedToday > 0 && m.leadsCrmToday === 0) {
    lines.push(`💬 Meta já abriu conversa — o lead deve aparecer no WhatsApp em breve.`);
  } else if (m.clicksToday > 0 && m.conversationsStartedToday === 0) {
    lines.push(`👆 Teve clique, ainda sem conversa. Aguardando.`);
  } else if (m.impressionsToday > 0) {
    lines.push(`👀 Já está sendo visto. Aguardando o primeiro clique.`);
  }

  lines.push(``);
  lines.push(`⏰ Próxima atualização em ~${intervalLabel(m.intervalMinutes)}`);
  lines.push(`✨ _Números ao vivo da Meta + WhatsApp_`);

  return lines.join("\n");
}

export function formatRodizioFallbackMessage(campaignName: string, nowLabel: string, intervalMinutes: number): string {
  const name = shortCampaignName(campaignName);
  return [
    `📊 *Atualização do anúncio*`,
    ``,
    `🎯 *${name}*`,
    `🕐 ${nowLabel}`,
    ``,
    `⚠️ Não consegui puxar as métricas ao vivo da Meta agora.`,
    `🔄 Tento de novo em ~${intervalLabel(intervalMinutes)}.`,
    ``,
    `✨ _iGreen Ads_`,
  ].join("\n");
}

export interface CampaignApprovedInput {
  campaignName: string;
  trackingProtocol?: string | null;
  fbCampaignId?: string | null;
  dailyBudgetCents?: number | null;
  durationDays?: number | null;
  cities?: string[];               // até 5+ nomes
  estimatedReach?: { lower: number; upper: number } | null;
  partnerName?: string | null;
  partnerIgreenId?: string | null;
  position?: number | null;        // 1-based
  totalPositions?: number | null;
  rosterLines?: string[];          // ["1º Fulano · ID 123 ← você", ...]
  intervalMinutes: number;
}

/**
 * Mensagem única de "campanha aprovada pela Meta". Enviada 1x por pool para
 * cada parceiro elegível assim que a campanha entra em ACTIVE. Traz o pacote
 * completo (protocolo, orçamento, cidades, alcance, rodízio) — campos sem
 * dado confiável são simplesmente omitidos.
 */
export function formatCampaignApprovedMessage(input: CampaignApprovedInput): string {
  const name = shortCampaignName(input.campaignName);
  const hi = input.partnerName ? `Olá, ${String(input.partnerName).split(" ")[0]}! 👋\n\n` : "";

  const lines: string[] = [];
  lines.push(`${hi}✅ *Campanha aprovada pela Meta!*`);
  lines.push(`🚀 Seu anúncio já está no ar.`);
  lines.push(``);

  // Campanha
  lines.push(`📢 *Campanha*`);
  lines.push(`🎯 *${name}*`);
  if (input.fbCampaignId) lines.push(`🆔 ID Meta: \`${input.fbCampaignId}\``);
  if (input.trackingProtocol) lines.push(`🔖 Protocolo: *${input.trackingProtocol}*`);
  if (input.durationDays && input.durationDays > 0) {
    lines.push(`📅 Duração: *${input.durationDays} ${input.durationDays === 1 ? "dia" : "dias"}*`);
  }
  if (input.dailyBudgetCents != null && input.dailyBudgetCents > 0) {
    lines.push(`💵 Orçamento/dia: *R$ ${brl(input.dailyBudgetCents)}*`);
    if (input.durationDays && input.durationDays > 0) {
      lines.push(`💼 Investimento total previsto: *R$ ${brl(input.dailyBudgetCents * input.durationDays)}*`);
    }
  }
  if (input.cities && input.cities.length > 0) {
    const shown = input.cities.slice(0, 5).join(", ");
    const extra = input.cities.length > 5 ? ` +${input.cities.length - 5}` : "";
    lines.push(`📍 Cidades: ${shown}${extra}`);
  }
  if (input.estimatedReach && input.estimatedReach.upper > 0) {
    lines.push(`👀 Alcance estimado: *${n(input.estimatedReach.lower)}–${n(input.estimatedReach.upper)} pessoas*`);
  }
  lines.push(``);

  // Cadastro do parceiro
  if (input.partnerName || input.partnerIgreenId) {
    lines.push(`🪪 *Seu cadastro*`);
    if (input.partnerName) lines.push(`   Nome: *${input.partnerName}*`);
    if (input.partnerIgreenId) lines.push(`   ID iGreen: *${input.partnerIgreenId}*`);
    lines.push(``);
  }

  // Rodízio
  if (input.position && input.totalPositions && input.totalPositions > 1) {
    lines.push(`👥 *Rodízio*`);
    lines.push(`🏅 Sua posição: *${input.position}º* de *${input.totalPositions}*`);
    if (input.rosterLines && input.rosterLines.length > 0) {
      lines.push(`📋 Integrantes:`);
      lines.push(...input.rosterLines);
    }
    lines.push(``);
  }

  lines.push(`📊 Atualização de métricas a cada *${intervalLabel(input.intervalMinutes)}*`);
  lines.push(`   (gasto, cliques, conversas e seus leads)`);
  lines.push(`🌙 Sem mensagens de madrugada.`);
  lines.push(``);
  lines.push(`💪 Bons leads!`);
  lines.push(`✨ _iGreen Ads_`);
  return lines.join("\n");
}

export type CampaignPausedReason =
  | "manual"
  | "low_balance"
  | "ended"
  | "rejected"
  | "auto_performance";

/**
 * Mensagem única de "campanha pausada". Sempre com tom positivo/tranquilizador.
 * Disparada 1x por evento de pausa (usa `rodizio_pools.paused_notified_at`
 * para dedup; o campo é resetado ao reativar a campanha).
 */
export function formatCampaignPausedMessage(campaignName: string, reason: CampaignPausedReason | string): string {
  const name = shortCampaignName(campaignName || "Sua campanha");
  switch (reason) {
    case "manual":
      return [
        `⏸️ *Campanha em ajuste*`,
        `🎯 *${name}*`,
        ``,
        `Pausamos temporariamente para *otimizar o desempenho*`,
        `e trazer leads de mais qualidade.`,
        ``,
        `Fique tranquilo(a) — voltamos em breve! 💪`,
      ].join("\n");
    case "low_balance":
      return [
        `⏸️ *Pausa rápida para recarga*`,
        `🎯 *${name}*`,
        ``,
        `Estamos *recarregando o saldo* da campanha.`,
        `Assim que entrar, os leads voltam automaticamente. 🚀`,
      ].join("\n");
    case "ended":
      return [
        `🏁 *Campanha concluída*`,
        `🎯 *${name}*`,
        ``,
        `Essa fase acabou! Obrigado pela parceria —`,
        `em breve começamos uma nova rodada. 🙌`,
      ].join("\n");
    case "rejected":
      return [
        `⏸️ *Ajuste de criativo*`,
        `🎯 *${name}*`,
        ``,
        `A Meta pediu um pequeno ajuste no anúncio.`,
        `Já estamos *revisando e reenviando* — em algumas horas`,
        `voltamos ao ar. ✅`,
      ].join("\n");
    case "auto_performance":
      return [
        `🧪 *Fase de aquecimento/teste*`,
        `🎯 *${name}*`,
        ``,
        `O sistema pausou para *testar novas variações*`,
        `e melhorar o custo por lead. É rotina de otimização —`,
        `os leads voltam em breve! 🔥`,
      ].join("\n");
    default:
      return [
        `⏸️ *Pausa temporária*`,
        `🎯 *${name}*`,
        ``,
        `Estamos *otimizando a campanha* para melhorar os resultados.`,
        `Voltamos logo com mais leads! 💚`,
      ].join("\n");
  }
}
