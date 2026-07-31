import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CEREBRO_OPT_IN,
  CONSULTANT_AUTO_PACKS,
  DEFAULT_CONSULTANT_AUTOMATION_PREFS,
  SUGGESTED_FIRST_ACK_PREFS,
  anyPackOff,
  needsAutomationPrefsAck,
  resolveCerebroOptInCopy,
  type CerebroOptInCopy,
  type ConsultantAutomationPrefs,
} from "@/lib/consultantAutomationPrefs";
import { firstNameFromPublicConsultant } from "@/lib/consultantPublicLabel";

export type PrefsDraft = Omit<ConsultantAutomationPrefs, "consultant_id" | "acked_at">;

const PREFS_SELECT =
  "consultant_id, group_a_enabled, group_b_enabled, group_c_enabled, pos_venda_auto_enabled, pos_venda_auto_validate, reminders_auto_enabled, acked_at";

function toDraft(prefs: ConsultantAutomationPrefs | null): PrefsDraft {
  const src = prefs ?? { consultant_id: "", ...DEFAULT_CONSULTANT_AUTOMATION_PREFS };
  return {
    group_a_enabled: !!src.group_a_enabled,
    group_b_enabled: !!src.group_b_enabled,
    group_c_enabled: !!src.group_c_enabled,
    pos_venda_auto_enabled: !!src.pos_venda_auto_enabled,
    pos_venda_auto_validate: !!src.pos_venda_auto_validate,
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
    pos_venda_auto_validate: !!src.pos_venda_auto_validate,
    reminders_auto_enabled: !!src.reminders_auto_enabled,
  };
}

function rowFromData(
  consultantId: string,
  data: Partial<ConsultantAutomationPrefs> | null | undefined,
): ConsultantAutomationPrefs {
  return {
    consultant_id: consultantId,
    group_a_enabled: !!data?.group_a_enabled,
    group_b_enabled: !!data?.group_b_enabled,
    group_c_enabled: !!data?.group_c_enabled,
    pos_venda_auto_enabled: !!data?.pos_venda_auto_enabled,
    pos_venda_auto_validate: !!data?.pos_venda_auto_validate,
    reminders_auto_enabled: !!data?.reminders_auto_enabled,
    acked_at: data?.acked_at ?? null,
  };
}

export function useConsultantAutomationPrefs(consultantId: string | null | undefined) {
  const [prefs, setPrefs] = useState<ConsultantAutomationPrefs | null>(null);
  const [draft, setDraft] = useState<PrefsDraft>(toDraft(null));
  const [cerebroEnabled, setCerebroEnabled] = useState(false);
  const [cerebroCopy, setCerebroCopy] = useState<CerebroOptInCopy>(() => resolveCerebroOptInCopy());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!consultantId) {
      setPrefs(null);
      setDraft(toDraft(null));
      setCerebroEnabled(false);
      setCerebroCopy(resolveCerebroOptInCopy());
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const [prefsRes, consRes] = await Promise.all([
      supabase
        .from("consultant_automation_prefs")
        .select(PREFS_SELECT)
        .eq("consultant_id", consultantId)
        .maybeSingle(),
      supabase
        .from("consultants")
        .select("cerebro_ativo, name, display_name, assistant_name")
        .eq("id", consultantId)
        .maybeSingle(),
    ]);

    if (prefsRes.error) {
      setError(prefsRes.error.message);
      setPrefs(null);
      setDraft(toDraft(null));
      setCerebroEnabled(false);
      setCerebroCopy(resolveCerebroOptInCopy());
      setLoading(false);
      return;
    }

    const data = prefsRes.data;
    const row = data
      ? rowFromData(consultantId, data as ConsultantAutomationPrefs)
      : { consultant_id: consultantId, ...DEFAULT_CONSULTANT_AUTOMATION_PREFS };

    const cons = consRes.data as {
      cerebro_ativo?: string;
      name?: string | null;
      display_name?: string | null;
      assistant_name?: string | null;
    } | null;
    const needsFirstAck = !data || !row.acked_at;
    const cerebroDbOn = String(cons?.cerebro_ativo || "") === "on";
    setCerebroEnabled(needsFirstAck ? CEREBRO_OPT_IN.suggestedOnFirstAck : cerebroDbOn);
    setCerebroCopy(
      resolveCerebroOptInCopy({
        assistantName: cons?.assistant_name,
        consultantFirstName: firstNameFromPublicConsultant(cons?.name, cons?.display_name),
      }),
    );

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
            pos_venda_auto_validate: false,
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
          .select(PREFS_SELECT)
          .maybeSingle(),
        supabase
          .from("consultants")
          .update({ cerebro_ativo: nextCerebro ? "on" : "off" })
          .eq("id", consultantId),
      ]);

      setSaving(false);
      // As duas gravações vão em paralelo (tabelas diferentes). Se uma falhar,
      // a outra já foi gravada: recarrega do banco para a tela mostrar o estado
      // real, em vez de ficar exibindo o que o consultor tentou salvar.
      if (err || consUpd.error) {
        setError((err ?? consUpd.error)!.message);
        void reload();
        return false;
      }


      const row = rowFromData(consultantId, {
        ...(data as ConsultantAutomationPrefs),
        acked_at: (data as ConsultantAutomationPrefs)?.acked_at ?? payload.acked_at,
      });

      setPrefs(row);
      setDraft(toDraft(row));
      setCerebroEnabled(nextCerebro);
      return true;
    },
    [consultantId, draft, cerebroEnabled],
  );

  /** Liga/desliga só o toggle de validar sozinho (sem mexer no resto do draft). */
  const setPosVendaAutoValidate = useCallback(
    async (enabled: boolean) => {
      if (!consultantId) return { ok: false as const, error: "sem consultor" };
      setSaving(true);
      setError(null);

      // Update PARCIAL: só a coluna do toggle. O upsert de linha inteira usava
      // o `prefs` em memória — e como este hook é montado em dois lugares
      // (PosVendaKanban e PendingApprovalDialog), a cópia velha de um deles
      // reescrevia por cima do que o outro acabou de salvar. Pior: se o load
      // tivesse falhado (prefs = null), gravava os DEFAULTS por cima de tudo.
      let { data, error: err } = await supabase
        .from("consultant_automation_prefs")
        .update({
          pos_venda_auto_validate: enabled,
          updated_at: new Date().toISOString(),
          updated_by: consultantId,
        })
        .eq("consultant_id", consultantId)
        .select(PREFS_SELECT)
        .maybeSingle();

      // Sem linha ainda (primeiro toggle antes do modal de automações): cria.
      if (!err && !data) {
        const base = prefs ?? { consultant_id: consultantId, ...DEFAULT_CONSULTANT_AUTOMATION_PREFS };
        ({ data, error: err } = await supabase
          .from("consultant_automation_prefs")
          .upsert(
            {
              consultant_id: consultantId,
              group_a_enabled: !!base.group_a_enabled,
              group_b_enabled: !!base.group_b_enabled,
              group_c_enabled: !!base.group_c_enabled,
              pos_venda_auto_enabled: !!base.pos_venda_auto_enabled,
              pos_venda_auto_validate: enabled,
              reminders_auto_enabled: !!base.reminders_auto_enabled,
              acked_at: base.acked_at ?? new Date().toISOString(),
              updated_at: new Date().toISOString(),
              updated_by: consultantId,
            },
            { onConflict: "consultant_id" },
          )
          .select(PREFS_SELECT)
          .maybeSingle());
      }


      if (err) {
        setSaving(false);
        setError(err.message);
        return { ok: false as const, error: err.message };
      }

      const row = rowFromData(consultantId, data as ConsultantAutomationPrefs);
      setPrefs(row);
      setDraft(toDraft(row));

      let autoResult: { approved?: number; rejected?: number } | null = null;
      if (enabled) {
        const { data: rpcData, error: rpcErr } = await supabase.rpc(
          "auto_confirm_pending_pos_venda" as any,
          { _consultant_id: consultantId },
        );
        if (!rpcErr && rpcData && typeof rpcData === "object") {
          autoResult = rpcData as { approved?: number; rejected?: number };
        }
      }

      setSaving(false);
      return { ok: true as const, autoResult };
    },
    [consultantId, prefs],
  );

  return {
    prefs,
    draft,
    setPack,
    cerebroEnabled,
    setCerebroEnabled,
    cerebroCopy,
    loading,
    saving,
    error,
    reload,
    save,
    setPosVendaAutoValidate,
    packs: CONSULTANT_AUTO_PACKS,
    needsAck: needsAutomationPrefsAck(prefs),
    hasOff: anyPackOff(prefs) || !cerebroEnabled,
  };
}
