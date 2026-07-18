/**
 * Checklist de validação — Zero Lead Perdido v5 + SMS wa.me.
 * Usado em /admin/checklist (manual + auto-checks no banco).
 */

export type ChecklistGroup =
  | "seguro"
  | "motor"
  | "grupoA"
  | "grupoB"
  | "grupoC"
  | "temas"
  | "sms"
  | "voz"
  | "meta"
  | "ops";

export type ChecklistItem = {
  key: string;
  title: string;
  desc: string;
  link: string;
  group: ChecklistGroup;
  /** Se true, o item também entra no auto-audit (status vem do banco). */
  autoKey?: string;
};

export const CHECKLIST_GROUPS: Record<
  ChecklistGroup,
  { label: string; hint: string }
> = {
  seguro: {
    label: "Segurança (não ligar ainda)",
    hint: "Confirme que nada automático está disparando em massa.",
  },
  motor: {
    label: "Motor Zero Lead Perdido",
    hint: "Escada D+1…D10, cap 60, anti-spam e estágios novos.",
  },
  grupoA: {
    label: "Grupo A — Lead novo (NÃO alterar)",
    hint: "Congelado: textos, steps e bot-flow do lead quente.",
  },
  grupoB: {
    label: "Grupo B — Reaquecimento (lead frio)",
    hint: "Onda curta D+1 → Dia 10 no Multicanal.",
  },
  grupoC: {
    label: "Grupo C — Longo prazo (Meta + recalls)",
    hint: "Cada marco: WA análise → SMS → ligação se silêncio. Toggles OFF até validar onda B.",
  },
  temas: {
    label: "Temas (Dia 2 / Dia 7)",
    hint: "Biblioteca theme_* usada pelo picker do motor.",
  },
  sms: {
    label: "SMS + link wa.me",
    hint: "Todo SMS precisa do chip conectado (não notification_phone).",
  },
  voz: {
    label: "Ligações Sofia",
    hint: "Áudios D+1, Dia 4 e Dia 10 prontos e testáveis.",
  },
  meta: {
    label: "Remarketing Meta (Grupo C)",
    hint: "Custom Audience + estágio RETARGET_ADS_15D (ainda OFF).",
  },
  ops: {
    label: "Operação / go-live",
    hint: "Só depois de validar 1 consultor piloto.",
  },
};

export const ZERO_LEAD_CHECKLIST: ChecklistItem[] = [
  // ── Segurança ──
  {
    key: "s1_engine_off",
    title: "Motor `cadence_engine` continua OFF",
    desc: "Na Central de Automações, confirme que **cadence_engine** está desligado. Nenhum frio deve sair sozinho.",
    link: "/admin?tab=agendamentos",
    group: "seguro",
    autoKey: "cadence_engine_off",
  },
  {
    key: "s2_reheat_off",
    title: "`daily-reheat` live continua OFF",
    desc: "Não religar reheat ao vivo junto com o motor — duplicaria toques frios.",
    link: "/admin?tab=agendamentos",
    group: "seguro",
    autoKey: "reheat_live_off",
  },
  {
    key: "s3_recalls_off",
    title: "Recalls longos OFF (~30d → yearly)",
    desc: "Toggles `cadence_recall_*` e configs RECALL_* devem ficar **desligados** até validar a onda curta.",
    link: "/admin/motor",
    group: "seguro",
    autoKey: "recalls_off",
  },
  {
    key: "s4_sms_tema_off",
    title: "SMS tema Dia 2/7 OFF até validar WA",
    desc: "`cadence_sms_tema_2` e `cadence_sms_tema_7` OFF. Com OFF, o motor **avança sem enviar** (não trava a escada).",
    link: "/admin?tab=agendamentos",
    group: "seguro",
    autoKey: "sms_tema_off",
  },
  {
    key: "s5_retarget_off",
    title: "Remarketing Meta OFF",
    desc: "`cadence_retarget_ads_15d` e `facebook_retarget_sync` OFF até ter Custom Audience OK.",
    link: "/admin?tab=agendamentos",
    group: "seguro",
    autoKey: "retarget_off",
  },
  {
    key: "s6_kill_switch",
    title: "Kill switch global conhecido",
    desc: "Super Admin → Assistente Global → `bot_global_enabled`. Use só se precisar pausar tudo.",
    link: "/admin",
    group: "seguro",
    autoKey: "bot_global_known",
  },

  // ── Motor ──
  {
    key: "m1_cap60",
    title: "Cap frio = 60 pessoas/dia (BRT)",
    desc: "Card **X/60** na Central. Lead novo não conta; frio conta. Estoura → agenda amanhã.",
    link: "/admin/agendamentos-central",
    group: "motor",
    autoKey: "cap_60",
  },
  {
    key: "m2_stage_map",
    title: "Escada: COLD→SMS→CALL→tema→CLOSE_LOST",
    desc: "Confirme no Motor: COLD_1→SMS_1→CALL_1→COLD_2→SMS_TEMA_2→CALL_2→SMS_2→COLD_3→SMS_TEMA_7→CALL_3→COLD_4→CLOSE_LOST.",
    link: "/admin/motor",
    group: "motor",
  },
  {
    key: "m3_skip_engaged",
    title: "Anti-spam: SMS/call só se silêncio",
    desc: "Com inbound, o tick pula o toque invasivo (`skipIfEngaged`) e avança. Valide mentalmente D+1 SMS/call.",
    link: "/admin/motor",
    group: "motor",
  },
  {
    key: "m4_dual_channel",
    title: "Failover Evolution ↔ Whapi",
    desc: "WhatsApp frio tenta canal do lead; se offline, failover do consultor. Instância precisa estar saudável.",
    link: "/admin/whatsapp-clients",
    group: "motor",
  },
  {
    key: "m5_paused_resume",
    title: "PAUSED retoma para COLD_1",
    desc: "Após inbound, lead pausado com `next_action_at` vencido volta à onda curta (não some).",
    link: "/admin/motor",
    group: "motor",
  },
  {
    key: "m6_cold2_tema",
    title: "COLD_2 = `{{tema_whatsapp}}` no banco",
    desc: "Config global do estágio COLD_2 deve ser o placeholder (picker escolhe o tema em runtime).",
    link: "/admin/motor",
    group: "motor",
    autoKey: "cold2_tema",
  },
  {
    key: "m7_sms_tema_stages",
    title: "Estágios SMS_TEMA_2 e SMS_TEMA_7 existem",
    desc: "Seeds com `{{tema_sms}}`, delay 2h, enabled no config (toggle ainda OFF).",
    link: "/admin/motor",
    group: "motor",
    autoKey: "sms_tema_stages",
  },

  // ── Grupo A ──
  {
    key: "a1_freeze",
    title: "Grupo A intocado (lead novo)",
    desc: "Não editar textos/steps/bot-flow do Grupo A nesta onda. Só conferir que continua igual.",
    link: "/admin?tab=agendamentos",
    group: "grupoA",
  },
  {
    key: "a2_saudacao",
    title: "Grupo A — saudação + qualificação",
    desc: "Abrir Multicanal → Grupo A e confirmar abertura, áudios e botões do lead quente.",
    link: "/admin/agendamentos-central",
    group: "grupoA",
  },

  // ── Grupo B textos ──
  {
    key: "b0_nome",
    title: "B — Pedir nome (só se faltar)",
    desc: "Timing **D+1**. Texto pede primeiro nome sem botões.",
    link: "/admin/agendamentos-central",
    group: "grupoB",
  },
  {
    key: "b1_reopen",
    title: "B — Reabrir (faixa da conta) 09h30",
    desc: "D+1 WA com 3 botões de faixa + `{{frase_disponibilidade}}` + SAIR.",
    link: "/admin/agendamentos-central",
    group: "grupoB",
  },
  {
    key: "b1b_outras",
    title: "B — Outras opções (foto / ligar / encerrar)",
    desc: "Passo 2b depois das 09h30, só se precisar.",
    link: "/admin/agendamentos-central",
    group: "grupoB",
  },
  {
    key: "b3_sms1",
    title: "B — SMS D+1 (silêncio)",
    desc: "Texto ≤160 com **https://wa.me/{{consultor_phone}}** e SAIR. Conferir prévia Multicanal.",
    link: "/admin/agendamentos-central",
    group: "grupoB",
  },
  {
    key: "b4_call1",
    title: "B — Ligação D+1 (Sofia 15h–17h)",
    desc: "Áudio: valor médio / WhatsApp / sem Pix. Só se ainda silêncio.",
    link: "/admin?tab=voz",
    group: "grupoB",
  },
  {
    key: "b_day2_wa",
    title: "B — Dia 2 WA tema",
    desc: "Body `{{tema_whatsapp}}`. Motor escolhe theme_* ≠ último toque.",
    link: "/admin/agendamentos-central",
    group: "grupoB",
  },
  {
    key: "b_day2_sms",
    title: "B — Dia 2 SMS tema (silêncio)",
    desc: "Catálogo `b_day2_sms_tema` → estágio SMS_TEMA_2. Toggle OFF até validar.",
    link: "/admin/agendamentos-central",
    group: "grupoB",
  },
  {
    key: "b_day4_call",
    title: "B — Dia 4 ligação 2",
    desc: "Atualização diferente; espaçada (anti-spam).",
    link: "/admin?tab=voz",
    group: "grupoB",
  },
  {
    key: "b_day6_sms",
    title: "B — Dia 6 SMS 2",
    desc: "Sem ligação no mesmo dia. Link wa.me + SAIR.",
    link: "/admin/agendamentos-central",
    group: "grupoB",
  },
  {
    key: "b_day7_wa",
    title: "B — Dia 7 WA resposta fácil",
    desc: "1 toque / faixa. Em silêncio → SMS_TEMA_7.",
    link: "/admin/agendamentos-central",
    group: "grupoB",
  },
  {
    key: "b_day7_sms",
    title: "B — Dia 7 SMS tema",
    desc: "Catálogo `b_day7_sms_tema`. Toggle OFF até validar.",
    link: "/admin/agendamentos-central",
    group: "grupoB",
  },
  {
    key: "b_day7b",
    title: "B — Dia 7 outras opções",
    desc: "Foto / ligar / encerrar.",
    link: "/admin/agendamentos-central",
    group: "grupoB",
  },
  {
    key: "b_day10_call",
    title: "B — Dia 10 ligação final",
    desc: "Encerramento educado; oferece manter análise ou encerrar.",
    link: "/admin?tab=voz",
    group: "grupoB",
  },
  {
    key: "b_day10_wa",
    title: "B — Dia 10 WA final (CLOSE_LOST)",
    desc: "Pausa ciclo sem excluir cadastro. Botões analisar / ligar / encerrar.",
    link: "/admin/agendamentos-central",
    group: "grupoB",
  },

  // ── Grupo C (Meta + recalls) ──
  {
    key: "c_meta_guia",
    title: "C — Meta: guias CLOSE_LOST / sync / ~15d",
    desc: "Multicanal → Grupo C: cards informativos (não enviam WA). Toggles `facebook_retarget_sync` e `cadence_retarget_ads_15d` OFF.",
    link: "/admin?tab=voz&sub=textos&cadenceGroup=C",
    group: "grupoC",
  },
  {
    key: "c_recall_60",
    title: "C — 1º recall (~30d): WA → SMS → ligação",
    desc: "`c_recall_60d_wa` + SMS + call se silêncio (14d após Meta). Toggle `cadence_recall_60d` OFF.",
    link: "/admin?tab=voz&sub=textos&cadenceGroup=C",
    group: "grupoC",
  },
  {
    key: "c_recall_90",
    title: "C — 90d: WA → SMS → ligação",
    desc: "Mesmo padrão. Toggle `cadence_recall_90d` OFF.",
    link: "/admin?tab=voz&sub=textos&cadenceGroup=C",
    group: "grupoC",
  },
  {
    key: "c_recall_5m",
    title: "C — 5m: WA → SMS → ligação",
    desc: "WA análise primeiro; ligação Sofia só se silêncio. Clips no Motor. Toggle OFF.",
    link: "/admin/motor",
    group: "grupoC",
  },
  {
    key: "c_recall_8m",
    title: "C — 8m: WA → SMS → ligação",
    desc: "Mesmo padrão. Toggle `cadence_recall_8m` OFF.",
    link: "/admin?tab=voz&sub=textos&cadenceGroup=C",
    group: "grupoC",
  },
  {
    key: "c_recall_12m",
    title: "C — 12m: WA → SMS → ligação",
    desc: "Mesmo padrão. Toggle `cadence_recall_12m` OFF.",
    link: "/admin?tab=voz&sub=textos&cadenceGroup=C",
    group: "grupoC",
  },
  {
    key: "c_recall_yearly",
    title: "C — Anual: WA → SMS → ligação (loop)",
    desc: "Mesmo padrão + loop. Toggle `cadence_recall_yearly` OFF.",
    link: "/admin?tab=voz&sub=textos&cadenceGroup=C",
    group: "grupoC",
  },

  // ── Temas ──
  {
    key: "t1_safe_themes",
    title: "Temas seguros (sem cruise) revisados",
    desc: "Análise simplificada, bandeiras, sem placas, segurança, clube, indicação, app — WA + SMS.",
    link: "/admin/agendamentos-central",
    group: "temas",
  },
  {
    key: "t2_cruise_gated",
    title: "Tema cruzeiro só com aprovação",
    desc: "Não entra no picker automático. Só com `CRUISE_CAMPAIGN_APPROVED`.",
    link: "/admin/agendamentos-central",
    group: "temas",
  },

  // ── SMS ──
  {
    key: "sms1_wame",
    title: "Todos os SMS têm wa.me do chip",
    desc: "Cascata: `whatsapp_instances.connected_phone` → `consultants.phone`. **Nunca** notification_phone.",
    link: "/admin/agendamentos-central",
    group: "sms",
  },
  {
    key: "sms2_preview",
    title: "Prévia Multicanal com telefone real",
    desc: "Abrir prévia SMS e confirmar link `https://wa.me/` com telefone do consultor (não vazio nem literal `{{consultor_phone}}`).",
    link: "/admin/agendamentos-central",
    group: "sms",
  },
  {
    key: "sms3_rafael_chip",
    title: "Rafael: chip conectado (ou fallback phone)",
    desc: "Se Evolution `needs_reconnect` / connected_phone null, SMS usa `consultants.phone` — validar número.",
    link: "/admin/whatsapp-clients",
    group: "sms",
  },

  // ── Voz ──
  {
    key: "v1_clips",
    title: "Clips Sofia D+1 / Dia 4 / Dia 10",
    desc: "Áudios stitchados e testados no painel de voz (dryRun / kit).",
    link: "/admin?tab=voz",
    group: "voz",
  },
  {
    key: "v2_velip",
    title: "Velip configurado para o consultor piloto",
    desc: "Sem Velip, CALL_* falha com `velip_not_configured`.",
    link: "/admin?tab=voz",
    group: "voz",
  },

  // ── Meta ──
  {
    key: "meta1_audience",
    title: "Custom Audience ativa no Facebook",
    desc: "`facebook_connections.custom_audience_id` preenchido e status active.",
    link: "/admin/meta-ads",
    group: "meta",
    autoKey: "meta_audience",
  },
  {
    key: "meta2_ads15",
    title: "RETARGET_ADS_15D entendido",
    desc: "~15 dias após Meta; sync pontual no tick + job em lote. Só ligar depois da onda curta OK.",
    link: "/admin/motor",
    group: "meta",
  },

  // ── Ops ──
  {
    key: "o1_piloto",
    title: "Validar 1 consultor piloto (dry / shadow)",
    desc: "Ligar só estágios COLD/SMS/CALL desse consultor depois de revisar textos. Nunca tudo de uma vez.",
    link: "/admin/motor",
    group: "ops",
  },
  {
    key: "o2_onda_curta",
    title: "Liberar onda curta antes de recalls/Meta",
    desc: "Ordem: textos → cap 60 → COLD/SMS/CALL → SMS tema → retarget → recalls.",
    link: "/admin?tab=agendamentos",
    group: "ops",
  },
  {
    key: "o3_monitor",
    title: "Monitorar cadence_action_log + X/60",
    desc: "No 1º dia ligado: ver `sent`/`skipped_engaged`/`failed` e o card de cap.",
    link: "/admin/agendamentos-central",
    group: "ops",
  },
];

export type AutoCheckResult = {
  key: string;
  ok: boolean | null;
  label: string;
  detail: string;
};

export async function runZeroLeadAutoAudit(supabase: {
  from: (t: string) => any;
}): Promise<AutoCheckResult[]> {
  const results: AutoCheckResult[] = [];

  const { data: toggles } = await supabase
    .from("automation_toggles")
    .select("key, enabled")
    .in("key", [
      "cadence_engine",
      "cadence_sms_tema_2",
      "cadence_sms_tema_7",
      "cadence_retarget_ads_15d",
      "facebook_retarget_sync",
      "cadence_recall_60d",
      "cadence_recall_90d",
      "cadence_recall_5m",
      "cadence_recall_8m",
      "cadence_recall_12m",
      "cadence_recall_yearly",
    ]);

  const tmap = new Map<string, boolean>(
    (toggles ?? []).map((r: { key: string; enabled: boolean }) => [r.key, !!r.enabled]),
  );

  results.push({
    key: "cadence_engine_off",
    ok: tmap.get("cadence_engine") === false,
    label: "cadence_engine OFF",
    detail: tmap.has("cadence_engine")
      ? tmap.get("cadence_engine") ? "LIGADO — risco de disparo" : "OK desligado"
      : "toggle não encontrado",
  });

  const smsTemaOff =
    tmap.get("cadence_sms_tema_2") === false && tmap.get("cadence_sms_tema_7") === false;
  results.push({
    key: "sms_tema_off",
    ok: smsTemaOff,
    label: "SMS tema OFF",
    detail: smsTemaOff ? "OK ambos OFF" : "Algum SMS tema está ON",
  });

  const retargetOff =
    tmap.get("cadence_retarget_ads_15d") === false &&
    tmap.get("facebook_retarget_sync") === false;
  results.push({
    key: "retarget_off",
    ok: retargetOff,
    label: "Retarget OFF",
    detail: retargetOff ? "OK ambos OFF" : "Algum retarget está ON",
  });

  const recallKeys = [
    "cadence_recall_60d",
    "cadence_recall_90d",
    "cadence_recall_5m",
    "cadence_recall_8m",
    "cadence_recall_12m",
    "cadence_recall_yearly",
  ];
  const recallsOff = recallKeys.every((k) => tmap.get(k) === false);
  results.push({
    key: "recalls_off",
    ok: recallsOff,
    label: "Recalls OFF",
    detail: recallsOff ? "OK todos OFF" : "Algum recall ON",
  });

  const { data: reheat } = await supabase
    .from("daily_reheat_settings")
    .select("daily_whapi_cap, live_dispatch_enabled")
    .limit(1)
    .maybeSingle();

  const cap = Number(reheat?.daily_whapi_cap);
  results.push({
    key: "cap_60",
    ok: cap === 60,
    label: "Cap diário = 60",
    detail: Number.isFinite(cap) ? `Atual: ${cap}` : "Sem daily_reheat_settings",
  });

  results.push({
    key: "reheat_live_off",
    ok: reheat?.live_dispatch_enabled === false || reheat?.live_dispatch_enabled == null,
    label: "Reheat live OFF",
    detail: reheat?.live_dispatch_enabled ? "LIGADO — perigo" : "OK desligado",
  });

  const { data: app } = await supabase
    .from("app_settings")
    .select("bot_global_enabled")
    .eq("id", "global")
    .maybeSingle();

  results.push({
    key: "bot_global_known",
    ok: typeof app?.bot_global_enabled === "boolean",
    label: "Kill switch legível",
    detail:
      app?.bot_global_enabled === true
        ? "bot_global_enabled = true (bot pode falar)"
        : app?.bot_global_enabled === false
          ? "bot_global_enabled = false (tudo pausado)"
          : "Não li app_settings",
  });

  const { data: stages } = await supabase
    .from("cadence_stage_config")
    .select("stage, enabled, message_text")
    .is("consultant_id", null)
    .in("stage", ["COLD_2", "SMS_TEMA_2", "SMS_TEMA_7"]);

  const byStage = new Map(
    (stages ?? []).map((s: { stage: string; enabled: boolean; message_text: string | null }) => [
      s.stage,
      s,
    ]),
  );

  const cold2 = byStage.get("COLD_2");
  results.push({
    key: "cold2_tema",
    ok: !!cold2?.message_text?.includes("{{tema_whatsapp}}"),
    label: "COLD_2 com tema",
    detail: cold2
      ? `msg: ${(cold2.message_text || "").slice(0, 40)}`
      : "COLD_2 sem config global",
  });

  const st2 = byStage.get("SMS_TEMA_2");
  const st7 = byStage.get("SMS_TEMA_7");
  results.push({
    key: "sms_tema_stages",
    ok: !!(st2 && st7 && (st2.message_text || "").includes("{{tema_sms}}") && (st7.message_text || "").includes("{{tema_sms}}")),
    label: "SMS_TEMA_* seeds",
    detail: st2 && st7 ? "OK SMS_TEMA_2 + SMS_TEMA_7" : "Falta seed de SMS tema",
  });

  const { data: fb } = await supabase
    .from("facebook_connections")
    .select("custom_audience_id, status")
    .eq("status", "active")
    .not("custom_audience_id", "is", null)
    .limit(1)
    .maybeSingle();

  results.push({
    key: "meta_audience",
    ok: !!fb?.custom_audience_id,
    label: "Custom Audience ativa",
    detail: fb?.custom_audience_id
      ? `Audience ${String(fb.custom_audience_id).slice(0, 12)}…`
      : "Nenhuma connection active com audience",
  });

  return results;
}
