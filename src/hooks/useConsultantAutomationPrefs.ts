import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CEREBRO_OPT_IN,
  CONSULTANT_AUTO_PACKS,
  DEFAULT_CONSULTANT_AUTOMATION_PREFS,
  SUGGESTED_FIRST_ACK_PREFS,
  anyPackOff,
  needsAutomationPrefsAck,
  type ConsultantAutomationPrefs,
} from "@/lib/consultantAutomationPrefs";

export type PrefsDraft = Omit<ConsultantAutomationPrefs, "consultant_id" | "acked_at">;

function toDraft(prefs: ConsultantAutomationPrefs | null): PrefsDraft {
  // Sem row → espelha o motor (tudo OFF). Modal de 1º ack usa suggestedOnFirstAck.
  const src = prefs ?? { consultant_id: "", ...DEFAULT_CONSULTANT_AUTOMATION_PREFS };
  return {
    group_a_enabled: !!src.group_a_enabled,
    group_b_enabled: !!src.group_b_enabled,
    group_c_enabled: !!src.group_c_enabled,
    pos_venda_auto_enabled: !!src.pos_venda_auto_enabled,
    reminders_auto_enabled: !!src.reminders_auto_enabled,
  };
}

function toSuggestedDraft(): PrefsDraft {
  const src = SUGGESTED_FIRST_ACK_PREFS;
  return {
    group_a_enabled: !!src.group_a_enabled,
    group_b_enabled: !!src.group_b_enabled,
    group_c_enabled: !!src.group_c_enabled,
    pos_venda_auto_enabled: !!src.pos_venda_auto_enabled,
    reminders_auto_enabled: !!src.reminders_auto_enabled,
  };
}

export function useConsultantAutomationPrefs(consultantId: string | null | undefined) {
  const [prefs, setPrefs] = useState<ConsultantAutomationPrefs | null>(null);
  const [draft, setDraft] = useState<PrefsDraft>(toDraft(null));
  const [cerebroEnabled, setCerebroEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!consultantId) {
      setPrefs(null);
      setDraft(toDraft(null));
      setCerebroEnabled(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const [prefsRes, consRes] = await Promise.all([
      supabase
        .from("consultant_automation_prefs")
        .select(
          "consultant_id, group_a_enabled, group_b_enabled, group_c_enabled, pos_venda_auto_enabled, reminders_auto_enabled, acked_at",
        )
        .eq("consultant_id", consultantId)
        .maybeSingle(),
      supabase.from("consultants").select("cerebro_ativo").eq("id", consultantId).maybeSingle(),
    ]);

    if (prefsRes.error) {
      setError(prefsRes.error.message);
      setPrefs(null);
      setDraft(toDraft(null));
      setCerebroEnabled(false);
      setLoading(false);
      return;
    }

    const data = prefsRes.data;
    const row = data
      ? ({
          consultant_id: consultantId,
          group_a_enabled: !!(data as ConsultantAutomationPrefs).group_a_enabled,
          group_b_enabled: !!(data as ConsultantAutomationPrefs).group_b_enabled,
          group_c_enabled: !!(data as ConsultantAutomationPrefs).group_c_enabled,
          pos_venda_auto_enabled: !!(data as ConsultantAutomationPrefs).pos_venda_auto_enabled,
          reminders_auto_enabled: !!(data as ConsultantAutomationPrefs).reminders_auto_enabled,
          acked_at: (data as ConsultantAutomationPrefs).acked_at ?? null,
        } satisfies ConsultantAutomationPrefs)
      : {
          consultant_id: consultantId,
          ...DEFAULT_CONSULTANT_AUTOMATION_PREFS,
        };

    const needsFirstAck = !data || !row.acked_at;
    const cerebroDbOn = String((consRes.data as { cerebro_ativo?: string } | null)?.cerebro_ativo || "") === "on";
    // 1º ack: sugere OFF (opt-in). Depois: espelha o banco.
    setCerebroEnabled(needsFirstAck ? CEREBRO_OPT_IN.suggestedOnFirstAck : cerebroDbOn);

    setPrefs(row);
    setDraft(needsFirstAck ? toSuggestedDraft() : toDraft(row));
    setLoading(false);
  }, [consultantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setPack = useCallback((field: keyof PrefsDraft, value: boolean) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  const save = useCallback(
    async (opts?: { leaveAllOff?: boolean; draftOverride?: PrefsDraft }) => {
      if (!consultantId) return false;
      setSaving(true);
      setError(null);
      const body = opts?.leaveAllOff
        ? {
            group_a_enabled: false,
            group_b_enabled: false,
            group_c_enabled: false,
            pos_venda_auto_enabled: false,
            reminders_auto_enabled: false,
          }
        : (opts?.draftOverride ?? draft);

      const nextCerebro = opts?.leaveAllOff ? false : cerebroEnabled;

      const payload = {
        consultant_id: consultantId,
        ...body,
        acked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: consultantId,
      };

      const [{ data, error: err }, consUpd] = await Promise.all([
        supabase
          .from("consultant_automation_prefs")
          .upsert(payload, { onConflict: "consultant_id" })
          .select(
            "consultant_id, group_a_enabled, group_b_enabled, group_c_enabled, pos_venda_auto_enabled, reminders_auto_enabled, acked_at",
          )
          .maybeSingle(),
        supabase
          .from("consultants")
          .update({ cerebro_ativo: nextCerebro ? "on" : "off" })
          .eq("id", consultantId),
      ]);

      setSaving(false);
      if (err) {
        setError(err.message);
        return false;
      }
      if (consUpd.error) {
        setError(consUpd.error.message);
        return false;
      }

      const row = {
        consultant_id: consultantId,
        group_a_enabled: !!(data as ConsultantAutomationPrefs)?.group_a_enabled,
        group_b_enabled: !!(data as ConsultantAutomationPrefs)?.group_b_enabled,
        group_c_enabled: !!(data as ConsultantAutomationPrefs)?.group_c_enabled,
        pos_venda_auto_enabled: !!(data as ConsultantAutomationPrefs)?.pos_venda_auto_enabled,
        reminders_auto_enabled: !!(data as ConsultantAutomationPrefs)?.reminders_auto_enabled,
        acked_at: (data as ConsultantAutomationPrefs)?.acked_at ?? payload.acked_at,
      } satisfies ConsultantAutomationPrefs;

      setPrefs(row);
      setDraft(toDraft(row));
      setCerebroEnabled(nextCerebro);
      return true;
    },
    [consultantId, draft, cerebroEnabled],
  );

  return {
    prefs,
    draft,
    setPack,
    cerebroEnabled,
    setCerebroEnabled,
    loading,
    saving,
    error,
    reload,
    save,
    packs: CONSULTANT_AUTO_PACKS,
    needsAck: needsAutomationPrefsAck(prefs),
    hasOff: anyPackOff(prefs) || !cerebroEnabled,
  };
}
