// =============================================================================
// CRM Multiproduto — Registro manual de fechamento (Requisito 3)
// =============================================================================
// Dialog acionado pelo botão "Registrar venda" no Pipeline. Permite ao
// consultor criar uma venda à mão — para acordos que aconteceram fora do fluxo
// de orçamento por link (ex.: cliente fechou direto no WhatsApp ou
// pessoalmente).
//
// Campos:
//   - Etapa inicial: Interesse | Negociando | Fechado (NÃO permite "Perdido"
//     na criação manual — só faz sentido mover para perdido depois).
//   - Produto (obrigatório): escolhido do catálogo (useProducts).
//   - Cliente (opcional): associado pela base do consultor.
//   - Valor (em reais; convertido para centavos com reaisToCents ao salvar).
//   - Observações (opcional).
//
// Reusa useCreateSale/createSale (já preparados para amountCents, status com o
// novo enum e default "interesse"). Valores sempre em centavos no banco; a UI
// usa reaisToCents ao salvar e formatBRLFromCents na prévia.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
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
import { SALE_STATUS_LABEL, type CaptureData, type SaleStatus } from "../vendas/types";
import { formatBRLFromCents, reaisToCents } from "../lib/money";
import { validateCaptureForFamily } from "../captura/schemas";

// Etapas permitidas na criação manual (Requisito 3.2): sem "perdido".
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

  // Estado do formulário.
  const [stage, setStage] = useState<SaleStatus>("interesse");
  const [productId, setProductId] = useState<string>("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [amountReais, setAmountReais] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // Seletor de cliente (opcional) — busca na base do consultor.
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  // Reseta o formulário sempre que o diálogo é aberto.
  useEffect(() => {
    if (open) {
      setStage("interesse");
      setProductId("");
      setCustomerId(null);
      setAmountReais("");
      setNotes("");
      setCustomerSearch("");
    }
  }, [open]);

  // Carrega os clientes da base do consultor quando o diálogo abre.
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

  // Converte o valor digitado (reais) para centavos. Aceita vírgula ou ponto.
  // Retorna null quando vazio/ inválido (valor é opcional).
  const amountCents = useMemo(() => {
    const raw = amountReais.replace(/\./g, "").replace(",", ".").trim();
    if (!raw) return null;
    const reais = Number(raw);
    if (!Number.isFinite(reais) || reais < 0) return null;
    return reaisToCents(reais);
  }, [amountReais]);

  // Só permite salvar com produto escolhido (Requisito 3.1).
  const canSubmit = !!productId && !createSale.isPending;

  const handleSubmit = async () => {
    if (!productId) return;

    // Validação leve de captura por família (Requisito 7.2). Hoje este form
    // não coleta campos de captura por família, então `captureData` fica
    // vazio e a validação passa direto (no-op). A guarda já está ligada: se
    // no futuro adicionarmos campos de captura aqui, basta preencher
    // `captureData` que a validação Zod da família passa a valer, exibindo
    // erro amigável em pt-BR antes de salvar.
    const product = products.find((p) => p.id === productId);
    const captureData: CaptureData = {};
    if (product) {
      const validation = validateCaptureForFamily(product.family, captureData);
      if (!validation.ok) {
        toast({
          title: "Dados de captura incompletos",
          description: validation.message,
          variant: "destructive",
        });
        return;
      }
    }

    try {
      await createSale.mutateAsync({
        consultantId,
        productId,
        customerId: customerId ?? null,
        status: stage,
        amountCents,
        notes: notes.trim() || null,
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar venda</DialogTitle>
          <DialogDescription>
            Registre à mão um negócio que aconteceu fora do fluxo de orçamento
            por link (ex.: fechado direto no WhatsApp ou pessoalmente).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Etapa inicial (sem "perdido") */}
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

          {/* Produto (obrigatório) */}
          <Field label="Produto *">
            <Select value={productId} onValueChange={setProductId}>
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

          {/* Cliente (opcional) */}
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
                {/* Opção de não associar nenhum cliente */}
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

          {/* Valor (reais) */}
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

          {/* Observações (opcional) */}
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

// Rótulo de campo padronizado (mesmo visual do builder de orçamento).
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#1a2e1f]/60 block">
        {label}
      </label>
      {children}
    </div>
  );
}
