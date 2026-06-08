import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type BonusTier = "alto" | "medio" | "sem_bonus";

export interface AdBonusTier {
  tier: BonusTier;
  label: string;
  percent: number;
}

const DEFAULTS: Record<BonusTier, AdBonusTier> = {
  alto: { tier: "alto", label: "Bônus alto", percent: 60 },
  medio: { tier: "medio", label: "Bônus médio", percent: 30 },
  sem_bonus: { tier: "sem_bonus", label: "Sem bônus", percent: 0 },
};

let cache: Record<BonusTier, AdBonusTier> | null = null;
let inflight: Promise<Record<BonusTier, AdBonusTier>> | null = null;

async function fetchTiers(): Promise<Record<BonusTier, AdBonusTier>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const { data } = await (supabase as any)
      .from("ad_bonus_tiers")
      .select("tier,label,percent");
    const merged: Record<BonusTier, AdBonusTier> = { ...DEFAULTS };
    (data || []).forEach((r: any) => {
      if (r.tier in merged) merged[r.tier as BonusTier] = { tier: r.tier, label: r.label, percent: r.percent };
    });
    cache = merged;
    inflight = null;
    return merged;
  })();
  return inflight;
}

export function invalidateBonusTiers() {
  cache = null;
}

export function useAdBonusTiers() {
  const [tiers, setTiers] = useState<Record<BonusTier, AdBonusTier>>(cache || DEFAULTS);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let active = true;
    fetchTiers().then((t) => {
      if (active) {
        setTiers(t);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, []);

  return { tiers, loading };
}
