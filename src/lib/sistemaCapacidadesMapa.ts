/**
 * Conteúdo do mapa operacional — usado no botão "?" da Central e no Hub.
 * Não liga nada: só explica o que existe e o que melhorar.
 */

export type CapacidadeItem = {
  id: string;
  nome: string;
  oQueFaz: string;
  onde: string;
  status: "pronto_off" | "pronto_on" | "parcial" | "pendente";
  toggle?: string;
};

export type SugestaoMelhoria = {
  prioridade: "alta" | "media" | "baixa";
  titulo: string;
  porque: string;
  como: string;
};

export const STATUS_LABEL: Record<CapacidadeItem["status"], string> = {
  pronto_off: "Pronto · DESLIGADO",
  pronto_on: "Pronto · em uso",
  parcial: "Parcial",
  pendente: "Ainda falta",
};

export const CAPACIDADES: CapacidadeItem[] = [
  {
    id: "inbound",
    nome: "Receber WhatsApp",
    oQueFaz: "Grava lead e mensagem mesmo com bot/kill switch off (não some).",
    onde: "Whapi + Evolution",
    status: "pronto_on",
  },
  {
    id: "bot",
    nome: "Bot conversacional / cadastro",
    oQueFaz: "Responde, guia FAQ e coleta dados até o portal.",
    onde: "Chat + FluxoCamila",
    status: "pronto_on",
  },
  {
    id: "captacao",
    nome: "Modo Captação",
    oQueFaz: "Consultor vê feed AO VIVO, completa ficha e manda pro portal.",
    onde: "Painel Captação",
    status: "pronto_on",
  },
  {
    id: "assumir",
    nome: "Assumir lead",
    oQueFaz: "Bot para até Religar. Envio manual NÃO religa sozinho. Avisa no chat e no WhatsApp do consultor.",
    onde: "Chat (botão IA)",
    status: "pronto_on",
  },
  {
    id: "kill",
    nome: "Kill switch global",
    oQueFaz: "Para de falar; continua recebendo; avisa o consultor responsável.",
    onde: "Super Admin → Assistente Global",
    status: "pronto_on",
  },
  {
    id: "agenda",
    nome: "Agenda manual (1 msg)",
    oQueFaz: "Consultor agenda mensagem futura. Claim atômico evita duplicar.",
    onde: "Hub Agendamentos",
    status: "pronto_off",
    toggle: "send_scheduled_messages",
  },
  {
    id: "checker6h",
    nome: "Follow-up sumido 6–48h",
    oQueFaz: "Cutuca lead que parou de responder (mensagem simples).",
    onde: "Central → Automações",
    status: "pronto_off",
    toggle: "bot_followup_checker",
  },
  {
    id: "nudge",
    nome: "Nudge pós-FAQ (20 min)",
    oQueFaz: "Cutuca quem tirou dúvida e ficou em silêncio.",
    onde: "Central → Automações",
    status: "pronto_off",
    toggle: "faq_reengagement_nudge",
  },
  {
    id: "followup",
    nome: "Follow-up completo (postpone)",
    oQueFaz: "Respeita “amanhã / segunda” e dispara no horário.",
    onde: "Central → Automações",
    status: "pronto_off",
    toggle: "process_followups",
  },
  {
    id: "bulk",
    nome: "Disparo em lote (Bulk PRO)",
    oQueFaz: "Campanhas agendadas no servidor (cron).",
    onde: "WhatsApp → Bulk PRO",
    status: "pronto_off",
    toggle: "bulk_campaigns_runner",
  },
  {
    id: "reativacao",
    nome: "Reativação automática",
    oQueFaz: "Templates auto_reactivate para leads frios.",
    onde: "Admin Reaquecimento + Central",
    status: "pronto_off",
    toggle: "reactivation_cron",
  },
  {
    id: "cadencia",
    nome: "Motor de cadência",
    oQueFaz: "Sequência frio / estágios (cuidado ao ligar).",
    onde: "Admin Motor + Central",
    status: "pronto_off",
    toggle: "cadence_engine",
  },
  {
    id: "posvenda",
    nome: "Pós-venda D+30/60/90",
    oQueFaz: "Mensagens da carteira iGreen em datas programadas.",
    onde: "Hub + cron diário",
    status: "parcial",
  },
  {
    id: "canal",
    nome: "Canal único Whapi + Evolution",
    oQueFaz: "Alguns crons ainda preferem um canal só.",
    onde: "Crons de retenção / agenda",
    status: "pendente",
  },
];

export const SUGESTOES: SugestaoMelhoria[] = [
  {
    prioridade: "alta",
    titulo: "Piloto: ligar só o checker 6h",
    porque: "Recupera lead que some sem risco alto (texto fixo).",
    como: "Central → Automações → Follow-up 6h · 1 consultor · 2–3 dias · depois avaliar.",
  },
  {
    prioridade: "alta",
    titulo: "Unificar canal nos crons",
    porque: "Hoje parte do follow-up/agenda pode falhar se o consultor for só Whapi ou só Evolution.",
    como: "Pedir ajuste de canal único (próximo pacote técnico) antes de ligar retenção em massa.",
  },
  {
    prioridade: "alta",
    titulo: "Rotina diária de Captação",
    porque: "Com retenção OFF, o humano precisa abrir a fila quente.",
    como: "Toda manhã: Captação → lote 48h/7d → abrir atendimento.",
  },
  {
    prioridade: "media",
    titulo: "Depois: nudge FAQ",
    porque: "Pega quem travou na dúvida (20 min).",
    como: "Só depois do checker 6h estável.",
  },
  {
    prioridade: "media",
    titulo: "Depois: follow-up completo",
    porque: "Respeita “me chama segunda” — mais poderoso, mais sensível.",
    como: "Último da fila de retenção; validar token interno.",
  },
  {
    prioridade: "media",
    titulo: "Limpar crons duplicados",
    porque: "Há jobs com nomes parecidos (ex. follow-ups 5min e 10min).",
    como: "Quando for ligar retenção, unificar para não mandar 2x.",
  },
  {
    prioridade: "baixa",
    titulo: "Trocar senhas expostas no chat",
    porque: "Service role / senha de conta passaram na conversa.",
    como: "Dashboard Supabase → reset senha conta + regenerate service_role.",
  },
];

export const CRONS_ESPERADOS: { job: string; paraQue: string; toggle: string }[] = [
  { job: "process-followups-tick", paraQue: "Follow-up postpone", toggle: "process_followups" },
  { job: "bot-followup-checker (diário)", paraQue: "Sumido 6–48h", toggle: "bot_followup_checker" },
  { job: "faq / nudge", paraQue: "Nudge pós-FAQ", toggle: "faq_reengagement_nudge" },
  { job: "send-scheduled-messages", paraQue: "Agenda manual", toggle: "send_scheduled_messages" },
  { job: "bulk-scheduler", paraQue: "Campanhas lote", toggle: "bulk_campaigns_runner" },
  { job: "reactivation-cron-hourly", paraQue: "Reativação", toggle: "reactivation_cron" },
  { job: "cadence-tick-5min", paraQue: "Cadência", toggle: "cadence_engine" },
  { job: "pos-venda-auto-progress-daily", paraQue: "Pós-venda", toggle: "(próprio / central)" },
  { job: "close-attendance-scheduled-5min", paraQue: "Fecha atendimento agendado", toggle: "(função)" },
];
