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
  // Extras (opcionais — enriquecem sem inventar)
  dailyBudgetCents?: number | null;
  trackingProtocol?: string | null;
  cities?: string[];
  partnerName?: string | null;
  quietStartHour?: number | null;
  quietEndHour?: number | null;
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
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m <= 0) return "desligado";
  if (m < 60) return `${m} min`;
  if (m % 1440 === 0) {
    const d = m / 1440;
    return d === 1 ? "1 dia" : `${d} dias`;
  }
  if (m % 60 === 0) {
    const h = m / 60;
    return h === 1 ? "1 hora" : `${h} horas`;
  }
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `${h}h ${rest}min`;
}

function pct(num: number, den: number): number | null {
  if (!den || den <= 0 || !Number.isFinite(num)) return null;
  return Math.round((num / den) * 1000) / 10;
}

function quietLabel(start?: number | null, end?: number | null): string | null {
  if (start == null || end == null) return null;
  if (start === end) return null;
  const a = String(start).padStart(2, "0");
  const b = String(end).padStart(2, "0");
  return `${a}h–${b}h`;
}

/** Nome amigável: tira [CONS-...], prefixo MG-ROT, data e sufixo longo. */
export function shortCampaignName(raw: string): string {
  let s = String(raw || "").trim();
  s = s.replace(/\[CONS-[^\]]+\]/gi, "");
  s = s.replace(/\s*·\s*/g, " · ").replace(/\s{2,}/g, " ").replace(/(?:\s·\s*)+$/g, "").trim();
  const mg = s.match(/^MG-ROT-([a-z0-9-]+)/i);
  if (mg) {
    s = mg[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const em = s.split(/\s*[—–]\s*/);
  if (em.length > 1 && em[0].length >= 3) s = em[0].trim();
  s = s.replace(/\s*·\s*\d{4}-\d{2}-\d{2}.*$/, "").trim();
  if (/\s·\s/.test(s)) {
    const left = s.split(/\s·\s/)[0]?.trim() || s;
    if (left.length >= 3) s = left;
  }
  s = s.replace(/^remarketing[- ]+/i, "").replace(/[-_]+/g, " ").trim();
  if (s.length < 3) {
    s = String(raw || "").replace(/\[CONS-[^\]]+\]/gi, "").replace(/(?:\s·\s*)+$/g, "").trim();
  }
  if (s.length > 60) s = s.slice(0, 57) + "…";
  if (s === s.toLowerCase() && /^[a-zà-ú0-9 -]+$/i.test(s)) {
    s = s.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return s || "Campanha";
}

function cplCents(spend: number, leads: number): number | null {
  if (!leads || leads <= 0 || !spend || spend <= 0) return null;
  return Math.round(spend / leads);
}

export function formatRodizioMetricsMessage(m: RodizioMetricsInput): string {
  const lines: string[] = [];
  const name = shortCampaignName(m.campaignName);
  const firstName = m.partnerName
    ? String(m.partnerName).trim().split(/\s+/)[0]
    : "";

  const spend7d = Math.max(Number(m.spend7dCents || 0), Number(m.spendTodayCents || 0));
  const conv7d = Math.max(Number(m.conversations7d || 0), Number(m.conversationsStartedToday || 0));
  const clicks7d = Math.max(Number(m.clicks7d || 0), Number(m.clicksToday || 0));
  const leads7d = Math.max(Number(m.leadsCrm7d || 0), Number(m.leadsCrmToday || 0));

  if (firstName) {
    lines.push(`Olá, ${firstName}! 👋`);
    lines.push(``);
  }

  if (m.partnerNewLeadsSinceLast > 0) {
    const q = m.partnerNewLeadsSinceLast;
    lines.push(`🔥 *Você recebeu ${q} lead${q > 1 ? "s" : ""} novo${q > 1 ? "s" : ""}!*`);
    lines.push(`📲 Já estão no funil — a equipe segue o atendimento.`);
    lines.push(``);
  }

  lines.push(`📊 *Atualização do anúncio*`);
  lines.push(`━━━━━━━━━━━━━━━━`);
  lines.push(`🎯 *${name}*`);
  lines.push(`🕐 ${m.nowLabel}`);
  if (m.trackingProtocol) lines.push(`🔖 Protocolo: *${m.trackingProtocol}*`);
  if (m.campaignStatus === "active") {
    lines.push(`🟢 Status: *no ar* e entregando`);
  } else if (m.campaignStatus) {
    lines.push(`⚠️ Status: *${m.campaignStatus}*`);
  }
  if (m.cities && m.cities.length > 0) {
    lines.push(`📍 ${m.cities.slice(0, 4).join(", ")}${m.cities.length > 4 ? "…" : ""}`);
  }
  if (m.dailyBudgetCents != null && m.dailyBudgetCents > 0) {
    lines.push(`💵 Orçamento/dia: *R$ ${brl(m.dailyBudgetCents)}*`);
    const used = pct(m.spendTodayCents, m.dailyBudgetCents);
    if (used != null) {
      lines.push(`📉 Uso do orçamento hoje: *${used}%*`);
    }
  }

  lines.push(``);
  lines.push(`☀️ *Hoje (ao vivo)*`);
  lines.push(`💰 Gasto: *R$ ${brl(m.spendTodayCents)}*`);
  lines.push(`👀 Alcance: *${n(m.reachToday)}* pessoas`);
  lines.push(`📢 Visualizações: *${n(m.impressionsToday)}*`);
  lines.push(`👆 Cliques: *${n(m.clicksToday)}*`);
  const ctr = pct(m.clicksToday, m.impressionsToday);
  if (ctr != null) lines.push(`📌 CTR (clique/visualização): *${ctr}%*`);
  lines.push(`💬 Conversas (Meta): *${n(m.conversationsStartedToday)}*`);
  const clickToConv = pct(m.conversationsStartedToday, m.clicksToday);
  if (clickToConv != null) lines.push(`🔁 Clique → conversa: *${clickToConv}%*`);
  lines.push(`📥 Leads no WhatsApp: *${n(m.leadsCrmToday)}*`);
  const convToLead = pct(m.leadsCrmToday, m.conversationsStartedToday);
  if (convToLead != null) lines.push(`🤝 Conversa → lead: *${convToLead}%*`);
  const cplToday = cplCents(m.spendTodayCents, m.leadsCrmToday);
  if (cplToday != null) {
    lines.push(`🎯 Custo por lead: *R$ ${brl(cplToday)}*`);
  }
  const cpc = cplCents(m.spendTodayCents, m.clicksToday);
  if (cpc != null && m.clicksToday > 0) {
    lines.push(`💸 Custo por clique: *R$ ${brl(cpc)}*`);
  }

  lines.push(``);
  lines.push(`📅 *Últimos 7 dias*`);
  lines.push(`💰 Gasto: *R$ ${brl(spend7d)}*`);
  lines.push(`👆 Cliques: *${n(clicks7d)}*`);
  lines.push(`💬 Conversas: *${n(conv7d)}*`);
  lines.push(`📥 Leads no WhatsApp: *${n(leads7d)}*`);
  const cpl7 = cplCents(spend7d, leads7d);
  if (cpl7 != null) {
    lines.push(`🎯 Custo por lead (7d): *R$ ${brl(cpl7)}*`);
  }

  lines.push(``);
  lines.push(`👥 *Seu resultado*`);
  if (m.partnerPoolSize <= 1) {
    lines.push(`🏅 Campanha *exclusiva* pra você`);
  } else {
    lines.push(`🏅 Posição no rodízio: *${ordinal(m.partnerPosition)}* de ${m.partnerPoolSize}`);
  }
  lines.push(`📈 Seus leads nesta campanha: *${n(m.partnerLeadsTotal)}*`);
  if (m.partnerNewLeadsSinceLast > 0) {
    lines.push(`🆕 Desde o último aviso: *${n(m.partnerNewLeadsSinceLast)}*`);
  }

  lines.push(``);
  lines.push(`💡 *Leitura rápida*`);
  if (m.spendTodayCents === 0 && m.impressionsToday === 0 && m.campaignStatus === "active") {
    lines.push(`🌱 No ar — a Meta começa a entregar em até 24h.`);
  } else if (m.leadsCrmToday > 0) {
    lines.push(`✅ Hoje já entrou lead no WhatsApp. Bom ritmo!`);
  } else if (m.conversationsStartedToday > 0 && m.leadsCrmToday === 0) {
    lines.push(`💬 Meta já abriu conversa — o lead deve aparecer no Zap em breve.`);
  } else if (m.clicksToday > 0 && m.conversationsStartedToday === 0) {
    lines.push(`👆 Teve clique, ainda sem conversa. Aguardando.`);
  } else if (m.impressionsToday > 0) {
    lines.push(`👀 Já está sendo visto. Aguardando o primeiro clique.`);
  } else {
    lines.push(`📡 Aguardando novos números da Meta.`);
  }

  lines.push(``);
  lines.push(`⏰ Próxima atualização em ~*${intervalLabel(m.intervalMinutes)}*`);
  const quiet = quietLabel(m.quietStartHour, m.quietEndHour);
  if (quiet) lines.push(`🌙 Silêncio noturno: *${quiet}* (sem avisos)`);
  lines.push(`✨ _Números ao vivo da Meta + WhatsApp_`);
  lines.push(`_iGreen Ads_`);

  return lines.join("\n");
}

export function formatRodizioFallbackMessage(campaignName: string, nowLabel: string, intervalMinutes: number): string {
  const name = shortCampaignName(campaignName);
  return [
    `📊 *Atualização do anúncio*`,
    `━━━━━━━━━━━━━━━━`,
    ``,
    `🎯 *${name}*`,
    `🕐 ${nowLabel}`,
    ``,
    `⚠️ Não consegui puxar as métricas ao vivo da Meta agora.`,
    `🔄 Tento de novo em ~*${intervalLabel(intervalMinutes)}*.`,
    `💚 Seus leads no WhatsApp continuam sendo trabalhados.`,
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
  cities?: string[];
  estimatedReach?: { lower: number; upper: number } | null;
  partnerName?: string | null;
  partnerIgreenId?: string | null;
  position?: number | null;
  totalPositions?: number | null;
  rosterLines?: string[];
  intervalMinutes: number;
  quietStartHour?: number | null;
  quietEndHour?: number | null;
}

/**
 * Mensagem única de "campanha aprovada pela Meta". Enviada 1x por pool para
 * cada parceiro elegível assim que a campanha entra em ACTIVE.
 */
export function formatCampaignApprovedMessage(input: CampaignApprovedInput): string {
  const name = shortCampaignName(input.campaignName);
  const firstName = input.partnerName
    ? String(input.partnerName).trim().split(/\s+/)[0]
    : "";

  const lines: string[] = [];
  if (firstName) {
    lines.push(`Olá, ${firstName}! 👋`);
    lines.push(``);
  }
  lines.push(`✅ *Campanha aprovada pela Meta!*`);
  lines.push(`🚀 Seu anúncio já está *no ar* e pode começar a gerar leads.`);
  lines.push(``);

  lines.push(`📢 *Campanha*`);
  lines.push(`━━━━━━━━━━━━━━━━`);
  lines.push(`🎯 *${name}*`);
  if (input.fbCampaignId) lines.push(`🆔 ID Meta: *${input.fbCampaignId}*`);
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

  if (input.partnerName || input.partnerIgreenId) {
    lines.push(`🪪 *Seu cadastro*`);
    if (input.partnerName) lines.push(`👤 Nome: *${input.partnerName}*`);
    if (input.partnerIgreenId) lines.push(`🔢 ID iGreen: *${input.partnerIgreenId}*`);
    lines.push(``);
  }

  if (input.totalPositions && input.totalPositions > 1 && input.position) {
    lines.push(`👥 *Rodízio de leads*`);
    lines.push(`🏅 Sua posição: *${input.position}º* de *${input.totalPositions}*`);
    if (input.rosterLines && input.rosterLines.length > 0) {
      lines.push(`📋 Integrantes:`);
      lines.push(...input.rosterLines);
    }
    lines.push(`🔄 Os leads entram na sua vez, na ordem acima.`);
    lines.push(``);
  } else if (input.totalPositions === 1 || (input.position === 1 && !input.totalPositions)) {
    lines.push(`🏅 Esta campanha é *exclusiva* pra você.`);
    lines.push(`📥 Todos os leads deste anúncio vão para o seu atendimento.`);
    lines.push(``);
  }

  lines.push(`📬 *O que você vai receber daqui pra frente*`);
  lines.push(`1️⃣ Aviso de *novo lead* (quando cair no seu Zap)`);
  lines.push(`2️⃣ Atualização de *métricas* a cada *${intervalLabel(input.intervalMinutes)}*`);
  lines.push(`   → gasto · cliques · conversas · seus leads · CPL`);
  lines.push(`3️⃣ Aviso se a campanha for *pausada* ou *encerrada*`);
  const quiet = quietLabel(input.quietStartHour, input.quietEndHour);
  if (quiet) {
    lines.push(`🌙 Sem mensagens de madrugada (*${quiet}*)`);
  } else {
    lines.push(`🌙 Sem mensagens de madrugada (padrão 21h–09h).`);
  }
  lines.push(``);
  lines.push(`💪 Bons leads — estamos juntos!`);
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
 */
export function formatCampaignPausedMessage(campaignName: string, reason: CampaignPausedReason | string): string {
  const name = shortCampaignName(campaignName || "Sua campanha");
  const footer = [
    ``,
    `💚 Os leads que já chegaram *seguem sendo trabalhados*`,
    `pela equipe — ninguém fica parado.`,
    `📊 Você continua recebendo avisos se houver novidade.`,
    ``,
    `✨ _iGreen Ads_`,
  ];

  switch (reason) {
    case "manual":
      return [
        `🌿 *Pausa estratégica*`,
        `━━━━━━━━━━━━━━━━`,
        `🎯 *${name}*`,
        ``,
        `A campanha foi pausada por um momento`,
        `para *ajustar e melhorar a entrega*.`,
        ``,
        `É só um respiro — em breve voltamos`,
        `com leads ainda melhores. 🚀`,
        ...footer,
      ].join("\n");
    case "low_balance":
      return [
        `🔋 *Recarregando energia*`,
        `━━━━━━━━━━━━━━━━`,
        `🎯 *${name}*`,
        ``,
        `Pausamos rapidinho para *repor o saldo*`,
        `da campanha.`,
        ``,
        `Assim que o crédito entrar,`,
        `os anúncios voltam sozinhos. ⚡`,
        ...footer,
      ].join("\n");
    case "ended":
      return [
        `✨ *Missão cumprida!*`,
        `━━━━━━━━━━━━━━━━`,
        `🎯 *${name}*`,
        ``,
        `A campanha encerrou — e o melhor começa agora.`,
        ``,
        `Cada lead que chegou *continua no funil*,`,
        `com atendimento e acompanhamento`,
        `até o fechamento. ✅`,
        ``,
        `Obrigado pela parceria.`,
        `Quando quiser, partimos para a próxima! 🚀`,
        ``,
        `✨ _iGreen Ads_`,
      ].join("\n");
    case "rejected":
      return [
        `🎨 *Ajuste fino no criativo*`,
        `━━━━━━━━━━━━━━━━`,
        `🎯 *${name}*`,
        ``,
        `A Meta pediu um pequeno ajuste no anúncio.`,
        `Já estamos *revisando e reenviando* —`,
        `em algumas horas voltamos ao ar. ✅`,
        ...footer,
      ].join("\n");
    case "auto_performance":
      return [
        `🧪 *Otimização em andamento*`,
        `━━━━━━━━━━━━━━━━`,
        `🎯 *${name}*`,
        ``,
        `Pausamos para *testar novas variações*`,
        `e melhorar o custo por lead.`,
        ``,
        `Faz parte da rotina — os leads`,
        `voltam em breve, com mais qualidade. 🔥`,
        ...footer,
      ].join("\n");
    default:
      return [
        `🌿 *Pausa temporária*`,
        `━━━━━━━━━━━━━━━━`,
        `🎯 *${name}*`,
        ``,
        `Estamos *cuidando da campanha*`,
        `para melhorar os resultados.`,
        ``,
        `Voltamos logo. 💚`,
        ...footer,
      ].join("\n");
  }
}
