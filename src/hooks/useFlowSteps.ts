import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { CustomStepMap, FlowStepInfo } from "@/lib/flowStepResolver";
import { LEGACY_STEP_ORDER, LEGACY_STEP_LABELS } from "@/lib/flowStepResolver";

interface FlowStepRow {
  id: string;
  flow_id: string;
  position: number;
  title: string | null;
  step_key: string | null;
}

export interface FlowStepOption {
  key: string;            // value used by the resolver to match
  label: string;          // "1. Boas-vindas"
  number: number;
  total: number;
  kind: FlowStepInfo["kind"];
}

export function useFlowSteps(consultantId: string | null | undefined) {
  const [steps, setSteps] = useState<FlowStepRow[]>([]);

  useEffect(() => {
    if (!consultantId) { setSteps([]); return; }
    let mounted = true;
    (async () => {
      const { data: flows } = await supabase
        .from("bot_flows")
        .select("id, variant, sync_mode")
        .eq("consultant_id", consultantId)
        .eq("is_active", true);
      if (!flows || flows.length === 0) { if (mounted) setSteps([]); return; }

      // Espelha a lógica do FluxoBuilder/resolve-flow: quando sync_mode='public',
      // os steps reais vivem no flow público da mesma variant.
      const resolvedIds: string[] = [];
      for (const f of flows as any[]) {
        const mode = String(f.sync_mode ?? "public").toLowerCase();
        if (mode === "public") {
          const { data: pub } = await supabase
            .from("bot_flows").select("id")
            .eq("is_public", true).eq("is_active", true).eq("variant", f.variant)
            .limit(1).maybeSingle();
          resolvedIds.push((pub as any)?.id ?? f.id);
        } else {
          resolvedIds.push(f.id);
        }
      }
      const flowIds = Array.from(new Set(resolvedIds));
      const { data } = await supabase
        .from("bot_flow_steps")
        .select("id, flow_id, position, title, step_key")
        .in("flow_id", flowIds)
        .order("position", { ascending: true });
      if (mounted) setSteps((data as FlowStepRow[]) || []);
    })();
    return () => { mounted = false; };
  }, [consultantId]);


  const customStepMap = useMemo<CustomStepMap>(() => {
    const map: CustomStepMap = new Map();
    if (steps.length === 0) return map;
    // total per flow
    const totals = new Map<string, number>();
    for (const s of steps) totals.set(s.flow_id, (totals.get(s.flow_id) || 0) + 1);
    for (const s of steps) {
      const entry = {
        position: s.position,
        total: totals.get(s.flow_id) || steps.length,
        title: s.title || s.step_key || `Passo ${s.position + 1}`,
      };
      map.set(s.id, entry);
      if (s.step_key) map.set(s.step_key, entry);
    }
    return map;
  }, [steps]);

  // Options for the filter dropdown: prefer custom-flow steps; fall back to legacy
  const stepOptions = useMemo<FlowStepOption[]>(() => {
    if (steps.length > 0) {
      // Group by flow_id, use the largest flow as primary (consultor usually 1 ativo)
      const byFlow = new Map<string, FlowStepRow[]>();
      for (const s of steps) {
        const arr = byFlow.get(s.flow_id) || [];
        arr.push(s);
        byFlow.set(s.flow_id, arr);
      }
      const primary = [...byFlow.values()].sort((a, b) => b.length - a.length)[0];
      return primary.map((s) => ({
        key: s.id,
        label: `${s.position + 1}. ${s.title || s.step_key || "Passo"}`,
        number: s.position + 1,
        total: primary.length,
        kind: "custom" as const,
      }));
    }
    return LEGACY_STEP_ORDER.map((k, i) => ({
      key: k,
      label: `${i + 1}. ${LEGACY_STEP_LABELS[k] || k}`,
      number: i + 1,
      total: LEGACY_STEP_ORDER.length,
      kind: "legacy" as const,
    }));
  }, [steps]);

  return { customStepMap, stepOptions };
}
