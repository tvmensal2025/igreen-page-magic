import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isIgreenWalletOrigin } from "@/lib/customerOrigin";
import { LEAD_ORIGIN_FILTER } from "@/lib/leadOrigin";
import {
  buildUpcomingPosVendaMessages,
  groupSentStageKeys,
  type UpcomingPosVendaItem,
} from "@/lib/posVendaSchedule";
import type { PosVendaStage } from "@/lib/posVenda/format";
import {
  buildAgendamentosTimeline,
  DEFAULT_REACTIVATION_SETTINGS,
  type AgendamentoTimelineItem,
  type BotFollowupRow,
  type BulkCampaignRow,
  type ReactivationSettingsSummary,
  type ScheduledMessageRow,
} from "@/lib/agendamentosHub";

export function useAgendamentosHub(consultantId: string) {
  const [loading, setLoading] = useState(true);
  const [manual, setManual] = useState<ScheduledMessageRow[]>([]);
  const [posVenda, setPosVenda] = useState<UpcomingPosVendaItem[]>([]);
  const [botFollowups, setBotFollowups] = useState<BotFollowupRow[]>([]);
  const [bulkCampaigns, setBulkCampaigns] = useState<BulkCampaignRow[]>([]);
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
        settingsRes,
        templatesRes,
      ] = await Promise.all([
        supabase
          .from("scheduled_messages")
          .select("id, remote_jid, message_text, scheduled_at, status, sent_at")
          .eq("consultant_id", consultantId)
          .order("scheduled_at", { ascending: true }),
        supabase
          .from("customers")
          .select("id, name, phone_whatsapp, pos_venda_stage, pos_venda_approved_at, customer_origin")
          .or(`consultant_id.eq.${consultantId},assigned_consultant_id.eq.${consultantId}`)
          .in("pos_venda_stage", ["aprovado", "reprovado", "d30", "d60", "d90", "d120"]),
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
          .in("status", ["scheduled", "running"])
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
          })),
          groupSentStageKeys((logRes.data || []) as Array<{ customer_id: string; stage_key: string }>),
          previews,
        ),
      );

      setBotFollowups((followupRes.data || []) as BotFollowupRow[]);
      setBulkCampaigns((bulkRes.data || []) as BulkCampaignRow[]);

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
    reactivationSettings,
    autoReactivateTemplates,
    timeline,
    stats: {
      timelineUpcoming: timeline.length,
      pendingManual: pendingManual.length,
      posVendaUpcoming: posVenda.length,
      botFollowups: botFollowups.length,
      bulkActive: bulkCampaigns.length,
      sentManual,
      failedManual,
      posVendaOverdue: posVenda.filter((p) => p.isOverdue).length,
    },
  };
}

export type UseAgendamentosHubReturn = ReturnType<typeof useAgendamentosHub>;
