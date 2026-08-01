import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { Loader2 } from "lucide-react";
import { toast } from "@/components/ui/sonner";

type OriginKind = "partner" | "campaign" | "none";

interface Option {
  id: string;
  label: string;
}

export interface LeadOriginSaved {
  kind: OriginKind;
  referral_partner_id: string | null;
  source_campaign_id: string | null;
  partner_name: string | null;
  campaign_name: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string;
  consultantId: string;
  /** Se true, dialog fica só leitura (captação já encerrada). */
  captureClosed?: boolean;
  initialPartnerId?: string | null;
  initialCampaignId?: string | null;
  initialPartnerName?: string | null;
  initialCampaignName?: string | null;
  onSaved?: (result: LeadOriginSaved) => void;
}

function initialKind(
  partnerId: string | null | undefined,
  campaignId: string | null | undefined,
): OriginKind {
  if (partnerId) return "partner";
  if (campaignId) return "campaign";
  return "none";
}

export function LeadOriginEditorDialog({
  open,
  onOpenChange,
  customerId,
  consultantId,
  captureClosed = false,
  initialPartnerId = null,
  initialCampaignId = null,
  initialPartnerName = null,
  initialCampaignName = null,
  onSaved,
}: Props) {
  const [kind, setKind] = useState<OriginKind>("none");
  const [sourceId, setSourceId] = useState("");
  const [partners, setPartners] = useState<Option[]>([]);
  const [campaigns, setCampaigns] = useState<Option[]>([]);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [closedAtLoad, setClosedAtLoad] = useState(captureClosed);

  useEffect(() => {
    if (!open) return;
    setKind(initialKind(initialPartnerId, initialCampaignId));
    setSourceId(initialPartnerId || initialCampaignId || "");
    setClosedAtLoad(captureClosed);
    setConfirmClear(false);
  }, [open, initialPartnerId, initialCampaignId, captureClosed]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setLoadingOpts(true);
      const [pRes, cRes, custRes] = await Promise.all([
        supabase
          .from("referral_partners")
          .select("id, nome, is_active")
          .eq("consultant_id", consultantId)
          .eq("is_active", true)
          .order("nome", { ascending: true }),
        supabase
          .from("facebook_campaigns")
          .select("id, name, status")
          .eq("consultant_id", consultantId)
          .in("status", ["active", "paused", "pending_review"])
          .order("name", { ascending: true })
          .limit(200),
        supabase
          .from("customers")
          .select("capture_closed_at, referral_partner_id, source_campaign_id")
          .eq("id", customerId)
          .maybeSingle(),
      ]);
      if (cancelled) return;

      const partnerList: Option[] = ((pRes.data || []) as { id: string; nome: string }[]).map(
        (p) => ({ id: p.id, label: p.nome }),
      );
      const campaignList: Option[] = ((cRes.data || []) as { id: string; name: string }[]).map(
        (c) => ({ id: c.id, label: c.name }),
      );

      // Mantém opção atual mesmo se inativa/pausada fora do filtro
      if (
        initialPartnerId &&
        initialPartnerName &&
        !partnerList.some((p) => p.id === initialPartnerId)
      ) {
        partnerList.unshift({ id: initialPartnerId, label: `${initialPartnerName} (atual)` });
      }
      if (
        initialCampaignId &&
        initialCampaignName &&
        !campaignList.some((c) => c.id === initialCampaignId)
      ) {
        campaignList.unshift({ id: initialCampaignId, label: `${initialCampaignName} (atual)` });
      }

      setPartners(partnerList);
      setCampaigns(campaignList);

      const cust = custRes.data as {
        capture_closed_at?: string | null;
        referral_partner_id?: string | null;
        source_campaign_id?: string | null;
      } | null;
      if (cust?.capture_closed_at) setClosedAtLoad(true);
      if (cust) {
        setKind(initialKind(cust.referral_partner_id, cust.source_campaign_id));
        setSourceId(cust.referral_partner_id || cust.source_campaign_id || "");
      }

      setLoadingOpts(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    consultantId,
    customerId,
    initialPartnerId,
    initialCampaignId,
    initialPartnerName,
    initialCampaignName,
  ]);

  const readOnly = closedAtLoad;

  async function submit(nextKind: OriginKind, nextSourceId: string | null) {
    if (readOnly) return;
    if ((nextKind === "partner" || nextKind === "campaign") && !nextSourceId) {
      toast.error(
        nextKind === "partner" ? "Selecione o parceiro" : "Selecione a campanha",
      );
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("update-lead-origin", {
        body: {
          customer_id: customerId,
          kind: nextKind,
          source_id: nextKind === "none" ? null : nextSourceId,
        },
      });

      // Context7 / supabase-js: non-2xx → FunctionsHttpError com Response em error.context
      let body = data as {
        ok?: boolean;
        error?: string;
        kind?: OriginKind;
        referral_partner_id?: string | null;
        source_campaign_id?: string | null;
        partner_name?: string | null;
        campaign_name?: string | null;
        meta_ad_locked?: boolean;
      } | null;

      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            body = (await ctx.json()) as typeof body;
          } catch {
            /* ignore parse */
          }
        }
        if (!body?.error) {
          throw new Error(error.message || "Falha ao salvar origem");
        }
      }

      if (!body?.ok) {
        const code = body?.error || "unknown";
        if (code === "capture_already_closed") {
          setClosedAtLoad(true);
          toast.error("Captação já encerrada — origem só leitura");
          return;
        }
        if (code === "meta_ad_origin_locked" || code === "meta_ad_campaign_locked") {
          toast.error(
            "Este lead veio de anúncio Meta (AD ID). A campanha fica travada; dá para trocar só o parceiro da pool.",
          );
          return;
        }
        if (code === "partner_not_in_campaign_pool") {
          toast.error("Parceiro não está na pool desta campanha Meta.");
          return;
        }
        throw new Error(code);
      }

      const saved: LeadOriginSaved = {
        kind: body.kind || nextKind,
        referral_partner_id: body.referral_partner_id ?? null,
        source_campaign_id: body.source_campaign_id ?? null,
        partner_name: body.partner_name ?? null,
        campaign_name: body.campaign_name ?? null,
      };
      toast.success(
        saved.kind === "none"
          ? "Origem removida"
          : saved.kind === "partner"
            ? `Indicação: ${saved.partner_name || "parceiro"}`
            : `Campanha: ${saved.campaign_name || "Meta"}`,
      );
      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message || "Erro ao salvar origem");
    } finally {
      setBusy(false);
      setConfirmClear(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Origem do lead</DialogTitle>
            <DialogDescription>
              {readOnly
                ? "Captação já encerrada — origem somente leitura."
                : "Define indicação (parceiro) ou campanha Meta. Não envia aviso ao parceiro."}
            </DialogDescription>
          </DialogHeader>

          {loadingOpts ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              <RadioGroup
                value={kind}
                onValueChange={(v) => {
                  if (readOnly) return;
                  const next = v as OriginKind;
                  setKind(next);
                  if (next === "partner") setSourceId(initialPartnerId || "");
                  else if (next === "campaign") setSourceId(initialCampaignId || "");
                  else setSourceId("");
                }}
                className="grid gap-2"
                disabled={readOnly}
              >
                <label
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
                    kind === "partner" ? "border-primary bg-primary/5" : "border-border"
                  } ${readOnly ? "opacity-70" : "cursor-pointer"}`}
                >
                  <RadioGroupItem value="partner" disabled={readOnly} />
                  Parceiro (indicação)
                </label>
                <label
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
                    kind === "campaign" ? "border-primary bg-primary/5" : "border-border"
                  } ${readOnly ? "opacity-70" : "cursor-pointer"}`}
                >
                  <RadioGroupItem value="campaign" disabled={readOnly} />
                  Campanha Meta
                </label>
                <label
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
                    kind === "none" ? "border-primary bg-primary/5" : "border-border"
                  } ${readOnly ? "opacity-70" : "cursor-pointer"}`}
                >
                  <RadioGroupItem value="none" disabled={readOnly} />
                  Sem origem
                </label>
              </RadioGroup>

              {kind === "partner" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Parceiro</Label>
                  <Select
                    value={sourceId}
                    onValueChange={setSourceId}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Selecione o parceiro" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {partners.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                      {partners.length === 0 && (
                        <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                          Nenhum parceiro ativo
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {kind === "campaign" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Campanha</Label>
                  <Select
                    value={sourceId}
                    onValueChange={setSourceId}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Selecione a campanha" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.label}
                        </SelectItem>
                      ))}
                      {campaigns.length === 0 && (
                        <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                          Nenhuma campanha ativa/pausada
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {!readOnly && (initialPartnerId || initialCampaignId) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                  disabled={busy}
                  onClick={() => setConfirmClear(true)}
                >
                  Remover origem
                </Button>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {readOnly ? "Fechar" : "Cancelar"}
            </Button>
            {!readOnly && (
              <Button
                type="button"
                disabled={busy || loadingOpts}
                onClick={() => void submit(kind, sourceId || null)}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover origem?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso limpa indicação e campanha deste lead. O protocolo (se existir) é
              mantido. Nenhum aviso será enviado ao parceiro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void submit("none", null);
              }}
            >
              {busy ? "Removendo…" : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
