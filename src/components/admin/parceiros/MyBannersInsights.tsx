import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  MapPin,
  MessageSquareQuote,
  Percent,
  QrCode,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { buildConsultantLiveBannerUrl } from "@/lib/consultantBannerLink";
import {
  consultantBannerPhraseSource,
  resolveConsultantBannerPhrase,
} from "@/lib/consultantBannerPhrase";
import type { BannerSpot } from "./ConsultantBannerDownloadModal";

interface Props {
  initials: string;
  igreenId: string;
  defaultPhrase?: string | null;
  spots: BannerSpot[];
  scanCounts: Record<string, number>;
  leadCounts: Record<string, number>;
  loading?: boolean;
  onOpenDownload: (opts: { mode: "root" | "spot"; spotId?: string }) => void;
}

type PreviewRow = {
  key: string;
  name: string;
  url: string;
  phrase: string;
  source: "local" | "padrao" | "sistema";
  leituras: number;
  leads: number;
  mode: "root" | "spot";
  spotId?: string;
};

const SOURCE_LABEL: Record<PreviewRow["source"], string> = {
  local: "frase do local",
  padrao: "sua frase padrão",
  sistema: "frase do sistema",
};

/**
 * Painel de análise dos MEUS banners — mesma leitura do portal público do
 * parceiro (KPIs + o que o lead vê), só que no tema claro do admin.
 *
 * A prévia usa a MESMA regra da edge `qr-redirect`: frase do local > frase
 * padrão do consultor > frase do sistema. Sem keyword, sem marcador.
 */
export function MyBannersInsights({
  initials,
  igreenId,
  defaultPhrase = null,
  spots,
  scanCounts,
  leadCounts,
  loading = false,
  onOpenDownload,
}: Props) {
  const { toast } = useToast();
  const [copied, setCopied] = useState<string>("");

  const activeSpots = useMemo(
    () => spots.filter((s) => s.is_active !== false),
    [spots],
  );

  const rows = useMemo<PreviewRow[]>(() => {
    const out: PreviewRow[] = [
      {
        key: "__root",
        name: "Banner Geral",
        url: buildConsultantLiveBannerUrl({ initials, igreenId }),
        phrase: resolveConsultantBannerPhrase(null, defaultPhrase),
        source: consultantBannerPhraseSource(null, defaultPhrase),
        leituras: scanCounts.__root || 0,
        leads: 0,
        mode: "root",
      },
    ];
    activeSpots.forEach((s) => {
      out.push({
        key: s.id,
        name: s.keyword || s.code,
        url: buildConsultantLiveBannerUrl({
          initials,
          igreenId,
          spotCode: s.code,
        }),
        phrase: resolveConsultantBannerPhrase(s.phrase, defaultPhrase),
        source: consultantBannerPhraseSource(s.phrase, defaultPhrase),
        leituras: scanCounts[s.code] || 0,
        leads: leadCounts[s.keyword] || 0,
        mode: "spot",
        spotId: s.id,
      });
    });
    return out;
  }, [activeSpots, defaultPhrase, igreenId, initials, leadCounts, scanCounts]);

  const totalLeituras = rows.reduce((a, r) => a + r.leituras, 0);
  const totalLeads = rows.reduce((a, r) => a + r.leads, 0);
  const conversao =
    totalLeituras > 0 ? Math.round((totalLeads / totalLeituras) * 100) : 0;

  const kpis = [
    {
      label: "Leituras QR",
      value: totalLeituras,
      hint: "Só QR impresso",
      Icon: QrCode,
    },
    { label: "Leads", value: totalLeads, hint: "Por palavra-chave", Icon: Users },
    {
      label: "Conversão",
      value: `${conversao}%`,
      hint: "Leads ÷ leituras",
      Icon: Percent,
    },
    {
      label: "Locais ativos",
      value: activeSpots.length,
      hint: "Cada um com nome",
      Icon: MapPin,
    },
  ];

  const copy = async (row: PreviewRow) => {
    try {
      await navigator.clipboard.writeText(row.url);
      setCopied(row.key);
      window.setTimeout(() => setCopied(""), 1800);
    } catch {
      toast({
        title: "Não foi possível copiar",
        description: row.url,
        variant: "destructive",
      });
    }
  };

  if (!igreenId) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {kpis.map((k) => (
          <Card
            key={k.label}
            className="border-primary/15 bg-gradient-to-br from-primary/[0.07] to-transparent"
          >
            <CardContent className="p-3.5 sm:p-4">
              <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                <k.Icon className="h-3.5 w-3.5 text-primary" />
                <span className="truncate">{k.label}</span>
              </div>
              <p className="mt-1.5 font-heading text-2xl sm:text-3xl font-bold tabular-nums">
                {loading ? "—" : k.value}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{k.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MessageSquareQuote className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">
              O que o lead vê ao ler cada QR
            </h3>
            <Badge variant="secondary" className="text-[10px] h-5">
              ao vivo
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Mesma regra da leitura real: frase do local vence a sua frase padrão.
            Mudou a frase? O QR já impresso abre o texto novo na hora.
          </p>

          <div className="space-y-2">
            {rows.map((row) => (
              <div
                key={row.key}
                className="rounded-lg border bg-muted/30 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{row.name}</p>
                    <p className="text-[11px] font-mono text-muted-foreground break-all">
                      {row.url}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-[10px] h-5 gap-1">
                      <Eye className="h-3 w-3" />
                      {row.leituras}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] h-5 gap-1">
                      <Users className="h-3 w-3" />
                      {row.leads}
                    </Badge>
                  </div>
                </div>

                <blockquote className="text-sm rounded-md bg-background border-l-2 border-primary/60 px-3 py-2 leading-relaxed">
                  “{row.phrase}”
                </blockquote>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] h-5">
                    {SOURCE_LABEL[row.source]}
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => copy(row)}
                  >
                    {copied === row.key ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copied === row.key ? "Copiado" : "Copiar link"}
                  </Button>
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Testar agora
                  </a>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs ml-auto"
                    onClick={() =>
                      onOpenDownload(
                        row.mode === "root"
                          ? { mode: "root" }
                          : { mode: "spot", spotId: row.spotId },
                      )
                    }
                  >
                    Editar frase / baixar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
