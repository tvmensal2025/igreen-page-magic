/**
 * Catálogo canônico de textos ajustáveis no hub de Agendamentos.
 * Fonte da verdade da UI — cada item aponta para tabela/chave ou tela externa.
 */

export type TextoFonte =
  | "consultant_message_templates"
  | "cadence_stage_config"
  | "reactivation_templates"
  | "conversion_phrase_catalog"
  | "kanban_pos_venda"
  | "bot_flow_steps"
  | "bot_flow_qa"
  | "voice_campaigns"
  | "message_templates"
  | "bulk_campaigns"
  | "scheduled_messages"
  | "stage_auto_messages"
  | "ai_knowledge_sections"
  | "ai_agent_config"
  | "rodizio_pools"
  | "pos_venda_default_media"
  | "holidays"
  | "externo";

export type TextoCatalogItem = {
  id: string;
  grupo: string;
  nome: string;
  oQueFaz: string;
  fonte: TextoFonte;
  /** Chave na tabela consultant_message_templates */
  templateKey?: string;
  /** Stage da cadência */
  cadenceStage?: string;
  /** Aviso se o envio ainda depende de toggle */
  toggle?: string;
  /** Rota / aba externa quando não edita inline */
  externoHint?: string;
  /** Se true, aparece como “obrigatório revisar” */
  prioridade?: "alta" | "media" | "baixa";
};

export const CATEGORIA_LABEL: Record<string, string> = {
  atendimento: "Atendimento (iniciar / finalizar / pesquisa)",
  ia: "Retenção e robô (follow-up, nudge, SLA, watchdog)",
  cadencia: "Motor de cadência (WA / ligação / SMS)",
  reaquecimento: "Reaquecimento de leads",
  conversao: "Frases de conversão",
  "pos-venda": "Pós-venda (30/60/90/120)",
  parceiros: "Parceiros / rodízio",
  manual: "Agenda e campanhas",
  saudacao: "Saudações",
  voz: "Voz e SMS (campanhas)",
  fluxos: "Fluxos do bot (passos)",
  chat: "Respostas rápidas do chat",
  crm: "CRM — mensagens por estágio",
  "ia-config": "IA — Conhecimento e personalidade",
  calendario: "Calendário (feriados / quiet-hours)",
};

/** Lista completa — nada de automação/agendamento fora desta lista. */
export const TEXTOS_CATALOGO: TextoCatalogItem[] = [
  // ── Atendimento ──
  {
    id: "start_attendance",
    grupo: "atendimento",
    nome: "Iniciar atendimento (template completo)",
    oQueFaz: "Mensagem ao clicar em Iniciar atendimento (sobrescreve o fluxo padrão se preenchida).",
    fonte: "consultant_message_templates",
    templateKey: "start_attendance",
    toggle: "start_customer_attendance",
    prioridade: "alta",
  },
  {
    id: "greeting_morning",
    grupo: "saudacao",
    nome: "Saudação — Bom dia",
    oQueFaz: "Usada na abertura do atendimento conforme o horário.",
    fonte: "consultant_message_templates",
    templateKey: "greeting_morning",
    prioridade: "media",
  },
  {
    id: "greeting_afternoon",
    grupo: "saudacao",
    nome: "Saudação — Boa tarde",
    oQueFaz: "Usada na abertura do atendimento conforme o horário.",
    fonte: "consultant_message_templates",
    templateKey: "greeting_afternoon",
    prioridade: "media",
  },
  {
    id: "greeting_evening",
    grupo: "saudacao",
    nome: "Saudação — Boa noite",
    oQueFaz: "Usada na abertura do atendimento conforme o horário.",
    fonte: "consultant_message_templates",
    templateKey: "greeting_evening",
    prioridade: "media",
  },
  {
    id: "attendance_protocol_block",
    grupo: "atendimento",
    nome: "Bloco protocolo (Atendimento iniciado)",
    oQueFaz: "Texto com consultor + número do chamado.",
    fonte: "consultant_message_templates",
    templateKey: "attendance_protocol_block",
    prioridade: "alta",
  },
  {
    id: "attendance_ask_name",
    grupo: "atendimento",
    nome: "Pedir nome completo",
    oQueFaz: "Após abrir o chamado, pede o nome do cliente.",
    fonte: "consultant_message_templates",
    templateKey: "attendance_ask_name",
    prioridade: "alta",
  },
  {
    id: "attendance_closing",
    grupo: "atendimento",
    nome: "Encerrar atendimento",
    oQueFaz: "Mensagem de finalização (antes da pesquisa).",
    fonte: "consultant_message_templates",
    templateKey: "attendance_closing",
    toggle: "end_customer_attendance_auto",
    prioridade: "alta",
  },
  {
    id: "attendance_rating_prompt",
    grupo: "atendimento",
    nome: "Pesquisa de satisfação (1–5)",
    oQueFaz: "Pede a nota do atendimento.",
    fonte: "consultant_message_templates",
    templateKey: "attendance_rating_prompt",
    prioridade: "alta",
  },
  {
    id: "attendance_rating_thanks",
    grupo: "atendimento",
    nome: "Agradecimento após a nota",
    oQueFaz: "Resposta depois que o cliente avalia.",
    fonte: "consultant_message_templates",
    templateKey: "attendance_rating_thanks",
    prioridade: "media",
  },
  {
    id: "attendance_rating_retry",
    grupo: "atendimento",
    nome: "Pedir nota de novo",
    oQueFaz: "Quando a resposta não é um número de 1 a 5.",
    fonte: "consultant_message_templates",
    templateKey: "attendance_rating_retry",
    prioridade: "baixa",
  },
  {
    id: "attendance_rating_media_hint",
    grupo: "atendimento",
    nome: "Arquivo no passo da nota",
    oQueFaz: "Cliente mandou mídia em vez da nota — orienta a responder 1–5.",
    fonte: "consultant_message_templates",
    templateKey: "attendance_rating_media_hint",
    prioridade: "baixa",
  },

  // ── Retenção ──
  {
    id: "bot_followup_sumiu",
    grupo: "ia",
    nome: "Lembrar quem sumiu (6–48h)",
    oQueFaz: "Fila diária lembra lead parado.",
    fonte: "consultant_message_templates",
    templateKey: "bot_followup_sumiu",
    toggle: "bot_followup_checker",
    prioridade: "alta",
  },
  {
    id: "faq_reengagement_nudge",
    grupo: "ia",
    nome: "Toque pós-dúvida (±20 min)",
    oQueFaz: "Cutuca quem ficou quieto depois do FAQ.",
    fonte: "consultant_message_templates",
    templateKey: "faq_reengagement_nudge",
    toggle: "faq_reengagement_nudge",
    prioridade: "alta",
  },
  {
    id: "speed_to_lead_alert",
    grupo: "ia",
    nome: "Alerta SLA (interno)",
    oQueFaz: "Texto do alerta no painel — não vai ao cliente.",
    fonte: "consultant_message_templates",
    templateKey: "speed_to_lead_alert",
    toggle: "speed_to_lead_sla",
    prioridade: "media",
  },
  {
    id: "postpone_confirm",
    grupo: "ia",
    nome: "Confirmação de adiamento",
    oQueFaz: "Quando o lead diz “mando amanhã / mais tarde”.",
    fonte: "consultant_message_templates",
    templateKey: "postpone_confirm",
    prioridade: "alta",
  },
  {
    id: "watchdog_orphan_tip",
    grupo: "ia",
    nome: "Watchdog — step órfão",
    oQueFaz: "Avisa o lead e escala para humano.",
    fonte: "consultant_message_templates",
    templateKey: "watchdog_orphan_tip",
    toggle: "bot_loop_watchdog",
    prioridade: "media",
  },
  {
    id: "watchdog_loop_tip",
    grupo: "ia",
    nome: "Watchdog — loop",
    oQueFaz: "Avisa o lead quando detecta loop.",
    fonte: "consultant_message_templates",
    templateKey: "watchdog_loop_tip",
    toggle: "bot_loop_watchdog",
    prioridade: "media",
  },
  {
    id: "cross_sell_hint",
    grupo: "pos-venda",
    nome: "Cross-sell (telecom / seguro)",
    oQueFaz: "Sugestão de outros produtos (só com toggle + sombra OFF).",
    fonte: "consultant_message_templates",
    templateKey: "cross_sell_hint",
    prioridade: "baixa",
  },

  // ── Cadência ──
  ...(["COLD_1", "COLD_2", "COLD_3", "COLD_4", "CALL_1", "CALL_2", "CALL_3", "SMS_1", "SMS_2"] as const).map(
    (stage) => ({
      id: `cadence_${stage}`,
      grupo: "cadencia" as const,
      nome: `Cadência ${stage}`,
      oQueFaz:
        stage.startsWith("COLD")
          ? "WhatsApp da sequência Zero Lead Perdido."
          : stage.startsWith("CALL")
            ? "Texto TTS / áudio da ligação iGreen Fone."
            : "SMS de fallback da cadência.",
      fonte: "cadence_stage_config" as const,
      cadenceStage: stage,
      toggle: stage.startsWith("COLD")
        ? `cadence_${stage.toLowerCase()}`
        : stage.startsWith("CALL")
          ? `cadence_${stage.toLowerCase()}`
          : `cadence_${stage.toLowerCase()}`,
      prioridade: "alta" as const,
    }),
  ),

  // ── Reaquecimento / conversão (dinâmicos na UI) ──
  {
    id: "reactivation_templates",
    grupo: "reaquecimento",
    nome: "Templates de reaquecimento (por etapa)",
    oQueFaz: "Lista completa dos textos por conversation_step do consultor.",
    fonte: "reactivation_templates",
    toggle: "reactivation_cron",
    prioridade: "alta",
  },
  {
    id: "conversion_phrases",
    grupo: "conversao",
    nome: "Frases de conversão (/fup, objeções, steps)",
    oQueFaz: "Catálogo usado no cockpit de conversão e atalhos.",
    fonte: "conversion_phrase_catalog",
    prioridade: "media",
  },
  {
    id: "pos_venda_kanban",
    grupo: "pos-venda",
    nome: "Mensagens pós-venda (colunas D+30/60/90/120…)",
    oQueFaz: "Textos das colunas do Kanban pós-venda.",
    fonte: "kanban_pos_venda",
    toggle: "pos_venda_auto_messages",
    prioridade: "alta",
  },

  // ── Parceiros ──
  {
    id: "partner_new_lead_notification",
    grupo: "parceiros",
    nome: "Parceiro — novo lead",
    oQueFaz: "Notificação quando o parceiro recebe lead no rodízio.",
    fonte: "consultant_message_templates",
    templateKey: "partner_new_lead_notification",
    toggle: "notify_partner_leads_batch",
    prioridade: "media",
  },
  {
    id: "partner_step_notification",
    grupo: "parceiros",
    nome: "Parceiro — avanço de etapa",
    oQueFaz: "Aviso de progresso do indicado.",
    fonte: "consultant_message_templates",
    templateKey: "partner_step_notification",
    prioridade: "baixa",
  },

  // ── Fluxos / FAQ / Voz / Chat / Campanhas (agora inline nas abas) ──
  {
    id: "ext_fluxos",
    grupo: "fluxos",
    nome: "Passos do fluxo do bot (message_text)",
    oQueFaz: "Cada passo do Fluxo A/B/C/D tem seu próprio texto. Edite na aba Fluxos.",
    fonte: "bot_flow_steps",
    prioridade: "alta",
  },
  {
    id: "ext_faq",
    grupo: "fluxos",
    nome: "FAQ / atalhos do fluxo",
    oQueFaz: "Perguntas e respostas prontas usadas pelo bot. Edite na aba FAQ.",
    fonte: "bot_flow_qa",
    prioridade: "media",
  },
  {
    id: "ext_voz",
    grupo: "voz",
    nome: "Campanhas de voz — TTS e SMS pós-NA",
    oQueFaz: "Texto da ligação (TTS) e SMS se não atender. Edite na aba Voz.",
    fonte: "voice_campaigns",
    toggle: "call_outcome_sms_branch",
    prioridade: "media",
  },
  {
    id: "ext_chat_templates",
    grupo: "chat",
    nome: "Respostas rápidas do chat",
    oQueFaz: "Templates manuais do WhatsApp. Edite na aba Chat rápido.",
    fonte: "message_templates",
    prioridade: "baixa",
  },
  {
    id: "ext_bulk",
    grupo: "manual",
    nome: "Campanhas em massa (Disparo PRO)",
    oQueFaz: "Cada campanha em massa tem seu próprio texto. Edite na aba Campanhas.",
    fonte: "bulk_campaigns",
    toggle: "bulk_campaigns_runner",
    prioridade: "media",
  },
  {
    id: "ext_agenda",
    grupo: "manual",
    nome: "Agenda manual (mensagens agendadas)",
    oQueFaz: "Cada mensagem agendada tem texto próprio. Edite na aba Campanhas.",
    fonte: "scheduled_messages",
    toggle: "send_scheduled_messages",
    prioridade: "baixa",
  },
  {
    id: "ext_motor_cadencia",
    grupo: "cadencia",
    nome: "Painel completo do Motor de Cadência",
    oQueFaz: "Delays, mídia e TTS por estágio (além dos textos abaixo).",
    fonte: "externo",
    externoHint: "/admin/motor-cadencia",
    toggle: "cadence_engine",
    prioridade: "media",
  },

  // ── Novas fontes (abas dedicadas) ──
  {
    id: "ext_stage_auto",
    grupo: "crm",
    nome: "CRM — mensagens automáticas por estágio",
    oQueFaz: "Cada coluna do funil pode ter mensagens que disparam ao mover o card. Edite na aba CRM.",
    fonte: "stage_auto_messages",
    prioridade: "alta",
  },
  {
    id: "ext_ai_knowledge",
    grupo: "ia-config",
    nome: "IA — Base de conhecimento (RAG)",
    oQueFaz: "Seções que a IA vendedora consulta para responder objeções, preço, garantia. Edite na aba IA Conhecimento.",
    fonte: "ai_knowledge_sections",
    prioridade: "alta",
  },
  {
    id: "ext_ai_agent",
    grupo: "ia-config",
    nome: "IA — Personalidade e prompt do agente",
    oQueFaz: "System prompt, persona, tom e prompts por passo do agente IA. Edite na aba IA Personalidade.",
    fonte: "ai_agent_config",
    prioridade: "alta",
  },
  {
    id: "ext_rodizio",
    grupo: "parceiros",
    nome: "Rodízio — texto do alerta ao parceiro",
    oQueFaz: "Mensagem que o parceiro recebe quando um lead é atribuído no rodízio. Edite na aba Rodízio.",
    fonte: "rodizio_pools",
    toggle: "notify_partner_leads_batch",
    prioridade: "media",
  },
  {
    id: "ext_pos_venda_global",
    grupo: "pos-venda",
    nome: "Pós-venda global — legendas padrão de mídia",
    oQueFaz: "Caption das mídias padrão do pós-venda (aplicadas quando o consultor não tem override). Edite na aba Pós-venda global.",
    fonte: "pos_venda_default_media",
    toggle: "pos_venda_auto_messages",
    prioridade: "baixa",
  },
  {
    id: "ext_holidays",
    grupo: "calendario",
    nome: "Calendário — feriados / quiet-hours",
    oQueFaz: "Datas que o motor de cadência e crons respeitam para não enviar. Edite na aba Calendário.",
    fonte: "holidays",
    prioridade: "media",
  },
];

export function countCatalogByFonte() {
  const m = new Map<TextoFonte, number>();
  for (const t of TEXTOS_CATALOGO) {
    m.set(t.fonte, (m.get(t.fonte) || 0) + 1);
  }
  return m;
}
