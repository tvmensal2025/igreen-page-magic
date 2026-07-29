import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, QrCode } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  BannerNamesTable,
  buildBannerNameRows,
} from "@/components/admin/parceiros/BannerNamesTable";
import { buildPartnerPublicShortLink } from "@/lib/partnerShortLink";
import { Card, CardContent } from "@/components/ui/card";

type SpotRow = {
  id: string;
  code: string;
  keyword: string;
  is_active: boolean;
};

/**
 * Página pública do parceiro — só os banners dele (token opaco).
 * Rota: /p/:token — dados via RPC SECURITY DEFINER (sem PII).
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

  const rows = useMemo(
    () =>
      buildBannerNameRows({
        rootScans,
        spots,
        scanByCode,
        leadByKeyword: leadByKw,
      }).map((r) =>
        r.kind === "geral"
          ? { ...r, name: `Geral · ${partnerName}` }
          : r,
      ),
    [rootScans, spots, scanByCode, leadByKw, partnerName],
  );

  const rootUrl =
    refLabel && shortCode
      ? buildPartnerPublicShortLink(refLabel, shortCode)
      : "";

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        Carregando seus banners…
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center space-y-2">
            <QrCode className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="font-semibold">{error}</p>
            <p className="text-sm text-muted-foreground">
              Peça um novo link ao seu consultor iGreen.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-heading font-bold flex items-center gap-2">
            <QrCode className="h-5 w-5 text-primary" />
            Banners de {partnerName}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Só os seus resultados. QR vivo — o consultor pode mudar a frase sem
            reimprimir.
          </p>
          {rootUrl && (
            <p className="text-[11px] font-mono text-muted-foreground mt-2 break-all">
              {rootUrl}
            </p>
          )}
        </div>

        <BannerNamesTable
          rows={rows}
          title="Nome | leituras | leads"
          emptyHint="Ainda sem leituras. Divulgue seu QR."
        />

        <Card>
          <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
            <p>
              Locais nomeados (
              {spots.filter((s) => s.is_active !== false).length}): o consultor
              cria na Central de Banners.
            </p>
            <p>Arquivados continuam no histórico e não somem.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
