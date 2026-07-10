import { useEffect, useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Trophy, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

type SourceKind = "campaign" | "partner" | "organic";
type Outcome = "won" | "lost";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string;
  consultantId: string;
  onClosed?: () => void;
}

interface Option {
  id: string;
  label: string;
}

const LOST_REASONS = [
  { v: "sem_interesse", l: "Sem interesse" },
  { v: "nao_qualificado", l: "Não qualificado" },
  { v: "numero_invalido", l: "Número inválido" },
  { v: "sumiu", l: "Sumiu / não respondeu" },
  { v: "concorrente", l: "Fechou com concorrente" },
  { v: "outro", l: "Outro" },
];

export function CloseCaptureDialog({
  open,
  onOpenChange,
  customerId,
  consultantId,
  onClosed,
}: Props) {
  const [outcome, setOutcome] = useState<Outcome>("won");
  const [busy, setBusy] = useState(false);

  // won state
  const [sourceKind, setSourceKind] = useState<SourceKind>("organic");
  const [campaigns, setCampaigns] = useState<Option[]>([]);
  const [partners, setPartners] = useState<Option[]>([]);
  const [sourceId, setSourceId] = useState<string>("");
  const [productId, setProductId] = useState<string>("");
  const [products, setProducts] = useState<Option[]>([]);
  const [pointsKwh, setPointsKwh] = useState<string>("");
  const [billValue, setBillValue] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // lost state
  const [lostReason, setLostReason] = useState<string>("sem_interesse");
  const [lostNotes, setLostNotes] = useState<string>("");

  // Load data on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [c, p, prod, cust] = await Promise.all([
        supabase
          .from("facebook_campaigns")
          .select("id, name, status")
          .in("status", ["ACTIVE", "PAUSED"])
          .order("name", { ascending: true })
          .limit(200),
        supabase
          .from("referral_partners")
          .select("id, nome, is_active")
          .eq("consultant_id", consultantId)
          .eq("is_active", true)
          .order("nome", { ascending: true }),
        supabase
          .from("products")
          .select("id, name")
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
        supabase
          .from("customers")
          .select(
            "source_campaign_id, referral_partner_id, media_consumo, electricity_bill_value",
          )
          .eq("id", customerId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setCampaigns(
        ((c.data as any[]) || []).map((r) => ({ id: r.id, label: r.name || r.id.slice(0, 8) })),
      );
      setPartners(
        ((p.data as any[]) || []).map((r) => ({ id: r.id, label: r.nome || r.id.slice(0, 8) })),
      );
      const prods = ((prod.data as any[]) || []).map((r) => ({ id: r.id, label: r.name }));
      setProducts(prods);
      if (prods[0]) setProductId(prods[0].id);

      const cu = cust.data as any;
      if (cu?.source_campaign_id) {
        setSourceKind("campaign");
        setSourceId(cu.source_campaign_id);
      } else if (cu?.referral_partner_id) {
        setSourceKind("partner");
        setSourceId(cu.referral_partner_id);
      }
      if (cu?.media_consumo) setPointsKwh(String(cu.media_consumo));
      if (cu?.electricity_bill_value) setBillValue(String(cu.electricity_bill_value));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, customerId, consultantId]);

  const estimatedKwh = useMemo(() => {
    const k = Number(pointsKwh);
    if (k > 0) return k;
    const b = Number(billValue);
    if (b > 0) return Math.round(b / 0.85);
    return 0;
  }, [pointsKwh, billValue]);

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const payload: any = {
        customerId,
        consultantId,
        outcome,
      };
      if (outcome === "won") {
        payload.productId = productId || undefined;
        payload.pointsKwh = estimatedKwh || undefined;
        payload.notes = notes || undefined;
        payload.attribution =
          sourceKind === "organic"
            ? { kind: "organic" }
            : sourceId
              ? { kind: sourceKind, id: sourceId }
              : { kind: "organic" };
      } else {
        payload.lostReason = lostReason;
        payload.notes = lostNotes || undefined;
      }

      const { data, error } = await supabase.functions.invoke(
        "close-capture-and-register-sale",
        { body: payload },
      );
      if (error) throw new Error(error.message || "Falha ao encerrar");
      const res = (data as any) || {};
      if (!res.ok) throw new Error(res.error || "Falha ao encerrar");

      if (outcome === "won") {
        const roi = res.campaignRoi;
        const brl = (c: number) =>
          (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        let description =
          "Cliente entrou em Vendas, CRM e Comissão. O chat WhatsApp continua ativo.";
        if (roi) {
          const sign = roi.positive ? "🟢" : "🔴";
          description = `${sign} Campanha: ${brl(roi.investedCents)} investido · ${brl(
            roi.returnedCents,
          )} retorno · ${roi.leadsCount} leads`;
        }
        toast.success("🏆 Fechamento registrado (Ganho)", { description, duration: 6500 });
      } else {
        toast.success("Lead marcado como Perdido", {
          description: `Motivo: ${LOST_REASONS.find((r) => r.v === lostReason)?.l ?? lostReason}. Chat WhatsApp continua vivo.`,
          duration: 5000,
        });
      }
      onOpenChange(false);
      onClosed?.();
    } catch (e) {
      toast.error("Erro ao encerrar", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Encerrar captação</DialogTitle>
          <DialogDescription>
            Registre o resultado deste lead. A conversa no WhatsApp continua ativa nos dois casos.
          </DialogDescription>
        </DialogHeader>

        {/* Outcome switcher */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setOutcome("won")}
            className={`rounded-lg border p-3 text-left transition ${
              outcome === "won"
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                : "border-border hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center gap-2 font-semibold text-sm">
              <Trophy className="w-4 h-4" /> Ganho
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Virou cliente — gera venda + comissão
            </div>
          </button>
          <button
            type="button"
            onClick={() => setOutcome("lost")}
            className={`rounded-lg border p-3 text-left transition ${
              outcome === "lost"
                ? "border-rose-500 bg-rose-500/10 text-rose-800 dark:text-rose-300"
                : "border-border hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center gap-2 font-semibold text-sm">
              <XCircle className="w-4 h-4" /> Perdido
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Não fechou — arquiva sem comissão
            </div>
          </button>
        </div>

        {outcome === "won" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Produto</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Consumo médio (kWh)</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={pointsKwh}
                  onChange={(e) => setPointsKwh(e.target.value)}
                  placeholder="0"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Valor da conta (R$)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={billValue}
                  onChange={(e) => setBillValue(e.target.value)}
                  placeholder="0"
                  className="h-9"
                />
              </div>
            </div>
            {estimatedKwh > 0 && (
              <div className="text-[11px] text-muted-foreground">
                Pontuação registrada: <strong>{estimatedKwh} kWh</strong>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Origem do fechamento</Label>
              <RadioGroup
                value={sourceKind}
                onValueChange={(v) => {
                  setSourceKind(v as SourceKind);
                  setSourceId("");
                }}
                className="grid grid-cols-3 gap-2"
              >
                <label
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs cursor-pointer ${
                    sourceKind === "campaign" ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <RadioGroupItem value="campaign" />
                  Campanha Meta
                </label>
                <label
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs cursor-pointer ${
                    sourceKind === "partner" ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <RadioGroupItem value="partner" />
                  Parceiro
                </label>
                <label
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs cursor-pointer ${
                    sourceKind === "organic" ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <RadioGroupItem value="organic" />
                  Orgânico
                </label>
              </RadioGroup>

              {sourceKind === "campaign" && (
                <Select value={sourceId} onValueChange={setSourceId}>
                  <SelectTrigger className="h-9 mt-1">
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
                        Nenhuma campanha ativa
                      </div>
                    )}
                  </SelectContent>
                </Select>
              )}
              {sourceKind === "partner" && (
                <Select value={sourceId} onValueChange={setSourceId}>
                  <SelectTrigger className="h-9 mt-1">
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
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Observações (opcional)</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Detalhes do fechamento…"
              />
            </div>

            <div className="rounded-md border border-dashed border-emerald-500/30 bg-emerald-500/5 p-2.5 text-[11px] text-emerald-800 dark:text-emerald-300">
              💰 Comissão será apurada no Financeiro conforme a graduação do consultor
              {sourceKind === "partner" && sourceId
                ? " e o split do parceiro selecionado"
                : ""}
              .
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Motivo</Label>
              <Select value={lostReason} onValueChange={setLostReason}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOST_REASONS.map((r) => (
                    <SelectItem key={r.v} value={r.v}>
                      {r.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Detalhes (opcional)</Label>
              <Textarea
                rows={3}
                value={lostNotes}
                onChange={(e) => setLostNotes(e.target.value)}
                placeholder="O que aconteceu?"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={() => void run()}
            disabled={busy || (outcome === "won" && !productId)}
            className={
              outcome === "won"
                ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                : "bg-rose-600 hover:bg-rose-500 text-white"
            }
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Registrando…
              </>
            ) : outcome === "won" ? (
              "Registrar Ganho"
            ) : (
              "Marcar Perdido"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
