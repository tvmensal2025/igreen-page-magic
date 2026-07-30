import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Download,
  Info,
  LayoutGrid,
  Loader2,
  Lock,
  MapPin,
  Pencil,
  QrCode,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HelpHint } from "@/components/ui/help-hint";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  buildConsultantBannerInitials,
  buildConsultantLiveBannerUrl,
} from "@/lib/consultantBannerLink";
import { BannersDashboard } from "./BannersDashboard";
import {
  BannerNamesTable,
  buildBannerNameRows,
} from "./BannerNamesTable";
import { BannersRanking } from "./BannersRanking";
import { PartnerBannersPanel } from "./PartnerBannersPanel";
import type { BannerSpot } from "./ConsultantBannerDownloadModal";
import type { ReferralPartner } from "./hooks/useReferralPartners";

type HubSection = "meus" | "parceiros" | "ranking";
type HubTab = "lista" | "resultados";

interface Props {
  consultantId: string;
  consultantName?: string;
  consultantIgreenId?: string;
  consultantPhone?: string;
  license?: string | null;
  defaultPhrase?: string | null;
  spots: BannerSpot[];
  partners: ReferralPartner[];
  onSpotsChanged: () => void;
  onPartnersChanged: () => void;
  onBack: () => void;
  /** Abre o modal de download/edição. mode: root | spot; spotId opcional. */
  onOpenDownload: (opts: { mode: "root" | "spot"; spotId?: string }) => void;
  onOpenPartnerQr: (
    partner: ReferralPartner,
    ctx?: { keyword?: string; spotCode?: string; phrase?: string | null },
  ) => void;
}

export function BannersHub({
  consultantId,
  consultantName = "",
  consultantIgreenId = "",
  consultantPhone = "",
  license = "",
  defaultPhrase = null,
  spots,
  partners,
  onSpotsChanged,
  onPartnersChanged,
  onBack,
  onOpenDownload,
  onOpenPartnerQr,
}: Props) {
  const { toast } = useToast();
  const [section, setSection] = useState<HubSection>("meus");
  const [tab, setTab] = useState<HubTab>("lista");
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>("");
  const [scanCounts, setScanCounts] = useState<Record<string, number>>({});
  const [leadCounts, setLeadCounts] = useState<Record<string, number>>({});
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const initials = useMemo(
    () => buildConsultantBannerInitials(consultantName),
    [consultantName],
  );
  const igreenId = String(consultantIgreenId || "").replace(/\D/g, "");
  const rootUrl = useMemo(
    () =>
      igreenId
        ? buildConsultantLiveBannerUrl({ initials, igreenId })
        : "https://igreen.cloud",
    [initials, igreenId],
  );

  const activeSpots = useMemo(
    () => spots.filter((s) => s.is_active !== false),
    [spots],
  );
  const archivedSpots = useMemo(
    () => spots.filter((s) => s.is_active === false),
    [spots],
  );

  const loadCounts = useCallback(async () => {
    if (!consultantId) return;
    setLoadingCounts(true);
    try {
      // PostgREST limita 1000 — pagina para não subcontar.
      const pageSize = 1000;
      const events: Array<{ event_target: string | null }> = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("page_events")
          .select("event_target")
          .eq("consultant_id", consultantId)
          .eq("event_type", "qr_scan")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const chunk = data || [];
        events.push(...chunk);
        if (chunk.length < pageSize) break;
      }

      const customers: Array<{ referral_keyword_matched: string | null }> = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("customers")
          .select("referral_keyword_matched")
          .eq("consultant_id", consultantId)
          .not("referral_keyword_matched", "is", null)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const chunk = data || [];
        customers.push(...chunk);
        if (chunk.length < pageSize) break;
      }

      const scans: Record<string, number> = {};
      events.forEach((row) => {
        const t = String(row.event_target || "").trim();
        if (!t) return;
        if (t === "banner_root" || t === "panfleto") {
          scans.__root = (scans.__root || 0) + 1;
        } else if (t.startsWith("banner_spot:")) {
          const code = t.slice("banner_spot:".length);
          scans[code] = (scans[code] || 0) + 1;
        }
      });
      setScanCounts(scans);

      const leads: Record<string, number> = {};
      customers.forEach((row) => {
        const kw = String(row.referral_keyword_matched || "").trim();
        if (!kw) return;
        leads[kw] = (leads[kw] || 0) + 1;
      });
      setLeadCounts(leads);
    } catch (e) {
      console.warn("[banners-hub-counts]", e);
    } finally {
      setLoadingCounts(false);
    }
  }, [consultantId]);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts, spots]);

  const setSpotActive = async (spot: BannerSpot, active: boolean) => {
    setBusyId(spot.id);
    try {
      const { error } = await supabase
        .from("consultant_banner_spots")
        .update({
          is_active: active,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", spot.id)
        .eq("consultant_id", consultantId);
      if (error) throw error;
      onSpotsChanged();
      toast({
        title: active ? "Banner restaurado" : "Banner arquivado",
        description: active
          ? "Voltou para a lista ativa. Pode baixar de novo."
          : "Fica salvo em Arquivados. QR já impresso continua abrindo o WhatsApp.",
      });
    } catch (e: unknown) {
      toast({
        title: "Não foi possível atualizar",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
      setArchivingId(null);
    }
  };

  const selectedPartner =
    partners.find((p) => p.id === selectedPartnerId) || partners[0] || null;

  useEffect(() => {
    if (!selectedPartnerId && partners[0]) {
      setSelectedPartnerId(partners[0].id);
    }
  }, [partners, selectedPartnerId]);

  const spotToArchive = spots.find((s) => s.id === archivingId) || null;

  const nameRows = useMemo(
    () =>
      buildBannerNameRows({
        rootScans: scanCounts.__root || 0,
        rootLeads: 0,
        spots,
        scanByCode: scanCounts,
        leadByKeyword: leadCounts,
      }),
    [scanCounts, leadCounts, spots],
  );

  return (
    <div className="pe-page space-y-6">
      <div className="pe-page-header">
        <div className="min-w-0 flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 mt-0.5"
            onClick={onBack}
            aria-label="Voltar para parceiros"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h2 className="pe-page-title flex items-center gap-2 flex-wrap">
              <QrCode className="h-5 w-5 text-primary" />
              Central de Banners
              <HelpHint
                size={14}
                title="Você + parceiros, tudo com nome"
                summary="Meus, Parceiros e Ranking no mesmo lugar"
                details={
                  "Meus: seus QRs Gerais e locais nomeados.\n\n" +
                  "Parceiros: mesma lógica por indicador (nome obrigatório, tabela, link só dele).\n\n" +
                  "Ranking: compara todos no período.\n\n" +
                  "Excluir = arquivar. Nada some do banco."
                }
                example="Geral: igreen.cloud/rfd/124170 | Parceiro: /r/…/código?s=posto-shell"
              />
            </h2>
            <p className="pe-page-sub">
              Seus banners e dos parceiros — nome, leituras, leads e QR vivo.
            </p>
          </div>
        </div>
        {section === "meus" && (
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Button
            type="button"
            variant="outline"
            className="gap-2 h-8"
            onClick={() => onOpenDownload({ mode: "root" })}
          >
            <Download className="h-4 w-4" />
            Baixar Geral
          </Button>
          <Button
            type="button"
            className="gap-2 h-8"
            onClick={() => onOpenDownload({ mode: "spot" })}
          >
            <MapPin className="h-4 w-4" />
            Novo local / baixar
          </Button>
        </div>
        )}
      </div>

      <div className="flex gap-1 bg-muted/50 rounded-lg p-1 w-fit flex-wrap">
        {(
          [
            { id: "meus" as const, label: "Meus" },
            { id: "parceiros" as const, label: `Parceiros (${partners.length})` },
            { id: "ranking" as const, label: "Ranking" },
          ] as const
        ).map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              section === s.id
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === "ranking" ? (
        <BannersRanking
          consultantId={consultantId}
          mySpots={spots}
          partners={partners}
        />
      ) : section === "parceiros" ? (
        <div className="space-y-4">
          {partners.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Cadastre um parceiro na rede para criar banners nomeados dele.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {partners.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPartnerId(p.id)}
                    className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                      selectedPartner?.id === p.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    {p.nome}
                  </button>
                ))}
              </div>
              {selectedPartner && (
                <PartnerBannersPanel
                  consultantId={consultantId}
                  partner={selectedPartner}
                  license={license}
                  consultantIgreenId={consultantIgreenId}
                  consultantName={consultantName}
                  consultantPhone={consultantPhone}
                  onOpenPartnerQr={(ctx) => onOpenPartnerQr(selectedPartner, ctx)}
                  onPartnerUpdated={onPartnersChanged}
                />
              )}
            </>
          )}
        </div>
      ) : (
        <>
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1 w-fit">
        <button
          type="button"
          onClick={() => setTab("lista")}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
            tab === "lista"
              ? "bg-card text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Lista
        </button>
        <button
          type="button"
          onClick={() => setTab("resultados")}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
            tab === "resultados"
              ? "bg-card text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Resultados
        </button>
      </div>

      {tab === "resultados" ? (
        <BannersDashboard
          consultantId={consultantId}
          spots={spots}
          onOpenDownload={onOpenDownload}
        />
      ) : (
        <div className="space-y-4">
          <Alert className="border-primary/20 bg-primary/5">
            <Info className="h-4 w-4 text-primary" />
            <AlertTitle className="text-sm">
              Cada banner precisa de um nome para você saber de onde veio
            </AlertTitle>
            <AlertDescription className="text-xs leading-relaxed">
              <ul className="list-disc pl-4 mt-1 space-y-1">
                <li>
                  <strong>Geral</strong> = um nome só (“Banner Geral”). Bom para
                  4.000 panfletos iguais — o link é eterno e não some.
                </li>
                <li>
                  <strong>Com local</strong> = crie com{" "}
                  <strong>nome obrigatório</strong> (ex.: Posto Shell Centro).
                  Assim Resultados mostra leituras e leads{" "}
                  <strong>por nome</strong>.
                </li>
                <li>
                  Criar outro local só <strong>adiciona</strong> — nunca apaga o
                  anterior.
                </li>
              </ul>
            </AlertDescription>
          </Alert>

          <BannerNamesTable
            rows={nameRows}
            loading={loadingCounts}
            title="Nome | leituras | leads"
            emptyHint="Crie um local com nome (ex.: Posto Shell) para rastrear cada ponto."
            onRowClick={(row) => {
              if (row.kind === "geral") {
                onOpenDownload({ mode: "root" });
                return;
              }
              onOpenDownload({ mode: "spot", spotId: row.key });
            }}
          />

          {/* Card Geral */}
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
                <span className="flex items-center gap-2">
                  <LayoutGrid className="h-4 w-4 text-primary" />
                  Banner Geral
                </span>
                <Badge variant="secondary" className="text-[10px] h-5 gap-1">
                  <Lock className="h-3 w-3" />
                  eterno
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              <p className="text-[11px] font-mono text-muted-foreground break-all">
                {rootUrl}
              </p>
              <p className="text-xs text-muted-foreground">
                Um QR para todos os lugares. Frase viva
                {defaultPhrase ? `: “${defaultPhrase.slice(0, 80)}${defaultPhrase.length > 80 ? "…" : ""}”` : " (padrão do sistema)"}.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px] h-5 gap-1">
                  <QrCode className="h-3 w-3" />
                  {loadingCounts ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    scanCounts.__root || 0
                  )}{" "}
                  leituras
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => onOpenDownload({ mode: "root" })}
                >
                  <Download className="h-3.5 w-3.5" />
                  Baixar / editar frase
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Locais ativos */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              Locais salvos ({activeSpots.length})
            </h3>
            {activeSpots.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum local ainda. Crie o primeiro para rastrear posto,
                  padaria, feira…
                  <div className="mt-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onOpenDownload({ mode: "spot" })}
                    >
                      Criar primeiro local
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {activeSpots.map((s) => {
                  const url = igreenId
                    ? buildConsultantLiveBannerUrl({
                        initials,
                        igreenId,
                        spotCode: s.code,
                      })
                    : "";
                  const scans = scanCounts[s.code] || 0;
                  const leads = leadCounts[s.keyword] || 0;
                  return (
                    <Card key={s.id} className="border-border/60">
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">
                              {s.keyword}
                            </p>
                            <p className="text-[10px] font-mono text-muted-foreground break-all">
                              {url || `…/${s.code}`}
                            </p>
                          </div>
                          <Badge
                            variant="secondary"
                            className="text-[10px] h-5 shrink-0 gap-1"
                          >
                            <Users className="h-3 w-3" />
                            {loadingCounts ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              leads
                            )}
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {loadingCounts ? "…" : `${scans} leitura(s) QR`} ·
                          frase{" "}
                          {s.phrase
                            ? "personalizada"
                            : "padrão com keyword"}
                        </p>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="default"
                            className="h-7 text-xs gap-1"
                            onClick={() =>
                              onOpenDownload({ mode: "spot", spotId: s.id })
                            }
                          >
                            <Pencil className="h-3 w-3" />
                            Baixar / editar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                            disabled={busyId === s.id}
                            onClick={() => setArchivingId(s.id)}
                          >
                            {busyId === s.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                            Excluir
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* Arquivados */}
          {archivedSpots.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Arquivados ({archivedSpots.length}) — nunca apagados do banco
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {archivedSpots.map((s) => (
                  <Card
                    key={s.id}
                    className="border-border/40 bg-muted/20 opacity-90"
                  >
                    <CardContent className="p-3 space-y-2">
                      <p className="font-medium text-sm truncate">{s.keyword}</p>
                      <p className="text-[10px] font-mono text-muted-foreground break-all">
                        /{s.code}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        QR impresso ainda abre o WhatsApp (frase fallback).
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        disabled={busyId === s.id}
                        onClick={() => void setSpotActive(s, true)}
                      >
                        {busyId === s.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        Restaurar
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
        </>
      )}

      <AlertDialog
        open={!!archivingId}
        onOpenChange={(o) => !o && setArchivingId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar este banner?</AlertDialogTitle>
            <AlertDialogDescription>
              {spotToArchive
                ? `“${spotToArchive.keyword}” sai da lista ativa, mas permanece salvo. O QR já impresso continua funcionando. Nada é apagado do banco.`
                : "O banner sai da lista ativa, mas permanece salvo."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (spotToArchive) void setSpotActive(spotToArchive, false);
              }}
            >
              Arquivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
