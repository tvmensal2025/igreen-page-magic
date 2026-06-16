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
import { Loader2, Copy, Send, Check, X, Plus } from "lucide-react";
import { useProducts } from "../catalogo/hooks";
import { PRODUCT_FAMILY_LABEL } from "../catalogo/types";
import {
  isQuotableProduct,
  resolveCommercialConfig,
  getSlugProfile,
  IGREEN_CLUB_BENEFITS,
} from "./catalog";
import { computeQuoteAmount, paymentOptionsToLineItems } from "./pricing";
import { useCreateProposal } from "./hooks";
import {
  FINANCING_BANKS,
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
  type PaymentOption,
} from "./types";
import { RecipientPicker, type RecipientSelection } from "./components/RecipientPicker";
import { sendWhatsAppMessage } from "@/services/messageSender";
import { formatBRLFromCents, reaisToCents } from "../lib/money";
import { pvSerif, pvBody, usePvFonts } from "../theme";

interface OrcamentoBuilderSheetProps {
  consultantId: string;
  instanceName?: string | null;
  isWhapi?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Formata centavos (inteiro) como moeda BRL na camada de apresentação.
const BRL = (cents: number) => formatBRLFromCents(cents);
const PUBLIC_BASE = "https://igreen.cloud";

// Converte as formas de pagamento digitadas em reais para centavos antes de
// montar os line items (paymentOptionsToLineItems espera valores em centavos).
function paymentsToCents(options: PaymentOption[]): PaymentOption[] {
  return options.map((opt) => ({
    ...opt,
    total: opt.total != null ? reaisToCents(opt.total) : opt.total,
    installmentValue:
      opt.installmentValue != null ? reaisToCents(opt.installmentValue) : opt.installmentValue,
  }));
}

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
  // Telecom: cliente faz portabilidade do número? (true por padrão — ganha +5GB).
  const [portabilidade, setPortabilidade] = useState<boolean>(true);
  const [projectAmount, setProjectAmount] = useState<string>("");
  const [currentBill, setCurrentBill] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [validForDays, setValidForDays] = useState<string>("7");
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Formas de pagamento (apenas project_once / Placas): consultor digita
  // à vista, cartão e/ou financiamento (banco, parcelas, valor, juros).
  const [payments, setPayments] = useState<PaymentOption[]>([]);

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
      // Telecom: passa a portabilidade para escolher o preço correto.
      portabilidade: product.family === "telecom" ? portabilidade : undefined,
      // Entradas digitadas em reais → centavos para o cálculo.
      projectAmountCents: projectAmount ? reaisToCents(Number(projectAmount)) : undefined,
      currentBillCents: currentBill ? reaisToCents(Number(currentBill)) : undefined,
    });
  }, [product, config, plan, portabilidade, projectAmount, currentBill]);

  // Mercado livre (Conexão Livre) não tem valor fechado — o envio é permitido
  // sem amount > 0, porque a proposta vende a solução, não um preço exato.
  const isMarketFree = config?.pricingMode === "market_free";
  // Placas (venda do sistema): habilita o editor de formas de pagamento.
  const isProjectOnce = config?.pricingMode === "project_once";

  const currentStep = !product ? 1 : !recipient ? 2 : 3;

  const resetForm = () => {
    setProductId("");
    setRecipient(null);
    setPlanId("");
    setPortabilidade(true);
    setProjectAmount("");
    setCurrentBill("");
    setMessage("");
    setValidForDays("7");
    setCreatedLink(null);
    setPayments([]);
  };

  const canSubmit =
    !!product &&
    !!recipient &&
    !!quote &&
    (isMarketFree || quote.amountCents > 0) &&
    !submitting;

  const handleCreate = async () => {
    if (!product || !recipient || !quote) return;
    setSubmitting(true);
    try {
      // Detalhes do cálculo + formas de pagamento (Placas) num só line_items.
      // As formas de pagamento são digitadas em reais → convertemos para centavos.
      const paymentItems = isProjectOnce
        ? paymentOptionsToLineItems(paymentsToCents(payments))
        : [];
      const lineItems = [...quote.details, ...paymentItems];

      const proposal = await createProposal.mutateAsync({
        consultantId,
        productId: product.id,
        customerId: recipient.customerId ?? null,
        recipientName: recipient.name,
        recipientPhone: recipient.phone,
        amountCents: quote.amountCents,
        amountPeriod: quote.period,
        lineItems,
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

    // Resumo das formas de pagamento (Placas) na mensagem do WhatsApp.
    const validPayments = isProjectOnce
      ? paymentOptionsToLineItems(paymentsToCents(payments))
      : [];
    const paymentSummary =
      validPayments.length > 0
        ? `\n💳 Formas de pagamento:\n` +
          validPayments
            .map((p) => {
              const title = p.method ? PAYMENT_METHOD_LABEL[p.method] : p.label;
              const extra = p.bank ? ` (${p.bank})` : "";
              return `• ${title}: ${p.value}${extra}`;
            })
            .join("\n") +
          "\n"
        : "";

    const text =
      `Olá ${recipient.name}! 👋\n\n` +
      `Preparei um orçamento de *${product.name}* para você.\n` +
      `${quote ? `${quote.label}: *${BRL(quote.amountCents)}*${quote.period === "month" ? "/mês" : ""}\n` : ""}` +
      `${paymentSummary}` +
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
        className={`pv-scope w-full sm:max-w-3xl p-0 bg-pv-bg border-l border-pv-mid/30 text-pv-ink ${pvBody}`}
      >
        <div className="flex flex-col md:flex-row h-full">
          {/* Sidebar steps */}
          <aside className="md:w-56 bg-pv-surface p-6 md:p-8 md:flex flex-col gap-8 hidden">
            <div>
              <span className="text-[10px] uppercase tracking-[0.25em] font-bold text-pv-accent">
                iGreen
              </span>
              <p className={`text-2xl text-pv-ink leading-tight mt-1 ${pvSerif}`}>
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
                          ? "bg-pv-accent border-pv-accent text-white"
                          : active
                          ? "bg-pv-ink border-pv-ink text-white"
                          : "bg-transparent border-pv-ink"
                      }`}
                    >
                      {done ? <Check className="h-3.5 w-3.5" /> : step.id}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wider text-pv-ink">
                      {step.label}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-auto text-[10px] text-pv-ink/50 leading-relaxed">
              A venda só é criada quando o cliente aceita o orçamento na página pública.
            </div>
          </aside>

          {/* Conteúdo */}
          <div className="flex-1 overflow-y-auto p-6 md:p-10">
            <div className="flex items-start justify-between mb-8">
              <div>
                <span className="text-[10px] uppercase tracking-[0.25em] font-bold text-pv-accent block mb-2">
                  Configurar
                </span>
                <h2 className={`text-3xl md:text-4xl text-pv-ink ${pvSerif}`}>
                  Novo orçamento
                </h2>
                <p className="text-sm text-pv-ink/60 mt-2 max-w-md">
                  Monte uma proposta profissional e envie por link único.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="text-pv-ink/40 hover:text-pv-ink transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {createdLink ? (
              <div className="space-y-5">
                <div className="bg-white border-l-4 border-pv-accent p-5">
                  <div className="flex items-center gap-2 text-pv-accent">
                    <Check className="h-4 w-4" />
                    <span className="text-xs font-bold uppercase tracking-widest">
                      Orçamento criado
                    </span>
                  </div>
                  <p className="text-xs text-pv-ink/70 mt-3 break-all">{createdLink}</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex-1 inline-flex items-center justify-center gap-2 bg-white border border-pv-mid/40 text-pv-ink px-5 py-3 text-xs font-semibold uppercase tracking-widest hover:bg-pv-surface transition-colors"
                  >
                    <Copy className="h-4 w-4" /> Copiar link
                  </button>
                  <button
                    type="button"
                    onClick={handleSendWhatsApp}
                    className="flex-1 inline-flex items-center justify-center gap-2 bg-pv-ink hover:bg-pv-accent text-white px-5 py-3 text-xs font-semibold uppercase tracking-widest transition-colors"
                  >
                    <Send className="h-4 w-4" /> Enviar no WhatsApp
                  </button>
                </div>
                <button
                  type="button"
                  onClick={resetForm}
                  className="w-full text-xs text-pv-ink/60 hover:text-pv-ink underline underline-offset-4 py-2"
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
                      <SelectTrigger className="h-10 text-sm bg-white border-pv-mid/40 rounded-none">
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
                      <p className="text-[11px] text-pv-ink/60 italic mt-1.5">
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
                        <SelectTrigger className="h-10 text-sm bg-white border-pv-mid/40 rounded-none">
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

                  {/* Telecom: com/sem portabilidade. Com portabilidade o cliente
                      ganha +5GB; sem portabilidade usa o preço alternativo do plano. */}
                  {product?.family === "telecom" && config?.pricingMode === "plan_monthly" && (
                    <Field label="Portabilidade do número">
                      <Select
                        value={portabilidade ? "com" : "sem"}
                        onValueChange={(v) => setPortabilidade(v === "com")}
                      >
                        <SelectTrigger className="h-10 text-sm bg-white border-pv-mid/40 rounded-none w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="com" className="text-sm">
                            Com portabilidade (+5GB)
                          </SelectItem>
                          <SelectItem value="sem" className="text-sm">
                            Sem portabilidade
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}

                  {config?.pricingMode === "project_once" && (
                    <>
                      <Field label="Valor do projeto">
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={projectAmount}
                          onChange={(e) => setProjectAmount(e.target.value)}
                          placeholder="Ex.: 30426,66"
                          className="h-10 text-sm bg-white border-pv-mid/40 rounded-none"
                        />
                      </Field>

                      <PaymentEditor
                        projectAmount={projectAmount ? Number(projectAmount) : 0}
                        payments={payments}
                        onChange={setPayments}
                      />
                    </>
                  )}

                  {config?.pricingMode === "savings_estimate" && (
                    <Field label="Conta de luz atual">
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={currentBill}
                        onChange={(e) => setCurrentBill(e.target.value)}
                        placeholder="Ex.: 350"
                        className="h-10 text-sm bg-white border-pv-mid/40 rounded-none"
                      />
                    </Field>
                  )}

                  <Field label="Mensagem (opcional)">
                    <Textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Uma mensagem pessoal..."
                      className="text-sm min-h-[70px] resize-none bg-white border-pv-mid/40 rounded-none"
                    />
                  </Field>

                  <Field label="Validade">
                    <Select value={validForDays} onValueChange={setValidForDays}>
                      <SelectTrigger className="h-10 text-sm bg-white border-pv-mid/40 rounded-none w-full">
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
                  <div className="bg-pv-ink text-pv-bg p-6 space-y-4">
                    <span className="text-[10px] uppercase tracking-[0.25em] font-bold text-pv-gold">
                      Prévia
                    </span>
                    {product ? (
                      <>
                        <h3 className={`text-2xl leading-tight ${pvSerif}`}>{product.name}</h3>
                        <p className="text-[11px] uppercase tracking-wider text-pv-bg/60">
                          {PRODUCT_FAMILY_LABEL[product.family]}
                        </p>
                        {recipient && (
                          <div className="pt-3 border-t border-white/10">
                            <p className="text-[10px] uppercase tracking-widest text-pv-bg/50">
                              Para
                            </p>
                            <p className="text-sm font-medium mt-0.5">{recipient.name}</p>
                            <p className="text-[11px] text-pv-bg/60">{recipient.phone}</p>
                          </div>
                        )}
                        {quote && (isMarketFree || quote.amountCents > 0) ? (
                          <div className="pt-3 border-t border-white/10">
                            <p className="text-[10px] uppercase tracking-widest text-pv-bg/50">
                              {quote.label}
                            </p>
                            {isMarketFree ? (
                              <p className={`text-3xl text-pv-gold mt-1 ${pvSerif}`}>
                                até 30%
                                <span className="text-xs font-normal text-pv-bg/60 ml-1">
                                  de economia
                                </span>
                              </p>
                            ) : (
                              <p className={`text-3xl text-pv-gold mt-1 ${pvSerif}`}>
                                {BRL(quote.amountCents)}
                                {quote.period === "month" && (
                                  <span className="text-xs font-normal text-pv-bg/60 ml-1">
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
                                    className="flex justify-between gap-2 text-[11px] text-pv-bg/70"
                                  >
                                    <span>{d.label}</span>
                                    <span className="text-pv-bg text-right">{d.value}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {isProjectOnce && payments.length > 0 && (
                              <div className="mt-3 pt-3 border-t border-white/10">
                                <p className="text-[10px] uppercase tracking-widest text-pv-bg/50 mb-1.5">
                                  Formas de pagamento
                                </p>
                                <ul className="space-y-1.5">
                                  {paymentOptionsToLineItems(paymentsToCents(payments)).map((p, i) => (
                                    <li
                                      key={i}
                                      className="flex justify-between gap-2 text-[11px] text-pv-bg/70"
                                    >
                                      <span>
                                        {p.method ? PAYMENT_METHOD_LABEL[p.method] : p.label}
                                        {p.bank ? ` · ${p.bank}` : ""}
                                      </span>
                                      <span className="text-pv-gold text-right">{p.value}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-pv-bg/40 italic pt-3 border-t border-white/10">
                            {isMarketFree
                              ? "Mercado livre: a proposta vende a solução (até 30%), sem valor fechado."
                              : "Preencha os valores para ver a prévia."}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-pv-bg/40 italic">
                        Escolha um produto para começar.
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={!canSubmit}
                    onClick={handleCreate}
                    className="w-full mt-4 inline-flex items-center justify-center gap-2 bg-pv-accent hover:bg-pv-ink disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-3.5 text-xs font-semibold uppercase tracking-[0.18em] transition-colors"
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
      <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-ink/60 block">
        {label}
      </label>
      {children}
    </div>
  );
}

// ===========================================================================
// Editor de formas de pagamento (Placas)
// ===========================================================================
// O consultor adiciona quantas opções quiser: à vista, cartão (Nx) e
// financiamento (banco + Nx + valor da parcela + juros). Tudo digitado por ele
// — nada é calculado automaticamente, para refletir a simulação real do banco.
function PaymentEditor({
  projectAmount,
  payments,
  onChange,
}: {
  projectAmount: number;
  payments: PaymentOption[];
  onChange: (next: PaymentOption[]) => void;
}) {
  const addOption = (method: PaymentMethod) => {
    const base: PaymentOption = {
      method,
      total: method === "cash" ? (projectAmount || null) : null,
      bank: method === "financing" ? FINANCING_BANKS[0] : null,
      installments: method === "cash" ? null : 12,
      installmentValue: null,
      interest: null,
      highlight: false,
    };
    onChange([...payments, base]);
  };

  const update = (idx: number, patch: Partial<PaymentOption>) => {
    onChange(payments.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const remove = (idx: number) => {
    onChange(payments.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-ink/60 block">
          Formas de pagamento
        </label>
        <div className="flex gap-1.5">
          {(["cash", "card", "financing"] as PaymentMethod[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => addOption(m)}
              className="inline-flex items-center gap-1 bg-white border border-pv-mid/50 text-pv-ink px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider hover:bg-pv-surface transition-colors"
            >
              <Plus className="h-3 w-3" /> {PAYMENT_METHOD_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {payments.length === 0 ? (
        <p className="text-[11px] text-pv-ink/50 italic">
          Adicione à vista, cartão ou financiamento. Você digita banco, parcelas, valor e juros.
        </p>
      ) : (
        <div className="space-y-3">
          {payments.map((opt, idx) => (
            <div key={idx} className="bg-white border border-pv-mid/40 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-pv-accent">
                  {PAYMENT_METHOD_LABEL[opt.method]}
                </span>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-[10px] text-pv-ink/60 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={opt.highlight ?? false}
                      onChange={(e) => update(idx, { highlight: e.target.checked })}
                      className="accent-pv-accent"
                    />
                    Destaque
                  </label>
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    className="text-pv-ink/40 hover:text-red-600 transition-colors"
                    aria-label="Remover forma de pagamento"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {opt.method === "cash" ? (
                <Input
                  type="number"
                  inputMode="numeric"
                  value={opt.total ?? ""}
                  onChange={(e) =>
                    update(idx, { total: e.target.value ? Number(e.target.value) : null })
                  }
                  placeholder="Valor à vista (ex.: 28900)"
                  className="h-9 text-sm bg-pv-bg border-pv-mid/40 rounded-none"
                />
              ) : (
                <div className="space-y-2">
                  {opt.method === "financing" && (
                    <Select
                      value={opt.bank ?? ""}
                      onValueChange={(v) => update(idx, { bank: v })}
                    >
                      <SelectTrigger className="h-9 text-sm bg-pv-bg border-pv-mid/40 rounded-none">
                        <SelectValue placeholder="Banco / financeira" />
                      </SelectTrigger>
                      <SelectContent>
                        {FINANCING_BANKS.map((b) => (
                          <SelectItem key={b} value={b} className="text-sm">
                            {b}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={opt.installments ?? ""}
                      onChange={(e) =>
                        update(idx, {
                          installments: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      placeholder="Parcelas (ex.: 60)"
                      className="h-9 text-sm bg-pv-bg border-pv-mid/40 rounded-none"
                    />
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={opt.installmentValue ?? ""}
                      onChange={(e) =>
                        update(idx, {
                          installmentValue: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      placeholder="Valor da parcela"
                      className="h-9 text-sm bg-pv-bg border-pv-mid/40 rounded-none"
                    />
                  </div>
                  <Input
                    type="text"
                    value={opt.interest ?? ""}
                    onChange={(e) => update(idx, { interest: e.target.value || null })}
                    placeholder="Juros (ex.: 1,99% a.m.) — opcional"
                    className="h-9 text-sm bg-pv-bg border-pv-mid/40 rounded-none"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
