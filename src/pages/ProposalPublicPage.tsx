// =============================================================================
// Página pública do orçamento — /proposta/:token
// =============================================================================
// Conceito: a LANDING PAGE do produto (a mesma dos links públicos /conexao-*)
// fica de FUNDO, e a PROPOSTA aparece num MODAL DE VIDRO (glassmorphism) na
// frente. Ao fechar o modal, o cliente "cai" na landing e pode rolar para
// conhecer tudo; um botão flutuante reabre a proposta a qualquer momento.
//
// Regras de negócio:
//  - "Anexar proposta concorrente" (em vez de contraproposta) SÓ aparece em
//    Conexão Seguros e Conexão Placas.
//  - Não acessa o banco direto: tudo via edge functions (publicApi).
// =============================================================================

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import PageStatus from "@/components/common/PageStatus";
import SEOHead from "@/components/SEOHead";
import { uploadMedia } from "@/services/minioUpload";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Paperclip,
  ShieldCheck,
  Sparkles,
  X,
  FileText,
  CreditCard,
  Wallet,
  Landmark,
} from "lucide-react";
import {
  getPublicProposal,
  respondToProposal,
  type PublicProposalView,
  type ProposalStatus,
} from "@/features/produtos/orcamento";
import { PAYMENT_METHOD_LABEL, type ProposalLineItem } from "@/features/produtos/orcamento";
import { SolarProposalSection } from "@/features/solar-3d";
import { formatBRLFromCents } from "@/features/produtos/lib/money";
import { useProducts, resolveLanding } from "@/features/produtos/catalogo";

// Landing pesada (vídeo, imagens, seções) — só carrega quando o cliente
// fecha o modal para "cair" na landing. Mantém o FCP do modal rápido.
const ProductLandingSections = lazy(() =>
  import("@/features/produtos/catalogo").then((m) => ({ default: m.ProductLandingSections })),
);


const BRL = (cents: number) => formatBRLFromCents(cents);

const FINAL_STATUSES: ProposalStatus[] = ["accepted", "rejected", "expired"];

// Produtos onde o cliente pode anexar uma proposta concorrente (negociação).
const COMPETITOR_ATTACH_SLUGS = ["conexao-seguros", "conexao-placas"];

export default function ProposalPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<PublicProposalView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Modal de proposta (abre por padrão; fechar revela a landing de fundo).
  const [modalOpen, setModalOpen] = useState(true);

  // Anexo de proposta concorrente (substitui a contraproposta).
  const [competitorOpen, setCompetitorOpen] = useState(false);
  const [competitorNote, setCompetitorNote] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await getPublicProposal(token);
      setView(data);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const { data: catalogProducts = [] } = useProducts();

  const status = view?.proposal.status;
  const isFinal = useMemo(() => (status ? FINAL_STATUSES.includes(status) : false), [status]);

  const handleRespond = async (action: "accept" | "reject" | "counter") => {
    if (!token) return;
    setSubmitting(true);
    try {
      await respondToProposal({
        token,
        action,
        note: action === "counter" ? competitorNote.trim() || null : null,
        attachmentUrl: action === "counter" ? attachmentUrl : null,
        counterAmount: null,
      });
      toast.success(
        action === "accept"
          ? "Proposta aceita! O consultor foi avisado."
          : action === "reject"
            ? "Proposta recusada."
            : "Proposta concorrente enviada ao consultor.",
      );
      setCompetitorOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível registrar sua resposta.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máximo 20MB).");
      return;
    }
    setUploading(true);
    try {
      const result = await uploadMedia(file, undefined, { scope: "generic", kind: "proposta" });
      setAttachmentUrl(result.url);
      toast.success("Anexo enviado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar o anexo.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  // Landing COMPLETA do produto (fundo). Casa pelo slug (ou nome) da proposta.
  const landing = useMemo(() => {
    const prod = view?.product;
    if (!prod) return null;
    const slug = prod.slug ?? catalogProducts.find((p) => p.name === prod.name)?.slug ?? "";
    if (!slug) return null;
    const dbProduct = catalogProducts.find((p) => p.slug === slug) ?? null;
    return resolveLanding(dbProduct, slug);
  }, [view?.product, catalogProducts]);

  // Skeleton leve em vez do LoadingScreen pesado — FCP imediato no celular.
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#0e8028] to-[#081c03] flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-6 space-y-3 animate-pulse">
          <div className="h-5 w-2/3 bg-white/30 rounded" />
          <div className="h-4 w-full bg-white/20 rounded" />
          <div className="h-4 w-5/6 bg-white/20 rounded" />
          <div className="h-10 w-full bg-white/25 rounded-xl mt-4" />
        </div>
      </div>
    );
  }
  if (notFound || !view) {
    return (
      <PageStatus
        title="Orçamento não encontrado"
        description="O link pode estar incorreto ou o orçamento foi removido."
      />
    );
  }


  const { proposal, consultant, product } = view;
  const slug = product?.slug ?? "";
  const validUntilLabel = proposal.validUntil
    ? new Date(proposal.validUntil).toLocaleDateString("pt-BR")
    : null;

  const firstName = proposal.recipientName?.trim().split(/\s+/)[0] ?? null;

  // Economia (energia) = tem "conta de luz" OU "desconto na conta". Não basta
  // a palavra "economia" (seguros também usa "economia de até 60%").
  const isSavings = proposal.lineItems.some(
    (i) => /conta de luz|conta atual/i.test(i.label),
  );
  const discountItem = proposal.lineItems.find((i) => /^desconto$/i.test(i.label.trim()));
  const discountBadge =
    isSavings && discountItem
      ? `${discountItem.value} de desconto na conta de luz`
      : null;
  const savingsRangeItem = proposal.lineItems.find((i) =>
    /economia.*m[eê]s|economia por m/i.test(i.label),
  );
  const yearlyItem = proposal.lineItems.find((i) => /economia.*ano|economia por ano/i.test(i.label));

  const allowCompetitor = COMPETITOR_ATTACH_SLUGS.includes(slug);

  // Separa as formas de pagamento (kind: "payment") dos detalhes comuns, para
  // renderizar o pagamento num bloco dedicado (cartão, parcelas, juros, banco).
  const paymentItems = proposal.lineItems.filter((i) => i.kind === "payment");
  const detailItems = proposal.lineItems.filter(
    (i) => i.kind !== "payment" && i.kind !== "solar_design" && i.kind !== "scoring_input",
  );

  return (
    <>
      <SEOHead
        title={`Proposta ${product?.name ?? "iGreen"}${consultant ? ` — ${consultant.name}` : ""}`}
        description={landing?.heroSubtitle ?? "Sua proposta personalizada iGreen Energy."}
      />

      {/* ═══ FUNDO: a landing page do produto (a mesma dos links públicos) ═══ */}
      {/* Lazy-load: só baixa o bundle pesado da landing quando o modal fecha. */}
      <Suspense fallback={<div className="min-h-screen bg-gradient-to-b from-[#0e8028] to-[#081c03]" />}>
        {!modalOpen && landing ? (
          <ProductLandingSections product={landing} />
        ) : (
          <div className="min-h-screen bg-gradient-to-b from-[#0e8028] to-[#081c03]" />
        )}
      </Suspense>


      {/* Botão flutuante para reabrir a proposta quando o modal está fechado */}
      {!modalOpen && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="public-bottom-cta fixed bottom-4 inset-x-4 z-40 mx-auto max-w-md flex items-center justify-center gap-2 rounded-2xl bg-[#0e8028] hover:bg-[#0a6b22] text-white font-semibold py-3.5 shadow-2xl transition-colors"
        >
          <FileText className="h-5 w-5" />
          Ver minha proposta
        </button>
      )}

      {/* ═══ FRENTE: modal de vidro (glassmorphism) com a proposta ═══ */}
      {modalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6">
          {/* Backdrop leve — deixa a landing aparecer atrás do vidro flutuante.
              Clicar fora fecha (o cliente "cai" na landing). */}
          <div
            className="fixed inset-0 bg-[#04140a]/40 backdrop-blur-sm"
            onClick={() => setModalOpen(false)}
            aria-hidden="true"
          />

          {/* Cartão de vidro flutuante — margens deixam a landing visível ao
              redor; rola por dentro se o conteúdo passar da altura da tela. */}
          <div className="relative w-full max-w-sm max-h-[88dvh] rounded-3xl border border-white/30 bg-white/15 backdrop-blur-2xl shadow-[0_20px_70px_rgba(0,0,0,0.55)] overflow-hidden flex flex-col ring-1 ring-white/10">
            {/* brilhos decorativos */}
            <div className="pointer-events-none absolute -top-16 -right-16 w-48 h-48 rounded-full bg-[#3ad06a]/30 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-16 w-56 h-56 rounded-full bg-[#0e8028]/30 blur-3xl" />

            {/* Botão fechar */}
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              aria-label="Fechar proposta"
              className="absolute top-2.5 right-2.5 z-10 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur flex items-center justify-center text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative px-5 py-5 text-white overflow-y-auto">
              {/* Cabeçalho */}
              <div className="text-center">
                <img
                  src="/images/logo-colorida-igreen.png"
                  alt="iGreen Energy"
                  className="h-6 mx-auto mb-2 brightness-0 invert"
                  loading="eager"
                />
                {product?.brandName && (
                  <p className="text-[9px] uppercase tracking-[0.25em] text-white/70">
                    {product.brandName}
                  </p>
                )}
                <h1 className="font-heading text-lg font-bold leading-tight mt-0.5">
                  Proposta {product?.name ?? "iGreen"}
                </h1>
                {firstName ? (
                  <p className="text-xs text-white/85 mt-1">
                    Olá <span className="font-semibold">{firstName}</span>, simulei isto para você.
                  </p>
                ) : (
                  <p className="text-xs text-white/75 mt-1">Simulação personalizada iGreen.</p>
                )}
                {consultant && (
                  <p className="text-[10px] text-white/65 mt-0.5">
                    Por <span className="font-medium text-white/90">{consultant.name}</span>
                    {consultant.igreenId ? ` · ID ${consultant.igreenId}` : ""}
                  </p>
                )}
              </div>

              <StatusBanner status={proposal.status} validUntilLabel={validUntilLabel} />

              {view.solar && (
                <div className="mt-3 [&_section]:border-white/20 [&_section]:bg-white/10 [&_section]:text-white [&_.text-muted-foreground]:text-white/70">
                  <SolarProposalSection solar={view.solar} />
                </div>
              )}

              {/* Valor / economia */}
              {proposal.amountCents != null && proposal.amountCents > 0 && (
                <div className="mt-3 rounded-2xl bg-white/10 border border-white/20 px-4 py-3.5 text-center">
                  {discountBadge && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#3ad06a]/25 px-2.5 py-0.5 text-[10px] font-semibold mb-1.5 border border-[#7ef0a0]/30">
                      <Sparkles className="h-3 w-3" /> {discountBadge}
                    </span>
                  )}
                  <p className="text-[9px] uppercase tracking-[0.22em] text-white/70">
                    {isSavings ? "Você economiza" : "Seu investimento"}
                  </p>
                  {isSavings && savingsRangeItem ? (
                    <>
                      <p className="text-3xl font-extrabold mt-0.5 leading-none">
                        {savingsRangeItem.value}
                        <span className="text-xs font-medium text-white/70"> /mês</span>
                      </p>
                      <p className="text-[10px] text-white/65 mt-1">conforme a sua distribuidora</p>
                    </>
                  ) : (
                    <p className="text-3xl font-extrabold mt-0.5 leading-none">
                      {BRL(proposal.amountCents)}
                      {proposal.amountPeriod === "month" && (
                        <span className="text-xs font-medium text-white/70"> /mês</span>
                      )}
                    </p>
                  )}
                  {isSavings && yearlyItem && (
                    <p className="mt-2 inline-block rounded-full bg-black/20 px-3 py-1 text-xs font-medium">
                      {yearlyItem.value} por ano no seu bolso
                    </p>
                  )}
                </div>
              )}

              {/* Detalhes (compactos) */}
              {detailItems.length > 0 && (
                <div className="mt-3 rounded-2xl bg-white/5 border border-white/15 divide-y divide-white/10 overflow-hidden">
                  {detailItems.map((item, i) => (
                    <div key={i} className="flex items-start justify-between gap-3 text-[13px] px-3.5 py-2">
                      <span className="text-white/70">{item.label}</span>
                      <span className="text-white text-right font-semibold">{item.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Formas de pagamento (Placas): à vista, cartão, financiamento */}
              {paymentItems.length > 0 && <PaymentBlock items={paymentItems} />}

              {/* Validade */}
              {validUntilLabel && !isFinal && (
                <p className="text-center text-[10px] text-white/70 flex items-center justify-center gap-1 mt-2.5">
                  <Clock className="h-3 w-3" /> Válida até {validUntilLabel}
                </p>
              )}

              {/* Ações */}
              {!isFinal ? (
                <div className="mt-3 space-y-2">
                  {!competitorOpen ? (
                    <>
                      <Button
                        className="w-full h-11 text-base gap-2 bg-white text-[#0e8028] hover:bg-white/90"
                        disabled={submitting}
                        onClick={() => handleRespond("accept")}
                      >
                        {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                        Aceitar proposta
                      </Button>
                      <div className="flex gap-2">
                        {allowCompetitor && (
                          <Button
                            variant="outline"
                            className="flex-1 h-9 gap-1.5 border-white/40 bg-transparent text-white hover:bg-white/15 text-xs"
                            disabled={submitting}
                            onClick={() => setCompetitorOpen(true)}
                          >
                            <Paperclip className="h-3.5 w-3.5" /> Proposta concorrente
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          className={`h-9 gap-1.5 text-white/70 hover:bg-white/10 hover:text-white text-xs ${allowCompetitor ? "flex-1" : "w-full"}`}
                          disabled={submitting}
                          onClick={() => handleRespond("reject")}
                        >
                          <XCircle className="h-3.5 w-3.5" /> Recusar
                        </Button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setModalOpen(false)}
                        className="w-full text-center text-[11px] text-white/75 hover:text-white underline underline-offset-4"
                      >
                        Conhecer o {product?.name ?? "produto"} antes de decidir
                      </button>
                    </>
                  ) : (
                    <div className="space-y-2 rounded-2xl border border-white/20 bg-white/5 p-3">
                      <p className="text-sm font-semibold">Anexar proposta concorrente</p>
                      <p className="text-[10px] text-white/70">
                        Recebeu uma proposta de outra empresa? Envie que o consultor tenta cobrir.
                      </p>
                      <Textarea
                        value={competitorNote}
                        onChange={(e) => setCompetitorNote(e.target.value)}
                        placeholder="Valores/condições da proposta concorrente..."
                        className="text-sm min-h-[56px] resize-none bg-white/10 border-white/20 text-white placeholder:text-white/50"
                      />
                      <div>
                        <input
                          id="competitor-attach"
                          type="file"
                          className="hidden"
                          onChange={handleAttach}
                          accept="image/*,application/pdf"
                        />
                        <label
                          htmlFor="competitor-attach"
                          className="inline-flex items-center gap-1.5 text-xs text-white cursor-pointer hover:underline"
                        >
                          {uploading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Paperclip className="h-3.5 w-3.5" />
                          )}
                          {attachmentUrl ? "Anexo enviado ✓" : "Anexar imagem ou PDF"}
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          className="flex-1 h-9 text-white/70 hover:bg-white/10 hover:text-white"
                          disabled={submitting}
                          onClick={() => setCompetitorOpen(false)}
                        >
                          Cancelar
                        </Button>
                        <Button
                          className="flex-1 h-9 gap-1.5 bg-white text-[#0e8028] hover:bg-white/90"
                          disabled={submitting || uploading}
                          onClick={() => handleRespond("counter")}
                        >
                          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          Enviar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-center text-sm text-white/80 mt-3">
                  Esta proposta já foi finalizada. Fale com o consultor.
                </p>
              )}

              {/* Aviso: simulação criada por consultor, não oficial */}
              <p className="mt-3 text-center text-[10px] leading-snug text-white/60">
                ⚡ Simulação rápida feita pelo seu consultor — valores estimados, não é
                um documento oficial da iGreen. A condição final é confirmada no cadastro.
              </p>

              <div className="mt-2.5 pt-2.5 border-t border-white/15 flex items-center justify-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-[#7ef0a0]" />
                <span className="text-[10px] text-white/70">Proposta segura iGreen Energy</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function StatusBanner({
  status,
  validUntilLabel,
}: {
  status: ProposalStatus;
  validUntilLabel: string | null;
}) {
  const base = "mt-4 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm font-medium";
  if (status === "accepted") {
    return (
      <div className={`${base} bg-success/20 text-success-foreground border border-success/30`}>
        <CheckCircle2 className="h-4 w-4" /> Você aceitou esta proposta. O consultor foi avisado.
      </div>
    );
  }
  if (status === "rejected") {
    return (
      <div className={`${base} bg-destructive/20 text-destructive-foreground border border-destructive/30`}>
        <XCircle className="h-4 w-4" /> Esta proposta foi recusada.
      </div>
    );
  }
  if (status === "expired") {
    return (
      <div className={`${base} bg-zinc-400/20 text-zinc-100 border border-zinc-300/30`}>
        <Clock className="h-4 w-4" /> Esta proposta expirou
        {validUntilLabel ? ` em ${validUntilLabel}` : ""}.
      </div>
    );
  }
  if (status === "countered") {
    return (
      <div className={`${base} bg-warning/20 text-warning-foreground border border-warning/30`}>
        <Clock className="h-4 w-4" /> Sua proposta concorrente foi enviada. Aguarde o retorno.
      </div>
    );
  }
  return null;
}

// ===========================================================================
// Bloco de formas de pagamento (Placas) — cartões de vidro com destaque
// ===========================================================================
function PaymentBlock({ items }: { items: ProposalLineItem[] }) {
  const iconFor = (method?: string) => {
    if (method === "cash") return <Wallet className="h-4 w-4" />;
    if (method === "card") return <CreditCard className="h-4 w-4" />;
    return <Landmark className="h-4 w-4" />;
  };

  return (
    <div className="mt-3">
      <p className="text-[9px] uppercase tracking-[0.22em] text-white/60 mb-1.5 px-1">
        Formas de pagamento
      </p>
      <div className="space-y-2">
        {items.map((item, i) => {
          const title = item.method ? PAYMENT_METHOD_LABEL[item.method] : item.label;
          return (
            <div
              key={i}
              className={`rounded-2xl border px-3.5 py-2.5 ${
                item.highlight
                  ? "border-[#7ef0a0]/50 bg-[#3ad06a]/15"
                  : "border-white/15 bg-white/5"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-white/85 text-[13px] font-medium">
                  {iconFor(item.method)}
                  {title}
                  {item.highlight && (
                    <span className="rounded-full bg-[#3ad06a]/30 px-2 py-0.5 text-[9px] font-semibold border border-[#7ef0a0]/30">
                      recomendado
                    </span>
                  )}
                </span>
                <span className="text-white text-right font-bold text-[15px] leading-tight">
                  {item.value}
                </span>
              </div>
              {(item.bank || item.interest) && (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-6 text-[10px] text-white/55">
                  {item.bank && <span>🏦 {item.bank}</span>}
                  {item.interest && <span>📈 {item.interest}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
