import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isIgreenWalletOrigin } from "@/lib/customerOrigin";
import { LEAD_ORIGIN_FILTER } from "@/lib/leadOrigin";
import { isCycleLeadEligible } from "@/lib/cycleEligibility";
import {
  buildUpcomingPosVendaMessages,
  groupSentStageKeys,
  type UpcomingPosVendaItem,
} from "@/lib/posVendaSchedule";
import type { PosVendaStage } from "@/lib/posVenda/format";
import {
  buildAgendamentosTimeline,
  DEFAULT_REACTIVATION_SETTINGS,
  type BotFollowupRow,
  type BulkCampaignRow,
  type CadenceScheduleRow,
  type CadenceStageInfo,
  type DailyReheatRow,
  type PendingMediaRow,
  type ReactivationSettingsSummary,
  type ScheduledMessageRow,
  type VoiceCampaignRow,
  type VoiceRetryRow,
} from "@/lib/agendamentosHub";

export function useAgendamentosHub(consultantId: string) {
  const [loading, setLoading] = useState(true);
  const [manual, setManual] = useState<ScheduledMessageRow[]>([]);
  const [posVenda, setPosVenda] = useState<UpcomingPosVendaItem[]>([]);
  const [botFollowups, setBotFollowups] = useState<BotFollowupRow[]>([]);
  const [bulkCampaigns, setBulkCampaigns] = useState<BulkCampaignRow[]>([]);
  const [voiceCampaigns, setVoiceCampaigns] = useState<VoiceCampaignRow[]>([]);
  const [cadence, setCadence] = useState<CadenceScheduleRow[]>([]);
  const [cadenceStageInfo, setCadenceStageInfo] = useState<Record<string, CadenceStageInfo>>({});
  const [dailyReheat, setDailyReheat] = useState<DailyReheatRow[]>([]);
  const [pendingMedia, setPendingMedia] = useState<PendingMediaRow[]>([]);
  const [voiceRetries, setVoiceRetries] = useState<VoiceRetryRow[]>([]);
  const [reactivationSettings, setReactivationSettings] = useState<ReactivationSettingsSummary>(
    DEFAULT_REACTIVATION_SETTINGS,
  );
  const [autoReactivateTemplates, setAutoReactivateTemplates] = useState(0);
  const [pendingValidation, setPendingValidation] = useState(0);

  const refresh = useCallback(async () => {
    if (!consultantId) return;
    setLoading(true);
    try {
      const [
        manualRes,
        custRes,
        logRes,
        defRes,
        followupRes,
        bulkRes,
        voiceRes,
        settingsRes,
        templatesRes,
        pendingValidationRes,
        cadenceRes,
        reheatRes,
        mediaRes,
      ] = await Promise.all([
        supabase
          .from("scheduled_messages")
          .select("id, remote_jid, message_text, scheduled_at, status, sent_at")
          .eq("consultant_id", consultantId)
          .order("scheduled_at", { ascending: true }),
        supabase
          .from("customers")
          .select("id, name, phone_whatsapp, pos_venda_stage, pos_venda_approved_at, pos_venda_rejected_at, customer_origin")
          .or(`consultant_id.eq.${consultantId},assigned_consultant_id.eq.${consultantId}`)
          .in("pos_venda_stage", ["aprovado", "reprovado", "retentativa", "d30", "d60", "d90", "d120", "d150", "d180", "d210"]),
        supabase
          .from("customer_auto_message_log")
          .select("customer_id, stage_key")
          .eq("consultant_id", consultantId),
        supabase
          .from("pos_venda_default_media")
          .select("stage, message_text")
          .eq("is_active", true),
        supabase
          .from("customers")
          .select("id, name, phone_whatsapp, next_followup_at, conversation_step")
          .eq("consultant_id", consultantId)
          .not("next_followup_at", "is", null)
          .eq("bot_paused", false)
          .is("assigned_human_id", null)
          .or(LEAD_ORIGIN_FILTER)
          .order("next_followup_at", { ascending: true })
          .limit(50),
        (supabase as any)
          .from("bulk_campaigns")
          .select("id, name, status, total, sent, failed, scheduled_at, started_at")
          .eq("consultant_id", consultantId)
          .in("status", ["scheduled", "running", "paused"])
          .order("scheduled_at", { ascending: true, nullsFirst: false }),
        (supabase as any)
          .from("voice_campaigns")
          .select("id, name, status, total, dialed, answered, failed, scheduled_at, started_at, created_at")
          .eq("consultant_id", consultantId)
          .in("status", ["scheduled", "running", "paused"])
          .order("scheduled_at", { ascending: true, nullsFirst: false }),
        (supabase as any)
          .from("reactivation_settings")
          .select("*")
          .eq("consultant_id", consultantId)
          .maybeSingle(),
        (supabase as any)
          .from("reactivation_templates")
          .select("id", { count: "exact", head: true })
          .eq("consultant_id", consultantId)
          .eq("is_active", true)
          .eq("auto_reactivate", true),
        supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .or(`consultant_id.eq.${consultantId},assigned_consultant_id.eq.${consultantId}`)
          .eq("customer_origin", "igreen_sync")
          .not("pos_venda_pending_stage", "is", null)
          .eq("pos_venda_invalid", false),
        supabase
          .from("lead_cadence_state")
          .select("id, customer_id, stage, next_action_at, paused_until, paused_reason")
          .eq("consultant_id", consultantId)
          .not("next_action_at", "is", null)
          .not("stage", "in", "(WON)")
          .order("next_action_at", { ascending: true })
          .limit(2000),
        (supabase as any)
          .from("daily_reheat_queue")
          .select("id, customer_id, queue, step, status, next_action_at, planned_actions")
          .eq("consultant_id", consultantId)
          .in("status", ["planned", "claimed"])
          .order("next_action_at", { ascending: true })
          .limit(500),
        (supabase as any)
          .from("pending_outbound_media")
          .select("id, customer_id, scheduled_for, payload")
          .eq("consultant_id", consultantId)
          .is("succeeded_at", null)
          .order("scheduled_for", { ascending: true })
          .limit(200),
      ]);

      setManual((manualRes.data || []) as ScheduledMessageRow[]);

      const wallet = (custRes.data || []).filter((c) =>
        isIgreenWalletOrigin((c as { customer_origin?: string }).customer_origin),
      );
      const previews: Partial<Record<PosVendaStage, string>> = {};
      for (const d of defRes.data || []) {
        if (d.message_text) previews[d.stage as PosVendaStage] = d.message_text;
      }
      setPosVenda(
        buildUpcomingPosVendaMessages(
          wallet.map((c) => ({
            id: c.id,
            name: c.name,
            phone_whatsapp: c.phone_whatsapp,
            pos_venda_stage: c.pos_venda_stage,
            pos_venda_approved_at: c.pos_venda_approved_at,
            pos_venda_rejected_at: c.pos_venda_rejected_at,
          })),
          groupSentStageKeys((logRes.data || []) as Array<{ customer_id: string; stage_key: string }>),
          previews,
        ),
      );

      setBotFollowups((followupRes.data || []) as BotFollowupRow[]);
      setBulkCampaigns((bulkRes.data || []) as BulkCampaignRow[]);
      setVoiceCampaigns((voiceRes.data || []) as VoiceCampaignRow[]);

      const cadenceRows = (cadenceRes.data || []) as Array<{
        id: string;
        customer_id: string;
        stage: string;
        next_action_at: string;
        paused_until: string | null;
        paused_reason: string | null;
      }>;
      const reheatRows = (reheatRes.data || []) as Array<{
        id: string;
        customer_id: string;
        queue: string;
        step: string;
        status: string;
        next_action_at: string;
        planned_actions: unknown;
      }>;
      const mediaRows = (mediaRes.data || []) as Array<{
        id: string | number;
        customer_id: string | null;
        scheduled_for: string;
        payload: unknown;
      }>;

      const enrichIds = Array.from(
        new Set([
          ...cadenceRows.map((r) => r.customer_id),
          ...reheatRows.map((r) => r.customer_id),
          ...mediaRows.map((r) => r.customer_id).filter(Boolean) as string[],
        ]),
      );

      const cadenceCustomers = enrichIds.length
        ? await supabase
            .from("customers")
            .select("id, name, phone_whatsapp, customer_origin, status, conversation_step, portal_submitted_at, do_not_contact")
            .in("id", enrichIds)
        : { data: [] as Array<{
            id: string;
            name: string | null;
            phone_whatsapp: string | null;
            customer_origin: string | null;
            status: string | null;
            conversation_step: string | null;
            portal_submitted_at: string | null;
            do_not_contact: boolean | null;
          }> };

      const custMap = new Map<string, {
        name: string | null;
        phone_whatsapp: string | null;
        customer_origin: string | null;
        status: string | null;
        conversation_step: string | null;
        portal_submitted_at: string | null;
        do_not_contact: boolean | null;
      }>();
      for (const c of (cadenceCustomers.data || []) as Array<{
        id: string;
        name: string | null;
        phone_whatsapp: string | null;
        customer_origin: string | null;
        status: string | null;
        conversation_step: string | null;
        portal_submitted_at: string | null;
        do_not_contact: boolean | null;
      }>) {
        custMap.set(c.id, {
          name: c.name,
          phone_whatsapp: c.phone_whatsapp,
          customer_origin: c.customer_origin,
          status: c.status,
          conversation_step: c.conversation_step,
          portal_submitted_at: c.portal_submitted_at,
          do_not_contact: c.do_not_contact,
        });
      }

      const eligibleCadence = cadenceRows.filter((r) => {
        const c = custMap.get(r.customer_id);
        if (!c) return false;
        return isCycleLeadEligible({ ...c, paused_reason: r.paused_reason, active_cadence: !!r.next_action_at });
      });
      setCadence(
        eligibleCadence.map((r) => ({
          id: r.id,
          customer_id: r.customer_id,
          stage: r.stage,
          next_action_at: r.next_action_at,
          paused_until: r.paused_until,
          customer_name: custMap.get(r.customer_id)?.name ?? null,
          customer_phone: custMap.get(r.customer_id)?.phone_whatsapp ?? null,
        })),
      );

      setDailyReheat(
        reheatRows.map((r) => ({
          id: r.id,
          customer_id: r.customer_id,
          queue: r.queue,
          step: r.step,
          status: r.status,
          next_action_at: r.next_action_at,
          planned_actions: r.planned_actions,
          customer_name: custMap.get(r.customer_id)?.name ?? null,
          customer_phone: custMap.get(r.customer_id)?.phone_whatsapp ?? null,
        })),
      );

      setPendingMedia(
        mediaRows.map((r) => ({
          id: r.id,
          customer_id: r.customer_id,
          scheduled_for: r.scheduled_for,
          payload: r.payload,
          customer_name: r.customer_id ? custMap.get(r.customer_id)?.name ?? null : null,
          customer_phone: r.customer_id ? custMap.get(r.customer_id)?.phone_whatsapp ?? null : null,
        })),
      );

      // Retries de voz: targets com próxima tentativa (campanhas do consultor).
      const campaignIds = ((voiceRes.data || []) as VoiceCampaignRow[]).map((c) => c.id);
      const campaignNameById = new Map(
        ((voiceRes.data || []) as VoiceCampaignRow[]).map((c) => [c.id, c.name] as const),
      );
      if (campaignIds.length) {
        const { data: targetRows } = await (supabase as any)
          .from("voice_campaign_targets")
          .select("id, campaign_id, customer_id, name, phone, status, next_attempt_at, attempts, max_attempts")
          .in("campaign_id", campaignIds)
          .in("status", ["queued", "dialing"])
          .not("next_attempt_at", "is", null)
          .order("next_attempt_at", { ascending: true })
          .limit(300);
        setVoiceRetries(
          ((targetRows || []) as Array<{
            id: string;
            campaign_id: string;
            customer_id: string | null;
            name: string | null;
            phone: string | null;
            status: string;
            next_attempt_at: string;
            attempts: number;
            max_attempts: number;
          }>).map((t) => ({
            id: t.id,
            campaign_id: t.campaign_id,
            campaign_name: campaignNameById.get(t.campaign_id) ?? null,
            customer_id: t.customer_id,
            name: t.name,
            phone: t.phone,
            status: t.status,
            next_attempt_at: t.next_attempt_at,
            attempts: t.attempts ?? 0,
            max_attempts: t.max_attempts ?? 3,
          })),
        );
      } else {
        setVoiceRetries([]);
      }

      const stageCfg = await (supabase as any)
        .from("cadence_stage_config")
        .select("stage, message_text, voice_audio_clip_id, buttons, consultant_id")
        .or(`consultant_id.eq.${consultantId},consultant_id.is.null`);
      const cfgRows = (stageCfg.data || []) as Array<{
        stage: string;
        message_text: string | null;
        voice_audio_clip_id: string | null;
        buttons: unknown;
        consultant_id: string | null;
      }>;
      const cfgByStage = new Map<
        string,
        { message_text: string | null; voice_audio_clip_id: string | null; buttons: unknown }
      >();
      for (const row of cfgRows) {
        const existing = cfgByStage.get(row.stage);
        if (!existing || row.consultant_id) {
          cfgByStage.set(row.stage, {
            message_text: row.message_text,
            voice_audio_clip_id: row.voice_audio_clip_id,
            buttons: row.buttons,
          });
        }
      }
      const clipIds = Array.from(
        new Set(Array.from(cfgByStage.values()).map((v) => v.voice_audio_clip_id).filter(Boolean) as string[]),
      );
      const clipMap = new Map<string, string>();
      if (clipIds.length) {
        const clipRes = await (supabase as any)
          .from("voice_audio_clips")
          .select("id, audio_url")
          .in("id", clipIds);
        for (const c of (clipRes.data || []) as Array<{ id: string; audio_url: string | null }>) {
          if (c.audio_url) clipMap.set(c.id, c.audio_url);
        }
      }
      const stageInfo: Record<string, CadenceStageInfo> = {};
      for (const [stage, v] of cfgByStage.entries()) {
        const btnRaw = Array.isArray(v.buttons) ? v.buttons : [];
        const buttons = btnRaw
          .map((b: any) => (b && typeof b === "object" && b.title ? { id: String(b.id ?? b.title), title: String(b.title) } : null))
          .filter(Boolean) as { id: string; title: string }[];
        stageInfo[stage] = {
          message_text: v.message_text,
          audio_url: v.voice_audio_clip_id ? clipMap.get(v.voice_audio_clip_id) ?? null : null,
          buttons: buttons.length ? buttons : null,
        };
      }
      setCadenceStageInfo(stageInfo);

      if (settingsRes.data) {
        const s = settingsRes.data;
        setReactivationSettings({
          auto_enabled: !!s.auto_enabled,
          horas_ate_primeiro_followup: s.horas_ate_primeiro_followup ?? 24,
          max_envios: s.max_envios ?? 3,
          horas_entre_envios: s.horas_entre_envios ?? 48,
          janela_inicio: s.janela_inicio ?? 9,
          janela_fim: s.janela_fim ?? 20,
          enviar_fim_de_semana: !!s.enviar_fim_de_semana,
        });
      } else {
        setReactivationSettings(DEFAULT_REACTIVATION_SETTINGS);
      }

      setAutoReactivateTemplates(templatesRes.count ?? 0);
      setPendingValidation((pendingValidationRes as any).count ?? 0);
    } finally {
      setLoading(false);
    }
  }, [consultantId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const timeline = buildAgendamentosTimeline({
    manual,
    posVenda,
    botFollowups,
    bulk: bulkCampaigns,
    voice: voiceCampaigns,
    cadence,
    cadenceStageInfo,
    dailyReheat,
    pendingMedia,
    voiceRetries,
  });

  const pendingManual = manual.filter((m) => m.status === "pending");
  const sentManual = manual.filter((m) => m.status === "sent").length;
  const failedManual = manual.filter((m) => m.status === "failed").length;

  return {
    loading,
    refresh,
    manual,
    posVenda,
    botFollowups,
    bulkCampaigns,
    voiceCampaigns,
    dailyReheat,
    pendingMedia,
    voiceRetries,
    reactivationSettings,
    autoReactivateTemplates,
    pendingValidation,
    timeline,
    stats: {
      timelineUpcoming: timeline.length,
      pendingManual: pendingManual.length,
      posVendaUpcoming: posVenda.length,
      botFollowups: botFollowups.length,
      bulkActive: bulkCampaigns.length + voiceCampaigns.length,
      sentManual,
      failedManual,
      posVendaOverdue: posVenda.filter((p) => p.isOverdue).length,
      pendingValidation,
      overdue: timeline.filter((t) => t.status === "overdue").length,
      byChannel: {
        whatsapp: timeline.filter((t) => t.channel === "whatsapp" || t.channel === "mixed").length,
        sms: timeline.filter((t) => t.channel === "sms" || t.channel === "mixed").length,
        voice: timeline.filter((t) => t.channel === "voice" || t.channel === "mixed").length,
      },
      byPizza: {
        A: timeline.filter((t) => t.pizzaGroup === "A").length,
        B: timeline.filter((t) => t.pizzaGroup === "B").length,
        C: timeline.filter((t) => t.pizzaGroup === "C").length,
      },
    },
  };
}

export type UseAgendamentosHubReturn = ReturnType<typeof useAgendamentosHub>;
