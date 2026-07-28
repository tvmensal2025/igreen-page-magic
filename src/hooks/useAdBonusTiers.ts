import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ENTRADA_BONUS_TETO,
  ENTRADA_FAIXAS_ALTO,
  ENTRADA_FAIXAS_MEDIO,
  type EntradaBonusFaixa,
} from "@/data/entradaBonusTiers";
import {
  OFICIAL_ENTRADA_ALTO,
  OFICIAL_ENTRADA_MEDIO,
} from "@/data/oficialEntradaTabela";

export type BonusTier = "alto" | "medio" | "sem_bonus";

export interface AdBonusDistribuidora {
  ufs: string[];
  label: string;
  nomeApi: string;
}

export interface AdBonusTierRow {
  tier: BonusTier;
  label: string;
  percent: number;
  faixas: EntradaBonusFaixa[];
  distribuidoras: AdBonusDistribuidora[];
}

function defaultDistribuidoras(tier: BonusTier): AdBonusDistribuidora[] {
  const src = tier === "alto" ? OFICIAL_ENTRADA_ALTO : tier === "medio" ? OFICIAL_ENTRADA_MEDIO : [];
  return src.map((d) => ({
    ufs: [...d.ufs],
    label: d.label,
    nomeApi: d.distribuidorasApi[0] || d.label.toUpperCase(),
  }));
}

function defaultFaixas(tier: BonusTier): EntradaBonusFaixa[] {
  if (tier === "alto") return ENTRADA_FAIXAS_ALTO.map((f) => ({ ...f }));
  if (tier === "medio") return ENTRADA_FAIXAS_MEDIO.map((f) => ({ ...f }));
  return [];
}

export const DEFAULT_AD_BONUS_TIERS: Record<BonusTier, AdBonusTierRow> = {
  alto: {
    tier: "alto",
    label: "Bônus alto",
    percent: ENTRADA_BONUS_TETO.alto,
    faixas: defaultFaixas("alto"),
    distribuidoras: defaultDistribuidoras("alto"),
  },
  medio: {
    tier: "medio",
    label: "Bônus médio",
    percent: ENTRADA_BONUS_TETO.medio,
    faixas: defaultFaixas("medio"),
    distribuidoras: defaultDistribuidoras("medio"),
  },
  sem_bonus: {
    tier: "sem_bonus",
    label: "Sem bônus",
    percent: ENTRADA_BONUS_TETO.sem_bonus,
    faixas: [],
    distribuidoras: [],
  },
};

function normalizeFaixa(raw: unknown): EntradaBonusFaixa | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const minPessoas = Number(r.minPessoas);
  const totalPct = Number(r.totalPct ?? 0);
  const imediatoPct = Number(r.imediatoPct ?? 0);
  const injecaoPct = Number(r.injecaoPct ?? 0);
  if (!Number.isFinite(minPessoas)) return null;
  const maxRaw = r.maxPessoas;
  const maxPessoas =
    maxRaw === null || maxRaw === undefined || maxRaw === ""
      ? null
      : Number(maxRaw);
  return {
    minPessoas,
    maxPessoas: maxPessoas != null && Number.isFinite(maxPessoas) ? maxPessoas : null,
    totalPct,
    imediatoPct,
    injecaoPct,
    label:
      typeof r.label === "string" && r.label.trim()
        ? r.label
        : `${minPessoas}${maxPessoas != null ? `–${maxPessoas}` : "+"} · ${totalPct}%`,
  };
}

function normalizeDist(raw: unknown): AdBonusDistribuidora | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const label = String(r.label || "").trim();
  const nomeApi = String(r.nomeApi || label).trim().toUpperCase();
  const ufs = Array.isArray(r.ufs)
    ? r.ufs.map((u) => String(u).trim().toUpperCase()).filter(Boolean)
    : [];
  if (!label && !nomeApi) return null;
  return { ufs, label: label || nomeApi, nomeApi };
}

let cache: Record<BonusTier, AdBonusTierRow> | null = null;
let inflight: Promise<Record<BonusTier, AdBonusTierRow>> | null = null;

export async function fetchAdBonusTiers(): Promise<Record<BonusTier, AdBonusTierRow>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const { data } = await (supabase as any)
      .from("ad_bonus_tiers")
      .select("tier,label,percent,faixas,distribuidoras");
    const merged: Record<BonusTier, AdBonusTierRow> = {
      alto: { ...DEFAULT_AD_BONUS_TIERS.alto, faixas: [...DEFAULT_AD_BONUS_TIERS.alto.faixas], distribuidoras: [...DEFAULT_AD_BONUS_TIERS.alto.distribuidoras] },
      medio: { ...DEFAULT_AD_BONUS_TIERS.medio, faixas: [...DEFAULT_AD_BONUS_TIERS.medio.faixas], distribuidoras: [...DEFAULT_AD_BONUS_TIERS.medio.distribuidoras] },
      sem_bonus: { ...DEFAULT_AD_BONUS_TIERS.sem_bonus, faixas: [], distribuidoras: [] },
    };
    for (const row of data || []) {
      const tier = row.tier as BonusTier;
      if (!(tier in merged)) continue;
      const faixas = Array.isArray(row.faixas)
        ? (row.faixas.map(normalizeFaixa).filter(Boolean) as EntradaBonusFaixa[])
        : merged[tier].faixas;
      const distribuidoras = Array.isArray(row.distribuidoras)
        ? (row.distribuidoras.map(normalizeDist).filter(Boolean) as AdBonusDistribuidora[])
        : merged[tier].distribuidoras;
      merged[tier] = {
        tier,
        label: row.label || merged[tier].label,
        percent: Number(row.percent ?? merged[tier].percent),
        faixas,
        distribuidoras,
      };
    }
    cache = merged;
    inflight = null;
    return merged;
  })();
  return inflight;
}

export function invalidateBonusTiers() {
  cache = null;
  inflight = null;
}

/** Compat Ads: só tier/label/percent. */
export type AdBonusTier = Pick<AdBonusTierRow, "tier" | "label" | "percent">;

export function useAdBonusTiers() {
  const [tiers, setTiers] = useState<Record<BonusTier, AdBonusTierRow>>(cache || DEFAULT_AD_BONUS_TIERS);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let active = true;
    fetchAdBonusTiers().then((t) => {
      if (active) {
        setTiers(t);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return { tiers, loading };
}
