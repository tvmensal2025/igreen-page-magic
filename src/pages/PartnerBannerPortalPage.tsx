import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, QrCode } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildBannerNameRows } from "@/components/admin/parceiros/BannerNamesTable";
import { buildPartnerPublicShortLink } from "@/lib/partnerShortLink";
import {
  classifyPartnerCycleLeads,
  type PartnerPortalCycleLeadRaw,
} from "@/lib/partnerPortalCycle";
import { PartnerPortalShell } from "@/components/parceiros-portal/PartnerPortalShell";
import { PartnerPortalHero } from "@/components/parceiros-portal/PartnerPortalHero";
import { PartnerPortalKpis } from "@/components/parceiros-portal/PartnerPortalKpis";
import { PartnerPortalCycleSection } from "@/components/parceiros-portal/PartnerPortalCycleSection";
import { PartnerPortalBanners } from "@/components/parceiros-portal/PartnerPortalBanners";

type SpotRow = {
  id: string;
  code: string;
  keyword: string;
  is_active: boolean;
};

/**
 * Página pública do parceiro — pizzas A/B/C + banners.
 * Rota: /p/:token — RPC SECURITY DEFINER (PII só com token secreto).
 */
export default function PartnerBannerPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [refLabel, setRefLabel] = useState("");
  const [spots, setSpots] = useState<SpotRow[]>([]);
  const [rootScans, setRootScans] = useState(0);
  const [scanByCode, setScanByCode] = useState<Record<string, number>>({});
  const [leadByKw, setLeadByKw] = useState<Record<string, number>>({});
  const [cycleRaw, setCycleRaw] = useState<PartnerPortalCycleLeadRaw[]>([]);

  useEffect(() => {
    const t = String(token || "").trim();
    if (!t) {
      setError("Link inválido");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error: rpcErr } = await (supabase.rpc as any)(
          "get_partner_banner_portal",
          { _token: t },
        );
        if (rpcErr) throw rpcErr;
        const payload = data as {
          ok?: boolean;
          error?: string;
          partner?: { nome?: string; short_code?: string | null };
          ref?: string | null;
          spots?: SpotRow[];
          scans?: Array<{ event_target?: string }>;
          leads?: Array<{ referral_keyword_matched?: string | null }>;
          cycle_leads?: PartnerPortalCycleLeadRaw[];
        } | null;
        if (!payload?.ok) {
          setError(
            payload?.error === "not_found"
              ? "Link expirado ou parceiro inativo"
              : "Link inválido",
          );
          return;
        }
        if (cancelled) return;
        setPartnerName(String(payload.partner?.nome || "Parceiro"));
        setShortCode(String(payload.partner?.short_code || ""));
        setRefLabel(String(payload.ref || ""));
        setSpots(Array.isArray(payload.spots) ? payload.spots : []);
        setCycleRaw(Array.isArray(payload.cycle_leads) ? payload.cycle_leads : []);

        const short = String(payload.partner?.short_code || "");
        let root = 0;
        const byCode: Record<string, number> = {};
        (payload.scans || []).forEach((row) => {
          const target = String(row.event_target || "");
          if (short && target === `partner:${short}`) root += 1;
          else if (short && target.startsWith(`partner:${short}:`)) {
            const code = target.slice(`partner:${short}:`.length);
            byCode[code] = (byCode[code] || 0) + 1;
          }
        });
        setRootScans(root);
        setScanByCode(byCode);

        const leadsMap: Record<string, number> = {};
        (payload.leads || []).forEach((row) => {
          const kw = String(row.referral_keyword_matched || "").trim();
          if (!kw) return;
          leadsMap[kw] = (leadsMap[kw] || 0) + 1;
        });
        setLeadByKw(leadsMap);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao carregar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const prevTitle = document.title;
    const existing = document.querySelector('meta[name="robots"]');
    const prevRobots = existing?.getAttribute("content");
    let createdMeta = false;
    let meta = existing;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      document.head.appendChild(meta);
      createdMeta = true;
    }
    document.title = partnerName
      ? `${partnerName} · Portal Parceiro iGreen`
      : "Portal Parceiro iGreen";
    meta.setAttribute("content", "noindex, nofollow");
    return () => {
      document.title = prevTitle;
      if (createdMeta) {
        meta?.remove();
      } else if (prevRobots != null) {
        meta?.setAttribute("content", prevRobots);
      } else {
        meta?.removeAttribute("content");
      }
    };
  }, [partnerName]);

  const cycleLeads = useMemo(
    () => classifyPartnerCycleLeads(cycleRaw),
    [cycleRaw],
  );

  const countA = cycleLeads.filter((l) => l.group === "A").length;
  const countB = cycleLeads.filter((l) => l.group === "B").length;
  const countC = cycleLeads.filter((l) => l.group === "C").length;

  const totalLeituras =
    rootScans + Object.values(scanByCode).reduce((a, b) => a + b, 0);
  const totalLeads = Object.values(leadByKw).reduce((a, b) => a + b, 0);

  const rows = useMemo(
    () =>
      buildBannerNameRows({
        rootScans,
        spots,
        scanByCode,
        leadByKeyword: leadByKw,
      }).map((r) =>
        r.kind === "geral" ? { ...r, name: `Geral · ${partnerName}` } : r,
      ),
    [rootScans, spots, scanByCode, leadByKw, partnerName],
  );

  const rootUrl =
    refLabel && shortCode
      ? buildPartnerPublicShortLink(refLabel, shortCode)
      : "";

  if (loading) {
    return (
      <PartnerPortalShell>
        <div className="min-h-[70vh] flex items-center justify-center text-emerald-100/60 gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
          Carregando seu portal…
        </div>
      </PartnerPortalShell>
    );
  }

  if (error) {
    return (
      <PartnerPortalShell>
        <div className="min-h-[70vh] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center space-y-3">
            <QrCode className="h-8 w-8 mx-auto text-emerald-400/70" />
            <p className="font-heading font-semibold text-white text-lg">{error}</p>
            <p className="text-sm text-emerald-100/50">
              Peça um novo link ao seu consultor iGreen.
            </p>
          </div>
        </div>
      </PartnerPortalShell>
    );
  }

  return (
    <PartnerPortalShell>
      <PartnerPortalHero partnerName={partnerName} />
      <PartnerPortalKpis
        leituras={totalLeituras}
        leads={totalLeads}
        countA={countA}
        countB={countB}
        countC={countC}
      />
      <PartnerPortalCycleSection leads={cycleLeads} />
      <PartnerPortalBanners rows={rows} />
      {rootUrl && (
        <p className="pb-10 px-4 text-center text-[10px] font-mono text-emerald-100/30 break-all">
          QR vivo · {rootUrl}
        </p>
      )}
    </PartnerPortalShell>
  );
}
