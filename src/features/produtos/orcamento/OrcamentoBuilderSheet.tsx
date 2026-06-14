// =============================================================================
// Orçamento — Builder (Sheet lateral editorial)
// =============================================================================
// Layout sidebar+conteúdo Sage & Cream com steps numerados, header serif e
// painel de prévia em tempo real. Toda a lógica original (catalogo, pricing,
// createProposal, WhatsApp) é mantida — só a apresentação muda.
// =============================================================================

import { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Copy, Send, Check, X } from "lucide-react";
import { useProducts } from "../catalogo/hooks";
import { PRODUCT_FAMILY_LABEL } from "../catalogo/types";
import {
  isQuotableProduct,
  resolveCommercialConfig,
  getSlugProfile,
  IGREEN_CLUB_BENEFITS,
} from "./catalog";
import { computeQuoteAmount } from "./pricing";
import { useCreateProposal } from "./hooks";
import { RecipientPicker, type RecipientSelection } from "./components/RecipientPicker";
import { sendWhatsAppMessage } from "@/services/messageSender";
import { pvSerif, pvBody, usePvFonts } from "../theme";

interface OrcamentoBuilderSheetProps {
  consultantId: string;
  instanceName?: string | null;
  isWhapi?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const PUBLIC_BASE = "https://igreen.cloud";

const STEPS = [
  { id: 1, label: "Produto" },
  { id: 2, label: "Cliente" },
  { id: 3, label: "Valor & envio" },
] as const;

export function OrcamentoBuilderSheet({
  consultantId,
  instanceName,
  isWhapi,
  open,
  onOpenChange,
}: OrcamentoBuilderSheetProps) {
  usePvFonts();
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

  // Só os produtos vendáveis por orçamento (allowlist por slug). Os demais
  // continuam no catálogo/banco, mas não aparecem no seletor do builder.
  const quotableProducts = useMemo(
    () => products.filter((p) => isQuotableProduct(p.slug)),
    [products],
  );

  const product = quotableProducts.find((p) => p.id === productId);
  // Config resolvida por slug: Solar × Livre (mesma família) se comportam
  // diferente, e cada produto carrega seu perfil comercial (headline, benefícios).
  const config = product ? resolveCommercialConfig(product.slug, product.family) : null;
  const profile = product ? getSlugProfile(product.slug) : null;
  const plan = config?.plans.find((p) => p.id === planId);

  const quote = useMemo(() => {
    if (!product || !config) return null;
    return computeQuoteAmount({
      family: product.family,
      slug: product.slug,
      plan,
      projectAmount: projectAmount ? Number(projectAmount) : undefined,
      installments: installments ? Number(installments) : undefined,
      currentBill: currentBill ? Number(currentBill) : undefined,
    });
  }, [product, config, plan, projectAmount, installments, currentBill]);

  // Mercado livre (Conexão Livre) não tem valor fechado — o envio é permitido
  // sem amount > 0, porque a proposta vende a solução, não um preço exato.
  const isMarketFree = config?.pricingMode === "market_free";

  const currentStep = !product ? 1 : !recipient ? 2 : 3;

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
    !!product &&
    !!recipient &&
    !!quote &&
    (isMarketFree || quote.amount > 0) &&
    !submitting;

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
      customerId: recipient.customerId ?? undefined,
      conversationStep: "orcamento_enviado",
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
      <SheetContent
        side="right"
        className={`w-full sm:max-w-3xl p-0 bg-[#f5f0e8] border-l border-[#a8c0a0]/30 text-[#1a2e1f] ${pvBody}`}
      >
        <div className="flex flex-col md:flex-row h-full">
          {/* Sidebar steps */}
          <aside className="md:w-56 bg-[#dce5d4] p-6 md:p-8 md:flex flex-col gap-8 hidden">
            <div>
              <span className="text-[10px] uppercase tracking-[0.25em] font-bold text-[#7d9b76]">
                iGreen
              </span>
              <p className={`text-2xl text-[#1a2e1f] leading-tight mt-1 ${pvSerif}`}>
                Novo<br />Orçamento
              </p>
            </div>
            <ol className="flex flex-col gap-5">
              {STEPS.map((step) => {
                const done = step.id < currentStep;
                const active = step.id === currentStep;
                return (
                  <li
                    key={step.id}
                    className={`flex items-center gap-3 transition-opacity ${
                      done || active ? "opacity-100" : "opacity-40"
                    }`}
                  >
                    <span
                      className={`w-7 h-7 rounded-full border flex items-center justify-center text-[11px] font-bold ${
                        done
                          ? "bg-[#7d9b76] border-[#7d9b76] text-white"
                          : active
                          ? "bg-[#1a2e1f] border-[#1a2e1f] text-white"
                          : "bg-transparent border-[#1a2e1f]"
                      }`}
                    >
                      {done ? <Check className="h-3.5 w-3.5" /> : step.id}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wider text-[#1a2e1f]">
                      {step.label}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-auto text-[10px] text-[#1a2e1f]/50 leading-relaxed">
              A venda só é criada quando o cliente aceita o orçamento na página pública.
            </div>
          </aside>

          {/* Conteúdo */}
          <div className="flex-1 overflow-y-auto p-6 md:p-10">
            <div className="flex items-start justify-between mb-8">
              <div>
                <span className="text-[10px] uppercase tracking-[0.25em] font-bold text-[#7d9b76] block mb-2">
                  Configurar
                </span>
                <h2 className={`text-3xl md:text-4xl text-[#1a2e1f] ${pvSerif}`}>
                  Novo orçamento
                </h2>
                <p className="text-sm text-[#1a2e1f]/60 mt-2 max-w-md">
                  Monte uma proposta profissional e envie por link único.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="text-[#1a2e1f]/40 hover:text-[#1a2e1f] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {createdLink ? (
              <div className="space-y-5">
                <div className="bg-white border-l-4 border-[#7d9b76] p-5">
                  <div className="flex items-center gap-2 text-[#7d9b76]">
                    <Check className="h-4 w-4" />
                    <span className="text-xs font-bold uppercase tracking-widest">
                      Orçamento criado
                    </span>
                  </div>
                  <p className="text-xs text-[#1a2e1f]/70 mt-3 break-all">{createdLink}</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex-1 inline-flex items-center justify-center gap-2 bg-white border border-[#a8c0a0]/40 text-[#1a2e1f] px-5 py-3 text-xs font-semibold uppercase tracking-widest hover:bg-[#dce5d4] transition-colors"
                  >
                    <Copy className="h-4 w-4" /> Copiar link
                  </button>
                  <button
                    type="button"
                    onClick={handleSendWhatsApp}
                    className="flex-1 inline-flex items-center justify-center gap-2 bg-[#1a2e1f] hover:bg-[#7d9b76] text-white px-5 py-3 text-xs font-semibold uppercase tracking-widest transition-colors"
                  >
                    <Send className="h-4 w-4" /> Enviar no WhatsApp
                  </button>
                </div>
                <button
                  type="button"
                  onClick={resetForm}
                  className="w-full text-xs text-[#1a2e1f]/60 hover:text-[#1a2e1f] underline underline-offset-4 py-2"
                >
                  Criar outro orçamento
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Form */}
                <div className="lg:col-span-3 space-y-5">
                  <Field label="Produto">
                    <Select value={productId} onValueChange={(v) => { setProductId(v); setPlanId(""); }}>
                      <SelectTrigger className="h-10 text-sm bg-white border-[#a8c0a0]/40 rounded-none">
                        <SelectValue placeholder="Escolha o produto" />
                      </SelectTrigger>
                      <SelectContent>
                        {quotableProducts.map((p) => (
                          <SelectItem key={p.id} value={p.id} className="text-sm">
                            {p.name} · {PRODUCT_FAMILY_LABEL[p.family]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {config && (
                      <p className="text-[11px] text-[#1a2e1f]/60 italic mt-1.5">
                        {config.commercialNote}
                      </p>
                    )}
                  </Field>

                  {product && (
                    <Field label="Destinatário">
                      <RecipientPicker
                        consultantId={consultantId}
                        value={recipient}
                        onChange={setRecipient}
                      />
                    </Field>
                  )}

                  {config?.pricingMode === "plan_monthly" && config.plans.length > 0 && (
                    <Field label="Plano">
                      <Select value={planId} onValueChange={setPlanId}>
                        <SelectTrigger className="h-10 text-sm bg-white border-[#a8c0a0]/40 rounded-none">
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
                    </Field>
                  )}

                  {config?.pricingMode === "project_once" && (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Valor do projeto">
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={projectAmount}
                          onChange={(e) => setProjectAmount(e.target.value)}
                          placeholder="Ex.: 18000"
                          className="h-10 text-sm bg-white border-[#a8c0a0]/40 rounded-none"
                        />
                      </Field>
                      <Field label="Parcelas">
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={installments}
                          onChange={(e) => setInstallments(e.target.value)}
                          placeholder="Ex.: 60"
                          className="h-10 text-sm bg-white border-[#a8c0a0]/40 rounded-none"
                        />
                      </Field>
                    </div>
                  )}

                  {config?.pricingMode === "savings_estimate" && (
                    <Field label="Conta de luz atual">
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={currentBill}
                        onChange={(e) => setCurrentBill(e.target.value)}
                        placeholder="Ex.: 350"
                        className="h-10 text-sm bg-white border-[#a8c0a0]/40 rounded-none"
                      />
                    </Field>
                  )}

                  <Field label="Mensagem (opcional)">
                    <Textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Uma mensagem pessoal..."
                      className="text-sm min-h-[70px] resize-none bg-white border-[#a8c0a0]/40 rounded-none"
                    />
                  </Field>

                  <Field label="Validade">
                    <Select value={validForDays} onValueChange={setValidForDays}>
                      <SelectTrigger className="h-10 text-sm bg-white border-[#a8c0a0]/40 rounded-none w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="3" className="text-sm">3 dias</SelectItem>
                        <SelectItem value="7" className="text-sm">7 dias</SelectItem>
                        <SelectItem value="15" className="text-sm">15 dias</SelectItem>
                        <SelectItem value="30" className="text-sm">30 dias</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                {/* Prévia em tempo real */}
                <aside className="lg:col-span-2 lg:sticky lg:top-0 self-start">
                  <div className="bg-[#1a2e1f] text-[#f5f0e8] p-6 space-y-4">
                    <span className="text-[10px] uppercase tracking-[0.25em] font-bold text-[#c9a84c]">
                      Prévia
                    </span>
                    {product ? (
                      <>
                        <h3 className={`text-2xl leading-tight ${pvSerif}`}>{product.name}</h3>
                        <p className="text-[11px] uppercase tracking-wider text-[#f5f0e8]/60">
                          {PRODUCT_FAMILY_LABEL[product.family]}
                        </p>
                        {recipient && (
                          <div className="pt-3 border-t border-white/10">
                            <p className="text-[10px] uppercase tracking-widest text-[#f5f0e8]/50">
                              Para
                            </p>
                            <p className="text-sm font-medium mt-0.5">{recipient.name}</p>
                            <p className="text-[11px] text-[#f5f0e8]/60">{recipient.phone}</p>
                          </div>
                        )}
                        {quote && (isMarketFree || quote.amount > 0) ? (
                          <div className="pt-3 border-t border-white/10">
                            <p className="text-[10px] uppercase tracking-widest text-[#f5f0e8]/50">
                              {quote.label}
                            </p>
                            {isMarketFree ? (
                              <p className={`text-3xl text-[#c9a84c] mt-1 ${pvSerif}`}>
                                até 30%
                                <span className="text-xs font-normal text-[#f5f0e8]/60 ml-1">
                                  de economia
                                </span>
                              </p>
                            ) : (
                              <p className={`text-3xl text-[#c9a84c] mt-1 ${pvSerif}`}>
                                {BRL(quote.amount)}
                                {quote.period === "month" && (
                                  <span className="text-xs font-normal text-[#f5f0e8]/60 ml-1">
                                    /mês
                                  </span>
                                )}
                              </p>
                            )}
                            {quote.details.length > 0 && (
                              <ul className="mt-3 space-y-1.5">
                                {quote.details.map((d, i) => (
                                  <li
                                    key={i}
                                    className="flex justify-between gap-2 text-[11px] text-[#f5f0e8]/70"
                                  >
                                    <span>{d.label}</span>
                                    <span className="text-[#f5f0e8] text-right">{d.value}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-[#f5f0e8]/40 italic pt-3 border-t border-white/10">
                            {isMarketFree
                              ? "Mercado livre: a proposta vende a solução (até 30%), sem valor fechado."
                              : "Preencha os valores para ver a prévia."}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-[#f5f0e8]/40 italic">
                        Escolha um produto para começar.
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={!canSubmit}
                    onClick={handleCreate}
                    className="w-full mt-4 inline-flex items-center justify-center gap-2 bg-[#7d9b76] hover:bg-[#1a2e1f] disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-3.5 text-xs font-semibold uppercase tracking-[0.18em] transition-colors"
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {submitting ? "Criando..." : "Criar orçamento"}
                  </button>
                </aside>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

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
