import { useEffect, useMemo, useState } from "react";
import { Loader2, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  BannerNamesTable,
  type BannerNameRow,
} from "./BannerNamesTable";
import type { BannerSpot } from "./ConsultantBannerDownloadModal";
import type { ReferralPartner } from "./hooks/useReferralPartners";

interface Props {
  consultantId: string;
  mySpots: BannerSpot[];
  partners: ReferralPartner[];
}

type Period = 7 | 30 | 90 | "all";

const PERIOD_OPTS: { value: Period; label: string }[] = [
  { value: 7, label: "7 dias" },
  { value: 30, label: "30 dias" },
  { value: 90, label: "90 dias" },
  { value: "all", label: "Todo período" },
];

/**
 * Ranking unificado: seus banners + banners dos parceiros.
 */
export function BannersRanking({ consultantId, mySpots, partners }: Props) {
  const [period, setPeriod] = useState<Period>(30);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<BannerNameRow[]>([]);

  useEffect(() => {
    if (!consultantId) return;
    let cancelled = false;
    setLoading(true);

    const sinceIso =
      period === "all"
        ? null
        : (() => {
            const d = new Date();
            d.setDate(d.getDate() - period);
            return d.toISOString();
          })();

    (async () => {
      try {
        let evQ = supabase
          .from("page_events")
          .select("event_target, created_at")
          .eq("consultant_id", consultantId)
          .eq("event_type", "qr_scan");
        if (sinceIso) evQ = evQ.gte("created_at", sinceIso);

        let leadQ = supabase
          .from("customers")
          .select(
            "referral_keyword_matched, referral_partner_id, created_at",
          )
          .eq("consultant_id", consultantId)
          .not("referral_keyword_matched", "is", null);
        if (sinceIso) leadQ = leadQ.gte("created_at", sinceIso);

        const [{ data: partnerSpots }, { data: events }, { data: leads }] =
          await Promise.all([
            supabase
              .from("referral_partner_banner_spots" as never)
              .select("id, partner_id, code, keyword, is_active")
              .eq("consultant_id", consultantId),
            evQ,
            leadQ,
          ]);

        if (cancelled) return;

        const partnerById = new Map(partners.map((p) => [p.id, p]));
        const shortToPartner = new Map(
          partners
            .filter((p) => p.short_code)
            .map((p) => [String(p.short_code), p]),
        );

        const scanRootMine = { n: 0 };
        const scanMySpot: Record<string, number> = {};
        const scanPartnerRoot: Record<string, number> = {};
        const scanPartnerSpot: Record<string, number> = {};

        (events || []).forEach((row) => {
          const t = String(row.event_target || "").trim();
          if (!t) return;
          if (t === "banner_root" || t === "panfleto") {
            scanRootMine.n += 1;
            return;
          }
          if (t.startsWith("banner_spot:")) {
            const code = t.slice("banner_spot:".length);
            scanMySpot[code] = (scanMySpot[code] || 0) + 1;
            return;
          }
          if (t.startsWith("partner:")) {
            const rest = t.slice("partner:".length);
            const [short, spotCode] = rest.split(":");
            if (spotCode) {
              const key = `${short}:${spotCode}`;
              scanPartnerSpot[key] = (scanPartnerSpot[key] || 0) + 1;
            } else if (short) {
              scanPartnerRoot[short] =
                (scanPartnerRoot[short] || 0) + 1;
            }
          }
        });

        const leadMine: Record<string, number> = {};
        const leadPartner: Record<string, number> = {};
        (leads || []).forEach((row) => {
          const kw = String(row.referral_keyword_matched || "").trim();
          if (!kw) return;
          const pid = row.referral_partner_id
            ? String(row.referral_partner_id)
            : "";
          if (pid) {
            const key = `${pid}::${kw}`;
            leadPartner[key] = (leadPartner[key] || 0) + 1;
          } else {
            leadMine[kw] = (leadMine[kw] || 0) + 1;
          }
        });

        const out: BannerNameRow[] = [
          {
            key: "mine-root",
            name: "Banner Geral (você)",
            leituras: scanRootMine.n,
            leads: 0,
            kind: "geral",
          },
        ];

        for (const s of mySpots) {
          out.push({
            key: `mine-${s.id}`,
            name: `${s.keyword} (você)`,
            code: s.code,
            leituras: scanMySpot[s.code] || 0,
            leads: leadMine[s.keyword] || 0,
            kind: s.is_active === false ? "arquivado" : "local",
          });
        }

        for (const p of partners) {
          const short = String(p.short_code || "");
          out.push({
            key: `p-root-${p.id}`,
            name: `Geral · ${p.nome}`,
            leituras: short ? scanPartnerRoot[short] || 0 : 0,
            leads: 0,
            kind: "geral",
          });
        }

        for (const s of (partnerSpots as Array<{
          id: string;
          partner_id: string;
          code: string;
          keyword: string;
          is_active: boolean;
        }> | null) || []) {
          const p = partnerById.get(s.partner_id);
          const short = String(p?.short_code || "");
          const scanKey = short ? `${short}:${s.code}` : "";
          out.push({
            key: `p-spot-${s.id}`,
            name: `${s.keyword} · ${p?.nome || "parceiro"}`,
            code: s.code,
            leituras: scanKey ? scanPartnerSpot[scanKey] || 0 : 0,
            leads: leadPartner[`${s.partner_id}::${s.keyword}`] || 0,
            kind: s.is_active === false ? "arquivado" : "local",
          });
        }

        // leads de keyword sem spot (histórico)
        for (const [kw, n] of Object.entries(leadMine)) {
          if (mySpots.some((s) => s.keyword === kw)) continue;
          out.push({
            key: `orphan-mine-${kw}`,
            name: `${kw} (você)`,
            leituras: 0,
            leads: n,
            kind: "local",
          });
        }

        out.sort((a, b) => {
          const score = b.leituras + b.leads * 2 - (a.leituras + a.leads * 2);
          if (score !== 0) return score;
          return a.name.localeCompare(b.name, "pt-BR");
        });

        // silencia unused
        void shortToPartner;

        setRows(out);
      } catch (e) {
        console.warn("[banners-ranking]", e);
        setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [consultantId, period, mySpots, partners]);

  const periodLabel =
    period === "all"
      ? "todo o período"
      : `${period} dias`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-heading font-bold text-foreground flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" />
          Ranking unificado
        </h3>
        <div className="flex gap-1 bg-muted/50 rounded-lg p-1 flex-wrap">
          {PERIOD_OPTS.map((p) => (
            <button
              key={String(p.value)}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                period === p.value
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">
        Seus banners e dos parceiros no mesmo ranking ({periodLabel}). Ordenado
        por leituras + leads.
      </p>
      {loading ? (
        <div className="h-40 flex items-center justify-center text-muted-foreground gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Montando ranking…
        </div>
      ) : (
        <BannerNamesTable
          rows={rows}
          title="Nome | leituras | leads (todos)"
          emptyHint="Ainda sem leituras neste período."
        />
      )}
    </div>
  );
}
