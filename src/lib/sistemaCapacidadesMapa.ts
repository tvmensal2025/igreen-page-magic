/**
 * Guia do sistema em linguagem de consultor.
 * Chaves técnicas (toggle) ficam só para o código ligar/desligar — nunca na cara do usuário.
 */

export type CapacidadeGrupo = "sempre" | "automatico" | "ajuste";
export type CapacidadeRisco = "seguro" | "cuidado" | "avancado";

export type CapacidadeItem = {
  id: string;
  nome: string;
  /** Em uma frase: o que isso faz no dia a dia */
  oQueFaz: string;
  /** Onde a pessoa encontra isso no painel */
  onde: string;
  grupo: CapacidadeGrupo;
  /** Dica curta ("como usar") */
  dica?: string;
  /** Chave interna — não mostrar na UI */
  toggle?: string;
  risco?: CapacidadeRisco;
  /** Ordem sugerida para ligar (1 = primeiro) */
  ordemSugerida?: number;
};

export type PassoSugerido = {
  passo: number;
  titulo: string;
  porque: string;
  como: string;
  /** Se tiver toggle, o botão "Ligar" aparece neste passo */
  toggle?: string;
};

export type EnvioAutomatico = {
  id: string;
  nome: string;
  quando: string;
  oQueFaz: string;
  toggle?: string;
};

export const GRUPO_LABEL: Record<CapacidadeGrupo, string> = {
  sempre: "Já funciona (você usa no dia a dia)",
  automatico: "Pode ligar ou desligar",
  ajuste: "Ainda em preparação",
};

export const RISCO_LABEL: Record<CapacidadeRisco, string> = {
  seguro: "Mais seguro para começar",
  cuidado: "Comece com poucos leads",
  avancado: "Só com cuidado / admin",
};

export const CAPACIDADES: CapacidadeItem[] = [
  {
    id: "inbound",
    nome: "Receber mensagens do cliente",
    oQueFaz: "Toda mensagem que chega no WhatsApp fica salva no sistema. Nada some.",
    onde: "Chat e Captação",
    grupo: "sempre",
    dica: "Mesmo com o robô desligado, a conversa continua sendo gravada.",
  },
  {
    id: "bot",
    nome: "Robô que responde e cadastra",
    oQueFaz: "Conversa com o lead, tira dúvidas e pede os dados até o cadastro no portal.",
    onde: "Chat (botão da IA)",
    grupo: "sempre",
    dica: "Se você Assumir o lead, o robô para até você Religar.",
  },
  {
    id: "captacao",
    nome: "Modo Captação",
    oQueFaz: "Mostra os leads novos ao vivo para você completar a ficha e enviar ao portal.",
    onde: "Menu Captação",
    grupo: "sempre",
    dica: "Bom hábito: abrir a fila de 48h / 7 dias toda manhã.",
  },
  {
    id: "assumir",
    nome: "Assumir o atendimento",
    oQueFaz: "Você pega o lead na mão. O robô para. Enviar mensagem manual NÃO religa o robô sozinho.",
    onde: "Chat → botão Assumir / Religar",
    grupo: "sempre",
    dica: "Quando terminar, use Religar se quiser o robô de novo.",
  },
  {
    id: "kill",
    nome: "Pausa geral do robô (emergência)",
    oQueFaz: "Para o sistema de responder em massa. Continua recebendo e avisa o consultor.",
    onde: "Só administrador (Assistente Global)",
    grupo: "sempre",
    dica: "Use se algo estiver mandando mensagem demais.",
    risco: "avancado",
  },
  {
    id: "agenda",
    nome: "Mensagem agendada por você",
    oQueFaz: "Você escolhe o texto e a hora. O sistema manda sozinho na hora marcada.",
    onde: "Agendamentos → Agenda",
    grupo: "automatico",
    toggle: "send_scheduled_messages",
    risco: "seguro",
    ordemSugerida: 0,
    dica: "Ideal para “te chamo amanhã às 10”.",
  },
  {
    id: "checker6h",
    nome: "Lembrar quem sumiu (6 a 48h)",
    oQueFaz: "Se o lead parou de responder, o sistema manda um toque simples pedindo retorno.",
    onde: "Este guia ou Central → Automações",
    grupo: "automatico",
    toggle: "bot_followup_checker",
    risco: "seguro",
    ordemSugerida: 1,
    dica: "Melhor primeiro passo automático: pouco risco, boa recuperação.",
  },
  {
    id: "nudge",
    nome: "Toque após tirar dúvida (±20 min)",
    oQueFaz: "Lead perguntou, você (ou o robô) respondeu, e ele ficou quieto — o sistema cutuca de leve.",
    onde: "Este guia ou Central → Automações",
    grupo: "automatico",
    toggle: "faq_reengagement_nudge",
    risco: "cuidado",
    ordemSugerida: 2,
    dica: "Ligue depois que o “quem sumiu” estiver ok.",
  },
  {
    id: "followup",
    nome: "Lembrete no dia combinado",
    oQueFaz: "Se o lead pediu “me chama segunda” ou “amanhã”, o sistema respeita e avisa na hora certa.",
    onde: "Este guia ou Central → Automações",
    grupo: "automatico",
    toggle: "process_followups",
    risco: "cuidado",
    ordemSugerida: 3,
    dica: "Poderoso, mas ligue por último na sequência de retenção.",
  },
  {
    id: "bulk",
    nome: "Campanha para vários números",
    oQueFaz: "Disparo em lote de mensagens / campanhas já montadas.",
    onde: "WhatsApp → envio em massa",
    grupo: "automatico",
    toggle: "bulk_campaigns_runner",
    risco: "avancado",
    dica: "Só ligue com lista revisada — risco de spam.",
  },
  {
    id: "reativacao",
    nome: "Reativar leads frios",
    oQueFaz: "Manda mensagens prontas para quem sumiu há mais tempo.",
    onde: "Reaquecimento + Automações",
    grupo: "automatico",
    toggle: "reactivation_cron",
    risco: "avancado",
    dica: "Não misture com várias cutucadas ao mesmo tempo.",
  },
  {
    id: "cadencia",
    nome: "Sequência automática de etapas",
    oQueFaz: "Motor que manda uma sequência de mensagens conforme o estágio do lead.",
    onde: "Motor de cadência + Automações",
    grupo: "automatico",
    toggle: "cadence_engine",
    risco: "avancado",
    dica: "Só com quem já entende o fluxo — pode falar demais.",
  },
  {
    id: "posvenda",
    nome: "Mensagens pós-venda (30 / 60 / 90 dias)",
    oQueFaz: "Acompanha cliente da carteira iGreen em datas programadas.",
    onde: "Agendamentos / pós-venda",
    grupo: "ajuste",
    risco: "cuidado",
    dica: "Parte já existe; ainda estamos afinando o controle fino.",
  },
  {
    id: "canal",
    nome: "WhatsApp único em todos os envios",
    oQueFaz: "Garantir que todo envio automático use o mesmo tipo de conexão do consultor.",
    onde: "Ajuste técnico da equipe",
    grupo: "ajuste",
    risco: "avancado",
    dica: "Antes de ligar retenção em massa, a equipe deve fechar isso.",
  },
];

/** Passos em português claro — sem jargão. */
export const PASSOS_SUGERIDOS: PassoSugerido[] = [
  {
    passo: 1,
    titulo: "Abra a Captação todo dia",
    porque: "Com os envios automáticos desligados, o humano precisa olhar a fila quente.",
    como: "Captação → ver lote de 48h e 7 dias → abrir atendimento dos quentes.",
  },
  {
    passo: 2,
    titulo: "Ligue só “lembrar quem sumiu”",
    porque: "Recupera lead parado com mensagem simples — bom primeiro teste.",
    como: "Use o interruptor ao lado da capacidade (ou o botão Ligar abaixo). Comece com 1 pessoa / poucos dias.",
    toggle: "bot_followup_checker",
  },
  {
    passo: 3,
    titulo: "Depois: toque pós-dúvida",
    porque: "Pega quem travou logo depois de perguntar.",
    como: "Só depois que o passo 2 estiver estável.",
    toggle: "faq_reengagement_nudge",
  },
  {
    passo: 4,
    titulo: "Por último: lembrete no dia combinado",
    porque: "Respeita “me chama segunda” — mais forte e mais sensível.",
    como: "Ligue quando os passos anteriores estiverem ok.",
    toggle: "process_followups",
  },
  {
    passo: 5,
    titulo: "Campanha em massa e cadência: com calma",
    porque: "Falam com muita gente de uma vez.",
    como: "Só com lista revisada e alinhamento com o admin.",
  },
];

/** “Envios no horário” — o que o consultor precisa saber, sem nome de job. */
export const ENVIOS_AUTOMATICOS: EnvioAutomatico[] = [
  {
    id: "agenda",
    nome: "Mensagens que você agendou",
    quando: "Na hora que você marcou",
    oQueFaz: "Envia o texto que você escreveu.",
    toggle: "send_scheduled_messages",
  },
  {
    id: "sumiu",
    nome: "Lembrar quem sumiu",
    quando: "Checagem diária (leads parados 6–48h)",
    oQueFaz: "Manda um toque pedindo retorno.",
    toggle: "bot_followup_checker",
  },
  {
    id: "faq",
    nome: "Toque após dúvida",
    quando: "Cerca de 20 minutos sem resposta",
    oQueFaz: "Cutuca quem ficou em silêncio depois da resposta.",
    toggle: "faq_reengagement_nudge",
  },
  {
    id: "dia",
    nome: "Lembrete no dia combinado",
    quando: "Várias vezes ao dia (só quem pediu retorno)",
    oQueFaz: "Avisa no dia/hora combinados com o lead.",
    toggle: "process_followups",
  },
  {
    id: "lote",
    nome: "Campanha em lote",
    quando: "Conforme a campanha",
    oQueFaz: "Dispara para a lista da campanha.",
    toggle: "bulk_campaigns_runner",
  },
  {
    id: "frio",
    nome: "Reativar lead frio",
    quando: "De hora em hora (quando ligado)",
    oQueFaz: "Mensagens de reaquecimento.",
    toggle: "reactivation_cron",
  },
  {
    id: "cadencia",
    nome: "Sequência de etapas",
    quando: "A cada poucos minutos (quando ligado)",
    oQueFaz: "Segue a cadência configurada.",
    toggle: "cadence_engine",
  },
  {
    id: "pos",
    nome: "Pós-venda 30/60/90",
    quando: "1 vez por dia",
    oQueFaz: "Mensagens da carteira iGreen.",
  },
];

/** @deprecated use PASSOS_SUGERIDOS — mantido para imports antigos */
export const SUGESTOES = PASSOS_SUGERIDOS.map((p) => ({
  prioridade: (p.passo <= 2 ? "alta" : p.passo <= 4 ? "media" : "baixa") as "alta" | "media" | "baixa",
  titulo: p.titulo,
  porque: p.porque,
  como: p.como,
}));

/** @deprecated use ENVIOS_AUTOMATICOS */
export const CRONS_ESPERADOS = ENVIOS_AUTOMATICOS.map((e) => ({
  job: e.nome,
  paraQue: e.oQueFaz,
  toggle: e.toggle ?? "—",
}));

export const STATUS_LABEL = {
  pronto_off: "Desligado",
  pronto_on: "Ligado",
  parcial: "Parcial",
  pendente: "Em preparação",
} as const;
