/**
 * Calendário amigável Zero Lead Perdido v5.
 * Grupo B = onda curta (reaquecimento). Grupo C = Meta + recalls longos.
 */

export type CadenceChannelUi = "whatsapp" | "voice" | "sms" | "meta" | "system";

export type CalendarDayKey =
  | "d1"
  | "d2"
  | "d4"
  | "d6"
  | "d7"
  | "d10"
  | "c";

export type CalendarStageKey =
  | "COLD_1"
  | "SMS_1"
  | "CALL_1"
  | "COLD_2"
  | "SMS_TEMA_2"
  | "CALL_2"
  | "SMS_2"
  | "COLD_3"
  | "SMS_TEMA_7"
  | "CALL_3"
  | "COLD_4"
  | "CLOSE_LOST"
  | "RETARGET_META"
  | "RETARGET_ADS_15D"
  | "RECALL_60D"
  | "RECALL_60D_SMS"
  | "RECALL_60D_CALL"
  | "RECALL_90D"
  | "RECALL_90D_SMS"
  | "RECALL_90D_CALL"
  | "RECALL_5M"
  | "RECALL_5M_SMS"
  | "RECALL_5M_CALL"
  | "RECALL_8M"
  | "RECALL_8M_SMS"
  | "RECALL_8M_CALL"
  | "RECALL_12M"
  | "RECALL_12M_SMS"
  | "RECALL_12M_CALL"
  | "RECALL_YEARLY"
  | "RECALL_YEARLY_SMS"
  | "RECALL_YEARLY_CALL";

export type CalendarStep = {
  stage: CalendarStageKey;
  channel: CadenceChannelUi;
  /** Grupo lógico na UI */
  cadenceGroup: "B" | "C";
  title: string;
  when: string;
  hint: string;
  templateKey?: string;
  textsFromMultichannel: boolean;
  onlyIfSilent?: boolean;
  editableConfig: boolean;
  /** Toggle na Central de Automações (Grupo C) */
  toggleKey?: string;
};

export type CalendarDay = {
  id: CalendarDayKey;
  label: string;
  subtitle: string;
  /** Badge visual no Motor */
  group: "B" | "C";
  steps: CalendarStep[];
};

export const CADENCE_GROUP_LABEL = {
  A: "Grupo A — Lead novo (quente)",
  B: "Grupo B — Reaquecimento (lead frio)",
  C: "Grupo C — Longo prazo (Meta + recalls)",
} as const;

/** Timeline completa: onda B (D+1→D10) + escada C. */
export const CADENCE_CALENDAR: CalendarDay[] = [
  {
    id: "d1",
    label: "Dia 1 (D+1)",
    subtitle: "Grupo B — reabre o lead frio. 1 canal por vez; SMS/call só se silêncio.",
    group: "B",
    steps: [
      {
        stage: "COLD_1",
        cadenceGroup: "B",
        channel: "whatsapp",
        title: "WhatsApp — reabrir (faixa da conta)",
        when: "D+1 · ~09h30",
        hint: "Primeiro toque da onda. Usa nome do CRM + botões de faixa.",
        templateKey: "b1_wa_reopen",
        textsFromMultichannel: true,
        editableConfig: true,
      },
      {
        stage: "SMS_1",
        cadenceGroup: "B",
        channel: "sms",
        title: "SMS — resgate com link wa.me",
        when: "D+1 · ~2h depois · só se silêncio",
        hint: "Link = WhatsApp conectado (chip), nunca telefone de notificação.",
        templateKey: "b3_sms_1",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
      },
      {
        stage: "CALL_1",
        cadenceGroup: "B",
        channel: "voice",
        title: "Ligação Sofia",
        when: "D+1 · 15h–17h · só se ainda silêncio",
        hint: "Áudio Sofia no Multicanal (publish → voice_audio_clip_id). Sem clip, a ligação não sai.",
        templateKey: "b4_call_1",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
      },
    ],
  },
  {
    id: "d2",
    label: "Dia 2",
    subtitle: "Grupo B — nova abordagem com tema rotativo (diferente do D+1).",
    group: "B",
    steps: [
      {
        stage: "COLD_2",
        cadenceGroup: "B",
        channel: "whatsapp",
        title: "WhatsApp — tema do dia",
        when: "Dia 2 · ~10h30",
        hint: "Motor escolhe um tema da aba Temas ({{tema_whatsapp}}). Não é o 1º contato — D+1 é reabrir.",
        templateKey: "b_day2_wa",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
      },
      {
        stage: "SMS_TEMA_2",
        cadenceGroup: "B",
        channel: "sms",
        title: "SMS do mesmo tema",
        when: "Dia 2 · ~2h após WA · só se silêncio",
        hint: "Mesmo tema do WA. Toggle cadence_sms_tema_2. Textos na aba Temas.",
        templateKey: "b_day2_sms_tema",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
      },
    ],
  },
  {
    id: "d4",
    label: "Dia 4",
    subtitle: "Grupo B — segunda ligação espaçada (anti-spam).",
    group: "B",
    steps: [
      {
        stage: "CALL_2",
        cadenceGroup: "B",
        channel: "voice",
        title: "Ligação Sofia 2",
        when: "Dia 4 · 14h30–17h · só se silêncio",
        hint: "Atualização diferente da que o lead já recebeu.",
        templateKey: "b_day4_call_2",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
      },
    ],
  },
  {
    id: "d6",
    label: "Dia 6",
    subtitle: "Grupo B — segundo SMS (sem ligação no mesmo dia).",
    group: "B",
    steps: [
      {
        stage: "SMS_2",
        cadenceGroup: "B",
        channel: "sms",
        title: "SMS — novidades",
        when: "Dia 6 · ~11h30 · só se silêncio",
        hint: "wa.me do chip + SAIR.",
        templateKey: "b_day6_sms_2",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
      },
    ],
  },
  {
    id: "d7",
    label: "Dia 7",
    subtitle: "Grupo B — resposta fácil (1 toque) + SMS tema se silêncio.",
    group: "B",
    steps: [
      {
        stage: "COLD_3",
        cadenceGroup: "B",
        channel: "whatsapp",
        title: "WhatsApp — resposta fácil",
        when: "Dia 7 · ~10h30",
        hint: "3 botões de faixa. Curto, sem foto obrigatória.",
        templateKey: "b_day7_wa_easy",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
      },
      {
        stage: "SMS_TEMA_7",
        cadenceGroup: "B",
        channel: "sms",
        title: "SMS tema",
        when: "Dia 7 · ~2h após WA · só se silêncio",
        hint: "Toggle cadence_sms_tema_7. Se OFF, avança sem enviar.",
        templateKey: "b_day7_sms_tema",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
      },
    ],
  },
  {
    id: "d10",
    label: "Dia 10",
    subtitle: "Grupo B — encerramento educado da onda curta → entra no Grupo C.",
    group: "B",
    steps: [
      {
        stage: "CALL_3",
        cadenceGroup: "B",
        channel: "voice",
        title: "Ligação final Sofia",
        when: "Dia 10 · ~15h · só se silêncio",
        hint: "Oferece manter análise ou encerrar.",
        templateKey: "b_day10_call",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
      },
      {
        stage: "COLD_4",
        cadenceGroup: "B",
        channel: "whatsapp",
        title: "WhatsApp final — pausar ciclo",
        when: "Dia 10 · após ligação · se não atender",
        hint: "Não exclui cadastro. Botões analisar / ligar / encerrar.",
        templateKey: "b_day10_wa_final",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
      },
    ],
  },
  {
    id: "c",
    label: "Grupo C — Longo prazo",
    subtitle: "Meta + cada marco: WA análise → SMS se silêncio → ligação se silêncio. Toggles no Motor.",
    group: "C",
    steps: [
      {
        stage: "CLOSE_LOST",
        cadenceGroup: "C",
        channel: "meta",
        title: "Fim da onda B → fila Meta",
        when: "Logo após Dia 10",
        hint: "Não manda WhatsApp. Entra na fila de Custom Audience (se sync ON).",
        templateKey: "c_meta_close_lost",
        textsFromMultichannel: true,
        editableConfig: false,
      },
      {
        stage: "RETARGET_META",
        cadenceGroup: "C",
        channel: "meta",
        title: "Sync Custom Audience",
        when: "~1 dia após CLOSE_LOST",
        hint: "Sobe telefone/e-mail (hash). Sem imagem, sem criativo.",
        templateKey: "c_meta_sync_audience",
        textsFromMultichannel: true,
        editableConfig: false,
        toggleKey: "facebook_retarget_sync",
      },
      {
        stage: "RETARGET_ADS_15D",
        cadenceGroup: "C",
        channel: "meta",
        title: "Remarketing ~15 dias",
        when: "~15 dias após sync",
        hint: "Criativo fica no Meta Ads Manager.",
        templateKey: "c_meta_ads_15d",
        textsFromMultichannel: true,
        editableConfig: false,
        toggleKey: "cadence_retarget_ads_15d",
      },
      // ── 60d ──
      {
        stage: "RECALL_60D",
        cadenceGroup: "C",
        channel: "whatsapp",
        title: "1º recall (~30d) — WhatsApp (análise)",
        when: "~14d após Meta/ads · ~30d após Dia 10 · WA primeiro",
        hint: "Nome interno RECALL_60D. Em silêncio → SMS → ligação.",
        templateKey: "c_recall_60d_wa",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_60d",
      },
      {
        stage: "RECALL_60D_SMS",
        cadenceGroup: "C",
        channel: "sms",
        title: "1º recall — SMS",
        when: "~2h após WA · só se silêncio",
        hint: "Mesmo toggle cadence_recall_60d.",
        templateKey: "c_recall_60d_sms",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_60d",
      },
      {
        stage: "RECALL_60D_CALL",
        cadenceGroup: "C",
        channel: "voice",
        title: "1º recall — Ligação Sofia",
        when: "~4h após SMS · só se silêncio",
        hint: "Clip Sofia no Motor.",
        templateKey: "c_recall_60d_call",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_60d",
      },
      // ── 90d ──
      {
        stage: "RECALL_90D",
        cadenceGroup: "C",
        channel: "whatsapp",
        title: "90d — WhatsApp (análise)",
        when: "~90 dias · WA primeiro",
        hint: "Em silêncio → SMS → ligação.",
        templateKey: "c_recall_90d_wa",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_90d",
      },
      {
        stage: "RECALL_90D_SMS",
        cadenceGroup: "C",
        channel: "sms",
        title: "90d — SMS",
        when: "~2h após WA · só se silêncio",
        hint: "Mesmo toggle cadence_recall_90d.",
        templateKey: "c_recall_90d_sms",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_90d",
      },
      {
        stage: "RECALL_90D_CALL",
        cadenceGroup: "C",
        channel: "voice",
        title: "90d — Ligação Sofia",
        when: "~4h após SMS · só se silêncio",
        hint: "Clip Sofia no Motor.",
        templateKey: "c_recall_90d_call",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_90d",
      },
      // ── 5m ──
      {
        stage: "RECALL_5M",
        cadenceGroup: "C",
        channel: "whatsapp",
        title: "5 meses — WhatsApp (análise)",
        when: "~5 meses · WA primeiro",
        hint: "Em silêncio → SMS → ligação.",
        templateKey: "c_recall_5m_wa",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_5m",
      },
      {
        stage: "RECALL_5M_SMS",
        cadenceGroup: "C",
        channel: "sms",
        title: "5 meses — SMS",
        when: "~2h após WA · só se silêncio",
        hint: "Mesmo toggle cadence_recall_5m.",
        templateKey: "c_recall_5m_sms",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_5m",
      },
      {
        stage: "RECALL_5M_CALL",
        cadenceGroup: "C",
        channel: "voice",
        title: "5 meses — Ligação Sofia",
        when: "~4h após SMS · só se silêncio",
        hint: "Clip Sofia no Motor.",
        templateKey: "c_recall_5m_call",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_5m",
      },
      // ── 8m ──
      {
        stage: "RECALL_8M",
        cadenceGroup: "C",
        channel: "whatsapp",
        title: "8 meses — WhatsApp (análise)",
        when: "~8 meses · WA primeiro",
        hint: "Em silêncio → SMS → ligação.",
        templateKey: "c_recall_8m_wa",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_8m",
      },
      {
        stage: "RECALL_8M_SMS",
        cadenceGroup: "C",
        channel: "sms",
        title: "8 meses — SMS",
        when: "~2h após WA · só se silêncio",
        hint: "Mesmo toggle cadence_recall_8m.",
        templateKey: "c_recall_8m_sms",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_8m",
      },
      {
        stage: "RECALL_8M_CALL",
        cadenceGroup: "C",
        channel: "voice",
        title: "8 meses — Ligação Sofia",
        when: "~4h após SMS · só se silêncio",
        hint: "Clip Sofia no Motor.",
        templateKey: "c_recall_8m_call",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_8m",
      },
      // ── 12m ──
      {
        stage: "RECALL_12M",
        cadenceGroup: "C",
        channel: "whatsapp",
        title: "12 meses — WhatsApp (análise)",
        when: "~1 ano · WA primeiro",
        hint: "Em silêncio → SMS → ligação.",
        templateKey: "c_recall_12m_wa",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_12m",
      },
      {
        stage: "RECALL_12M_SMS",
        cadenceGroup: "C",
        channel: "sms",
        title: "12 meses — SMS",
        when: "~2h após WA · só se silêncio",
        hint: "Mesmo toggle cadence_recall_12m.",
        templateKey: "c_recall_12m_sms",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_12m",
      },
      {
        stage: "RECALL_12M_CALL",
        cadenceGroup: "C",
        channel: "voice",
        title: "12 meses — Ligação Sofia",
        when: "~4h após SMS · só se silêncio",
        hint: "Clip Sofia no Motor.",
        templateKey: "c_recall_12m_call",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_12m",
      },
      // ── anual ──
      {
        stage: "RECALL_YEARLY",
        cadenceGroup: "C",
        channel: "whatsapp",
        title: "Anual — WhatsApp (análise)",
        when: "A cada ~1 ano · WA primeiro",
        hint: "Em silêncio → SMS → ligação → loop.",
        templateKey: "c_recall_yearly_wa",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_yearly",
      },
      {
        stage: "RECALL_YEARLY_SMS",
        cadenceGroup: "C",
        channel: "sms",
        title: "Anual — SMS",
        when: "~2h após WA · só se silêncio",
        hint: "Mesmo toggle cadence_recall_yearly.",
        templateKey: "c_recall_yearly_sms",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_yearly",
      },
      {
        stage: "RECALL_YEARLY_CALL",
        cadenceGroup: "C",
        channel: "voice",
        title: "Anual — Ligação Sofia",
        when: "~4h após SMS · só se silêncio",
        hint: "Clip Sofia no Motor.",
        templateKey: "c_recall_yearly_call",
        textsFromMultichannel: true,
        onlyIfSilent: true,
        editableConfig: true,
        toggleKey: "cadence_recall_yearly",
      },
    ],
  },
];

/** Estágios com config editável no painel Motor. */
export const EDITABLE_CALENDAR_STAGES: CalendarStageKey[] = CADENCE_CALENDAR
  .flatMap((d) => d.steps)
  .filter((s) => s.editableConfig)
  .map((s) => s.stage);

export function stepByStage(stage: string): CalendarStep | undefined {
  for (const day of CADENCE_CALENDAR) {
    const found = day.steps.find((s) => s.stage === stage);
    if (found) return found;
  }
  return undefined;
}

export function dayByStage(stage: string): CalendarDay | undefined {
  return CADENCE_CALENDAR.find((d) => d.steps.some((s) => s.stage === stage));
}

export const CHANNEL_LABEL: Record<CadenceChannelUi, string> = {
  whatsapp: "WhatsApp",
  voice: "Ligação",
  sms: "SMS",
  meta: "Meta (público)",
  system: "Sistema",
};
