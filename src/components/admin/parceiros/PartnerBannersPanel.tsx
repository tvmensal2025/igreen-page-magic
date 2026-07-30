import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Copy,
  Download,
  ExternalLink,
  Loader2,
  MapPin,
  Pencil,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { slugifyBannerSpotCode } from "@/lib/consultantBannerLink";
import {
  buildPartnerPortalUrl,
  buildPartnerPublicShortLink,
} from "@/lib/partnerShortLink";
import {
  buildDefaultQrPhrase,
  isGenericKeyword,
} from "./qrPhrase";
import {
  BannerNamesTable,
  buildBannerNameRows,
} from "./BannerNamesTable";
import { PartnerBannerLiveModal } from "./PartnerBannerLiveModal";
import type { ReferralPartner } from "./hooks/useReferralPartners";

export type PartnerBannerSpot = {
  id: string;
  code: string;
  keyword: string;
  phrase: string | null;
  is_active: boolean;
};

interface Props {
  consultantId: string;
  partner: ReferralPartner & {
    portal_token?: string | null;
    banner_alert_threshold?: number | null;
  };
  license?: string | null;
  consultantIgreenId?: string;
  consultantName?: string;
  consultantPhone?: string;
  /** Abre download QR. ctx.spot = local nomeado; sem ctx = geral. */
  onOpenPartnerQr: (ctx?: {
    keyword?: string;
    spotCode?: string;
    phrase?: string | null;
  }) => void;
  onPartnerUpdated: () => void;
}

export function PartnerBannersPanel({
  consultantId,
  partner,
  license = "",
  consultantIgreenId = "",
  consultantName = "",
  consultantPhone = "",
  onOpenPartnerQr,
  onPartnerUpdated,
}: Props) {
  const { toast } = useToast();
  const [spots, setSpots] = useState<PartnerBannerSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanCounts, setScanCounts] = useState<Record<string, number>>({});
  const [rootScans, setRootScans] = useState(0);
  const [leadCounts, setLeadCounts] = useState<Record<string, number>>({});
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveSpot, setLiveSpot] = useState<PartnerBannerSpot | null>(null);
  const [alertThreshold, setAlertThreshold] = useState(
    Number(partner.banner_alert_threshold || 0),
  );

  const ref =
    String(license || "").trim() ||
    String(consultantIgreenId || "").replace(/\D/g, "");
  const shortCode = String(partner.short_code || "").trim();

  const rootUrl = useMemo(() => {
    if (!ref || !shortCode) return "";
    return buildPartnerPublicShortLink(ref, shortCode);
  }, [ref, shortCode]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: spotRows }, { data: events }, { data: customers }] =
        await Promise.all([
          supabase
            .from("referral_partner_banner_spots" as never)
            .select("id, code, keyword, phrase, is_active")
            .eq("partner_id", partner.id)
            .order("created_at", { ascending: true }),
          supabase
            .from("page_events")
            .select("event_target")
            .eq("consultant_id", consultantId)
            .eq("event_type", "qr_scan"),
          supabase
            .from("customers")
            .select("referral_keyword_matched")
            .eq("consultant_id", consultantId)
            .eq("referral_partner_id", partner.id)
            .not("referral_keyword_matched", "is", null),
        ]);

      setSpots((spotRows as PartnerBannerSpot[] | null) || []);

      const short = shortCode;
      let root = 0;
      const byCode: Record<string, number> = {};
      (events || []).forEach((row) => {
        const t = String(row.event_target || "").trim();
        if (!t) return;
        if (short && t === `partner:${short}`) {
          root += 1;
          return;
        }
        if (short && t.startsWith(`partner:${short}:`)) {
          const code = t.slice(`partner:${short}:`.length);
          byCode[code] = (byCode[code] || 0) + 1;
        }
      });
      setRootScans(root);
      setScanCounts(byCode);

      const leads: Record<string, number> = {};
      (customers || []).forEach((row) => {
        const kw = String(row.referral_keyword_matched || "").trim();
        if (!kw) return;
        leads[kw] = (leads[kw] || 0) + 1;
      });
      setLeadCounts(leads);
    } catch (e) {
      console.warn("[partner-banners]", e);
    } finally {
      setLoading(false);
    }
  }, [consultantId, partner.id, shortCode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setAlertThreshold(Number(partner.banner_alert_threshold || 0));
  }, [partner.banner_alert_threshold, partner.id]);

  const activeSpots = spots.filter((s) => s.is_active !== false);
  const archivedSpots = spots.filter((s) => s.is_active === false);

  const nameRows = useMemo(
    () =>
      buildBannerNameRows({
        rootScans,
        rootLeads: 0,
        spots: spots.map((s) => ({
          id: s.id,
          code: s.code,
          keyword: s.keyword,
          is_active: s.is_active,
        })),
        scanByCode: scanCounts,
        leadByKeyword: leadCounts,
      }).map((r) =>
        r.kind === "geral"
          ? { ...r, name: `Geral · ${partner.nome}` }
          : r,
      ),
    [rootScans, spots, scanCounts, leadCounts, partner.nome],
  );

  const createSpot = async () => {
    const kw = newName.trim();
    if (!kw || kw.length < 3) {
      setError("Nome do banner é obrigatório (mín. 3 caracteres).");
      return;
    }
    if (isGenericKeyword(kw)) {
      setError("Nome genérico demais. Use o nome do ponto.");
      return;
    }
    if (
      activeSpots.some((s) => s.keyword.toLowerCase() === kw.toLowerCase())
    ) {
      setError("Já existe um banner ativo com esse nome.");
      return;
    }
    const code =
      slugifyBannerSpotCode(newCode || kw) || slugifyBannerSpotCode(kw);
    if (!code) {
      setError("Código inválido.");
      return;
    }
    if (activeSpots.some((s) => s.code === code)) {
      setError("Já existe banner com esse código.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const phrase = buildDefaultQrPhrase(kw);
      const { error: err } = await supabase
        .from("referral_partner_banner_spots" as never)
        .insert({
          partner_id: partner.id,
          consultant_id: consultantId,
          code,
          keyword: kw,
          phrase,
        } as never);
      if (err) throw err;

      // Espelha keyword no parceiro para match no webhook.
      const nextKw = Array.from(
        new Set([...(partner.keywords || []), kw].filter(Boolean)),
      );
      await supabase
        .from("referral_partners")
        .update({ keywords: nextKw, updated_at: new Date().toISOString() })
        .eq("id", partner.id);

      setNewName("");
      setNewCode("");
      onPartnerUpdated();
      await load();
      toast({
        title: "Banner do parceiro criado",
        description: `Nome: ${kw}`,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Falha ao criar.");
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (spot: PartnerBannerSpot, active: boolean) => {
    setBusyId(spot.id);
    try {
      const { error: err } = await supabase
        .from("referral_partner_banner_spots" as never)
        .update({
          is_active: active,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", spot.id);
      if (err) throw err;
      await load();
      toast({
        title: active ? "Banner restaurado" : "Banner arquivado",
      });
    } catch (e: unknown) {
      toast({
        title: "Erro",
        description: e instanceof Error ? e.message : "Falha",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
      setArchivingId(null);
    }
  };

  const openLive = (spot: PartnerBannerSpot | null) => {
    setLiveSpot(spot);
    setLiveOpen(true);
  };

  const ensurePortalToken = async () => {
    if (partner.portal_token) {
      const url = buildPartnerPortalUrl(partner.portal_token);
      await navigator.clipboard.writeText(url);
      toast({ title: "Link do parceiro copiado", description: url });
      return;
    }
    const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    const { error: err } = await supabase
      .from("referral_partners")
      .update({
        portal_token: token,
        updated_at: new Date().toISOString(),
      })
      .eq("id", partner.id);
    if (err) {
      toast({
        title: "Não gerou o link",
        description: err.message,
        variant: "destructive",
      });
      return;
    }
    onPartnerUpdated();
    const url = buildPartnerPortalUrl(token);
    await navigator.clipboard.writeText(url);
    toast({ title: "Link do parceiro criado e copiado", description: url });
  };

  const saveAlertThreshold = async () => {
    const n = Math.max(0, Math.floor(Number(alertThreshold) || 0));
    const { error: err } = await supabase
      .from("referral_partners")
      .update({
        banner_alert_threshold: n,
        updated_at: new Date().toISOString(),
      })
      .eq("id", partner.id);
    if (err) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
      return;
    }
    onPartnerUpdated();
    toast({
      title: n > 0 ? `Alerta em ${n} leads/leituras` : "Alerta desligado",
    });
  };

  const exportCsv = () => {
    const lines = ["nome,codigo,leituras,leads,status"];
    for (const r of nameRows) {
      lines.push(
        [
          `"${r.name.replace(/"/g, '""')}"`,
          r.code || "",
          r.leituras,
          r.leads,
          r.kind,
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `banners-${partner.nome || "parceiro"}.csv`;
    a.click();
  };

  const spotToArchive = spots.find((s) => s.id === archivingId) || null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-sm">{partner.nome}</h3>
          <p className="text-[11px] font-mono text-muted-foreground break-all">
            {rootUrl || "Sem short_code ainda"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1"
            onClick={() => void ensurePortalToken()}
          >
            <Copy className="h-3.5 w-3.5" />
            Link do parceiro
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1"
            onClick={exportCsv}
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1"
            onClick={() => openLive(null)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Baixar / editar Geral
          </Button>
        </div>
      </div>

      <BannerNamesTable
        rows={nameRows}
        loading={loading}
        title={`Nome | leituras | leads — ${partner.nome}`}
        onRowClick={(row) => {
          if (row.kind === "geral") {
            openLive(null);
            return;
          }
          const spot = spots.find((s) => s.id === row.key);
          if (!spot || spot.is_active === false) return;
          openLive(spot);
        }}
      />

      <Card>
        <CardContent className="p-3 space-y-3">
          <p className="text-xs font-medium flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-primary" />
            Novo banner nomeado deste parceiro
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label className="text-[11px]">
                Nome <span className="text-destructive">*</span>
              </Label>
              <Input
                className="h-8 text-xs"
                value={newName}
                placeholder="Ex.: Posto Shell do Abel"
                onChange={(e) => {
                  setNewName(e.target.value);
                  setNewCode(slugifyBannerSpotCode(e.target.value));
                  setError(null);
                }}
              />
            </div>
            <div>
              <Label className="text-[11px]">Código fixo (?s=)</Label>
              <Input
                className="h-8 text-xs font-mono"
                value={newCode}
                onChange={(e) =>
                  setNewCode(slugifyBannerSpotCode(e.target.value))
                }
              />
            </div>
          </div>
          {error && <p className="text-[11px] text-destructive">{error}</p>}
          <Button
            type="button"
            size="sm"
            disabled={saving || !newName.trim()}
            onClick={() => void createSpot()}
            className="w-full"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Criar banner com este nome"
            )}
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {activeSpots.map((s) => {
          const url =
            ref && shortCode
              ? buildPartnerPublicShortLink(ref, shortCode, {
                  keyword: s.keyword,
                  spot: s.code,
                })
              : "";
          return (
            <Card key={s.id}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{s.keyword}</p>
                    <p className="text-[10px] font-mono text-muted-foreground break-all">
                      {url || `?s=${s.code}`}
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-[10px] h-5 gap-1">
                    <Users className="h-3 w-3" />
                    {leadCounts[s.keyword] || 0}
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {scanCounts[s.code] || 0} leitura(s)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs gap-1"
                    onClick={() => openLive(s)}
                  >
                    <Pencil className="h-3 w-3" />
                    Baixar / editar frase
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 text-destructive"
                    onClick={() => setArchivingId(s.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                    Excluir
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {archivedSpots.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Arquivados ({archivedSpots.length})
          </p>
          {archivedSpots.map((s) => (
            <Card key={s.id} className="opacity-80">
              <CardContent className="p-3 flex items-center justify-between gap-2">
                <p className="text-sm truncate">{s.keyword}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  disabled={busyId === s.id}
                  onClick={() => void setActive(s, true)}
                >
                  <RotateCcw className="h-3 w-3" />
                  Restaurar
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-3 space-y-2">
          <Label className="text-[11px]">
            Alerta (leads deste parceiro em 24h) — 0 = off
          </Label>
          <div className="flex gap-2">
            <Input
              type="number"
              min={0}
              className="h-8 text-xs w-28"
              value={alertThreshold}
              onChange={(e) => setAlertThreshold(Number(e.target.value))}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => void saveAlertThreshold()}
            >
              Salvar limiar
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Base pronta no cadastro do parceiro. O disparo WA entra no cron de
            alertas (Fase 3).
          </p>
        </CardContent>
      </Card>

      <AlertDialog
        open={!!archivingId}
        onOpenChange={(o) => !o && setArchivingId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar banner do parceiro?</AlertDialogTitle>
            <AlertDialogDescription>
              {spotToArchive
                ? `“${spotToArchive.keyword}” sai da lista ativa, mas fica salvo.`
                : "O banner permanece no histórico."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (spotToArchive) void setActive(spotToArchive, false);
              }}
            >
              Arquivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PartnerBannerLiveModal
        open={liveOpen}
        onClose={() => setLiveOpen(false)}
        partner={partner}
        spot={liveSpot}
        license={license}
        consultantIgreenId={consultantIgreenId}
        consultantName={consultantName}
        consultantPhone={consultantPhone}
        onSaved={() => {
          void load();
          onPartnerUpdated();
        }}
        onDownloadQr={(currentPhrase) => {
          if (liveSpot) {
            onOpenPartnerQr({
              keyword: liveSpot.keyword,
              spotCode: liveSpot.code,
              phrase: currentPhrase,
            });
          } else {
            onOpenPartnerQr({ phrase: currentPhrase });
          }
        }}
      />
    </div>
  );
}
