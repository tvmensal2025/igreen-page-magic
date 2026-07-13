// =============================================================================
// CRM Multiproduto — Registro manual de fechamento (Requisito 3)
// =============================================================================
// Dialog acionado pelo botão "Registrar venda" no Pipeline. Permite ao
// consultor criar uma venda à mão — para acordos que aconteceram fora do fluxo
// de orçamento por link (ex.: cliente fechou direto no WhatsApp ou
// pessoalmente).
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Search, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useProducts } from "../catalogo/hooks";
import { PRODUCT_FAMILY_LABEL } from "../catalogo/types";
import { useCreateSale } from "../vendas/hooks";
import { computePointsKwh } from "../vendas/scoring";
import { SALE_STATUS_LABEL, type CaptureData, type SaleStatus } from "../vendas/types";
import { formatBRLFromCents, reaisToCents } from "../lib/money";
import { CaptureForm } from "../captura/CaptureForm";
import { hasCaptureForm, validateCaptureForFamily } from "../captura/schemas";

const MANUAL_STAGES: SaleStatus[] = ["interesse", "negociando", "fechado"];

interface CustomerRow {
  id: string;
  name: string | null;
  phone_whatsapp: string;
}

interface RegistrarVendaDialogProps {
  consultantId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RegistrarVendaDialog({
  consultantId,
  open,
  onOpenChange,
}: RegistrarVendaDialogProps) {
  const { toast } = useToast();
  const { data: products = [] } = useProducts();
  const createSale = useCreateSale(consultantId);

  const [stage, setStage] = useState<SaleStatus>("interesse");
  const [productId, setProductId] = useState<string>("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [amountReais, setAmountReais] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [captureData, setCaptureData] = useState<CaptureData>({});

  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  useEffect(() => {
    if (open) {
      setStage("interesse");
      setProductId("");
      setCustomerId(null);
      setAmountReais("");
      setNotes("");
      setCustomerSearch("");
      setCaptureData({});
    }
  }, [open]);

  useEffect(() => {
    if (!open || !consultantId) return;
    let cancelled = false;
    setLoadingCustomers(true);
    (async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone_whatsapp")
        .eq("consultant_id", consultantId)
        .order("name", { ascending: true })
        .limit(500);
      if (!cancelled) {
        setCustomers((data as CustomerRow[]) || []);
        setLoadingCustomers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, consultantId]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(q) || c.phone_whatsapp.includes(q),
    );
  }, [customers, customerSearch]);

  const amountCents = useMemo(() => {
    const raw = amountReais.replace(/\./g, "").replace(",", ".").trim();
    if (!raw) return null;
    const reais = Number(raw);
    if (!Number.isFinite(reais) || reais < 0) return null;
    return reaisToCents(reais);
  }, [amountReais]);

  const product = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId],
  );

  const showCapture = !!product && hasCaptureForm(product.family);

  const onCaptureChange = useCallback((data: CaptureData) => {
    setCaptureData(data);
  }, []);

  const canSubmit = !!productId && !createSale.isPending;

  const handleSubmit = async () => {
    if (!productId || !product) return;

    const requireCapture = stage === "fechado" && hasCaptureForm(product.family);
    const validation = validateCaptureForFamily(product.family, captureData, {
      requireCapture,
    });
    if (!validation.ok) {
      toast({
        title: "Dados de captura incompletos",
        description: validation.message,
        variant: "destructive",
      });
      return;
    }

    const normalizedCapture = (validation.data as CaptureData) ?? captureData;

    const placas = normalizedCapture as { consumo_kwh?: number };
    const telecom = normalizedCapture as { portabilidade?: boolean };
    const pointsKwh = computePointsKwh(product.scoringRule, {
      kwh: typeof placas.consumo_kwh === "number" ? placas.consumo_kwh : undefined,
      units: 1,
      captureData: normalizedCapture,
      ...(typeof telecom.portabilidade === "boolean"
        ? { captureData: normalizedCapture }
        : {}),
    });

    try {
      await createSale.mutateAsync({
        consultantId,
        productId,
        customerId: customerId ?? null,
        status: stage,
        amountCents,
        notes: notes.trim() || null,
        captureData: normalizedCapture,
        pointsKwh,
      });
      toast({
        title: "Venda registrada!",
        description: `Iniciada em "${SALE_STATUS_LABEL[stage]}".`,
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Erro ao registrar venda",
        description: err instanceof Error ? err.message : "Falha desconhecida",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar venda</DialogTitle>
          <DialogDescription>
            Registre à mão um negócio que aconteceu fora do fluxo de orçamento
            por link (ex.: fechado direto no WhatsApp ou pessoalmente).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Etapa inicial">
            <Select value={stage} onValueChange={(v) => setStage(v as SaleStatus)}>
              <SelectTrigger className="h-10 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_STAGES.map((s) => (
                  <SelectItem key={s} value={s} className="text-sm">
                    {SALE_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Produto *">
            <Select
              value={productId}
              onValueChange={(id) => {
                setProductId(id);
                setCaptureData({});
              }}
            >
              <SelectTrigger className="h-10 text-sm">
                <SelectValue placeholder="Escolha o produto" />
              </SelectTrigger>
              <SelectContent className="max-h-[280px]">
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-sm">
                    {p.name} · {PRODUCT_FAMILY_LABEL[p.family]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {showCapture && product && (
            <Field
              label={
                stage === "fechado"
                  ? "Dados de captura *"
                  : "Dados de captura (opcional)"
              }
            >
              <div className="rounded-lg border border-pv-mid/30 p-3 bg-pv-bg/40">
                <CaptureForm
                  key={product.id}
                  family={product.family}
                  embedded
                  onChange={onCaptureChange}
                  onSubmit={onCaptureChange}
                />
              </div>
            </Field>
          )}

          <Field label="Cliente (opcional)">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Buscar por nome ou telefone..."
                className="h-9 text-sm pl-8"
              />
            </div>
            <div className="mt-2 max-h-[180px] overflow-y-auto border rounded-md">
              {loadingCustomers && (
                <p className="text-[11px] text-muted-foreground text-center py-4">
                  Carregando...
                </p>
              )}
              {!loadingCustomers && filteredCustomers.length === 0 && (
                <p className="text-[11px] text-muted-foreground text-center py-4">
                  Nenhum cliente encontrado
                </p>
              )}
              <div className="p-1 space-y-0.5">
                {!loadingCustomers && filteredCustomers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCustomerId(null)}
                    className={`w-full text-left p-1.5 rounded text-xs transition-colors ${
                      customerId === null
                        ? "bg-primary/15 font-medium"
                        : "hover:bg-secondary/50 text-muted-foreground"
                    }`}
                  >
                    Sem cliente associado
                  </button>
                )}
                {filteredCustomers.map((c) => {
                  const selected = customerId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCustomerId(c.id)}
                      className={`w-full text-left flex items-center gap-2 p-1.5 rounded transition-colors ${
                        selected ? "bg-primary/15" : "hover:bg-secondary/50"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">
                          {c.name || "Sem nome"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {c.phone_whatsapp}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </Field>

          <Field label="Valor (opcional)">
            <Input
              inputMode="decimal"
              value={amountReais}
              onChange={(e) => setAmountReais(e.target.value)}
              placeholder="Ex.: 1500,00"
              className="h-10 text-sm"
            />
            {amountCents !== null && amountCents > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Valor: {formatBRLFromCents(amountCents)}
              </p>
            )}
          </Field>

          <Field label="Observações (opcional)">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detalhes do acordo, contexto, próximos passos..."
              rows={3}
              className="text-sm resize-none"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {createSale.isPending && (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            )}
            Registrar venda
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-ink/60 block">
        {label}
      </label>
      {children}
    </div>
  );
}
