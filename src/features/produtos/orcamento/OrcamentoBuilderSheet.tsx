// =============================================================================
// Orçamento — Builder (Sheet lateral)
// =============================================================================
// Painel que monta o orçamento e gera o link público profissional. Abre pelo
// botão na topbar (slot extra). Fluxo:
//   1. escolher produto (catálogo)
//   2. escolher destinatário (base do consultor ou número avulso)
//   3. montar o valor conforme a família (plano / projeto / economia estimada)
//   4. mensagem + prazo de validade
//   5. criar proposta (status 'sent') → gera link → envia no WhatsApp
//
// A venda só nasce quando o cliente aceita (na página pública). Aqui só cria a
// proposta. Não toca em sales, CRM nem nas demais abas.
// =============================================================================

import { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Copy, Send, Check } from "lucide-react";
import { useProducts } from "../catalogo/hooks";
import { PRODUCT_FAMILY_LABEL } from "../catalogo/types";
import { getCommercialConfig } from "./catalog";
import { computeQuoteAmount } from "./pricing";
import { useCreateProposal } from "./hooks";
import { RecipientPicker, type RecipientSelection } from "./components/RecipientPicker";
import { sendWhatsAppMessage } from "@/services/messageSender";

interface OrcamentoBuilderSheetProps {
  consultantId: string;
  instanceName?: string | null;
  isWhapi?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const PUBLIC_BASE = "https://igreen.cloud";

export function OrcamentoBuilderSheet({
  consultantId,
  instanceName,
  isWhapi,
  open,
  onOpenChange,
}: OrcamentoBuilderSheetProps) {
  const { toast } = useToast();
  const { data: products = [] } = useProducts();
  const createProposal = useCreateProposal(consultantId);

  const [productId, setProductId] = useState<string>("");
  const [recipient, setRecipient] = useState<RecipientSelection | null>(null);
  const [planId, setPlanId] = useState<string>("");
  const [projectAmount, setProjectAmount] = useState<string>("");
  const [installments, setInstallments] = useState<string>("");
  const [currentBill, setCurrentBill] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [validForDays, setValidForDays] = useState<string>("7");
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const product = products.find((p) => p.id === productId);
  const config = product ? getCommercialConfig(product.family) : null;
  const plan = config?.plans.find((p) => p.id === planId);

  const quote = useMemo(() => {
    if (!product || !config) return null;
    return computeQuoteAmount({
      family: product.family,
      plan,
      projectAmount: projectAmount ? Number(projectAmount) : undefined,
      installments: installments ? Number(installments) : undefined,
      currentBill: currentBill ? Number(currentBill) : undefined,
    });
  }, [product, config, plan, projectAmount, installments, currentBill]);

  const resetForm = () => {
    setProductId("");
    setRecipient(null);
    setPlanId("");
    setProjectAmount("");
    setInstallments("");
    setCurrentBill("");
    setMessage("");
    setValidForDays("7");
    setCreatedLink(null);
  };

  const canSubmit =
    !!product && !!recipient && !!quote && quote.amount > 0 && !submitting;

  const handleCreate = async () => {
    if (!product || !recipient || !quote) return;
    setSubmitting(true);
    try {
      const proposal = await createProposal.mutateAsync({
        consultantId,
        productId: product.id,
        customerId: recipient.customerId ?? null,
        recipientName: recipient.name,
        recipientPhone: recipient.phone,
        amount: quote.amount,
        amountPeriod: quote.period,
        lineItems: quote.details,
        message: message.trim() || null,
        validForDays: Number(validForDays) || 7,
      });

      const link = `${PUBLIC_BASE}/proposta/${proposal.publicToken}`;
      setCreatedLink(link);
      toast({ title: "Orçamento criado!", description: "Link profissional gerado." });
    } catch (err) {
      toast({
        title: "Erro ao criar orçamento",
        description: err instanceof Error ? err.message : "Falha desconhecida",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendWhatsApp = async () => {
    if (!createdLink || !recipient || !product) return;
    if (!instanceName) {
      toast({ title: "WhatsApp não conectado", variant: "destructive" });
      return;
    }
    const text =
      `Olá ${recipient.name}! 👋\n\n` +
      `Preparei um orçamento de *${product.name}* para você.\n` +
      `${quote ? `${quote.label}: *${BRL(quote.amount)}*${quote.period === "month" ? "/mês" : ""}\n` : ""}` +
      `\nVeja os detalhes e responda por aqui:\n${createdLink}`;

    const result = await sendWhatsAppMessage({
      instanceName,
      phone: recipient.phone,
      mediaCategory: "text",
      text,
      isWhapi,
    });

    if (result.status === "sent" || result.status === "pending") {
      toast({ title: "Orçamento enviado no WhatsApp!" });
      onOpenChange(false);
      resetForm();
    } else {
      toast({
        title: "Não foi possível enviar",
        description: result.error || "Tente copiar o link e enviar manualmente.",
        variant: "destructive",
      });
    }
  };

  const handleCopy = () => {
    if (!createdLink) return;
    navigator.clipboard.writeText(createdLink);
    toast({ title: "Link copiado!" });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Novo orçamento</SheetTitle>
          <SheetDescription>
            Monte uma proposta profissional e envie por link. A venda só é criada quando o
            cliente aceita.
          </SheetDescription>
        </SheetHeader>

        {createdLink ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="flex items-center gap-2 text-emerald-500">
                <Check className="h-4 w-4" />
                <span className="text-sm font-semibold">Orçamento criado</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2 break-all">{createdLink}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 gap-2" onClick={handleCopy}>
                <Copy className="h-4 w-4" /> Copiar link
              </Button>
              <Button className="flex-1 gap-2" onClick={handleSendWhatsApp}>
                <Send className="h-4 w-4" /> Enviar no WhatsApp
              </Button>
            </div>
            <Button variant="ghost" className="w-full" onClick={resetForm}>
              Criar outro orçamento
            </Button>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            {/* Produto */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Produto</label>
              <Select value={productId} onValueChange={(v) => { setProductId(v); setPlanId(""); }}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Escolha o produto" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-sm">
                      {p.name} · {PRODUCT_FAMILY_LABEL[p.family]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {config && (
                <p className="text-[11px] text-muted-foreground">{config.commercialNote}</p>
              )}
            </div>

            {/* Destinatário */}
            {product && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Destinatário</label>
                <RecipientPicker
                  consultantId={consultantId}
                  value={recipient}
                  onChange={setRecipient}
                />
              </div>
            )}

            {/* Valor por família */}
            {config?.pricingMode === "plan_monthly" && config.plans.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Plano</label>
                <Select value={planId} onValueChange={setPlanId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Escolha o plano" />
                  </SelectTrigger>
                  <SelectContent>
                    {config.plans.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-sm">
                        {p.label} — {BRL(p.price)}/mês
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {config?.pricingMode === "project_once" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Valor do projeto</label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={projectAmount}
                    onChange={(e) => setProjectAmount(e.target.value)}
                    placeholder="Ex.: 18000"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Parcelas</label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={installments}
                    onChange={(e) => setInstallments(e.target.value)}
                    placeholder="Ex.: 60"
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            )}

            {config?.pricingMode === "savings_estimate" && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Conta de luz atual</label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={currentBill}
                  onChange={(e) => setCurrentBill(e.target.value)}
                  placeholder="Ex.: 350"
                  className="h-9 text-sm"
                />
              </div>
            )}

            {/* Preview do valor */}
            {quote && quote.amount > 0 && (
              <div className="rounded-lg border border-border/60 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{quote.label}</span>
                  <span className="text-base font-bold text-foreground">
                    {BRL(quote.amount)}
                    {quote.period === "month" && (
                      <span className="text-[11px] font-normal text-muted-foreground">/mês</span>
                    )}
                  </span>
                </div>
                {quote.details.length > 0 && (
                  <div className="space-y-1 border-t border-border/40 pt-2">
                    {quote.details.map((d, i) => (
                      <div key={i} className="flex items-start justify-between gap-2 text-[11px]">
                        <span className="text-muted-foreground">{d.label}</span>
                        <span className="text-foreground text-right">{d.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Mensagem + prazo */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Mensagem (opcional)</label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Uma mensagem pessoal para acompanhar o orçamento..."
                className="text-sm min-h-[70px] resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Validade</label>
              <Select value={validForDays} onValueChange={setValidForDays}>
                <SelectTrigger className="h-9 text-sm w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3" className="text-sm">3 dias</SelectItem>
                  <SelectItem value="7" className="text-sm">7 dias</SelectItem>
                  <SelectItem value="15" className="text-sm">15 dias</SelectItem>
                  <SelectItem value="30" className="text-sm">30 dias</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                O orçamento expira automaticamente após o prazo.
              </p>
            </div>

            <Button className="w-full gap-2" disabled={!canSubmit} onClick={handleCreate}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitting ? "Criando..." : "Criar orçamento"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
