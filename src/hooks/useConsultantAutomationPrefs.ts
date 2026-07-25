import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CONSULTANT_AUTO_PACKS,
  DEFAULT_CONSULTANT_AUTOMATION_PREFS,
  anyPackOff,
  needsAutomationPrefsAck,
  type ConsultantAutomationPrefs,
} from "@/lib/consultantAutomationPrefs";

export type PrefsDraft = Omit<ConsultantAutomationPrefs, "consultant_id" | "acked_at">;

function toDraft(prefs: ConsultantAutomationPrefs | null): PrefsDraft {
  return {
    group_a_enabled: prefs?.group_a_enabled ?? false,
    group_b_enabled: prefs?.group_b_enabled ?? false,
    group_c_enabled: prefs?.group_c_enabled ?? false,
    pos_venda_auto_enabled: prefs?.pos_venda_auto_enabled ?? false,
    reminders_auto_enabled: prefs?.reminders_auto_enabled ?? false,
  };
}

export function useConsultantAutomationPrefs(consultantId: string | null | undefined) {
  const [prefs, setPrefs] = useState<ConsultantAutomationPrefs | null>(null);
  const [draft, setDraft] = useState<PrefsDraft>(toDraft(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!consultantId) {
      setPrefs(null);
      setDraft(toDraft(null));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("consultant_automation_prefs")
      .select(
        "consultant_id, group_a_enabled, group_b_enabled, group_c_enabled, pos_venda_auto_enabled, reminders_auto_enabled, acked_at",
      )
      .eq("consultant_id", consultantId)
      .maybeSingle();

    if (err) {
      setError(err.message);
      setPrefs(null);
      setDraft(toDraft(null));
      setLoading(false);
      return;
    }

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

    setPrefs(row);
    setDraft(toDraft(row));
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

      const payload = {
        consultant_id: consultantId,
        ...body,
        acked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: consultantId,
      };

      const { data, error: err } = await supabase
        .from("consultant_automation_prefs")
        .upsert(payload, { onConflict: "consultant_id" })
        .select(
          "consultant_id, group_a_enabled, group_b_enabled, group_c_enabled, pos_venda_auto_enabled, reminders_auto_enabled, acked_at",
        )
        .maybeSingle();

      setSaving(false);
      if (err) {
        setError(err.message);
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
      return true;
    },
    [consultantId, draft],
  );

  return {
    prefs,
    draft,
    setPack,
    loading,
    saving,
    error,
    reload,
    save,
    packs: CONSULTANT_AUTO_PACKS,
    needsAck: needsAutomationPrefsAck(prefs),
    hasOff: anyPackOff(prefs),
  };
}
