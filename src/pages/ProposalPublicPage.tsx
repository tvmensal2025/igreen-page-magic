// =============================================================================
// Página pública profissional do orçamento — /proposta/:token
// =============================================================================
// O destinatário (cliente ou quem o consultor indicar) abre esta página pelo
// link. NÃO acessa o banco direto: tudo passa pelas edge functions
// (proposal-public-get / proposal-respond) via publicApi. Permite aceitar,
// recusar ou enviar uma contraproposta com anexo + valor.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import LoadingScreen from "@/components/LoadingScreen";
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
} from "lucide-react";
import {
  getPublicProposal,
  respondToProposal,
  type PublicProposalView,
  type ProposalStatus,
} from "@/features/produtos/orcamento";

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const FINAL_STATUSES: ProposalStatus[] = ["accepted", "rejected", "expired"];

export default function ProposalPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<PublicProposalView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Contraproposta
  const [counterOpen, setCounterOpen] = useState(false);
  const [counterAmount, setCounterAmount] = useState("");
  const [counterNote, setCounterNote] = useState("");
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

  const status = view?.proposal.status;
  const isFinal = useMemo(() => (status ? FINAL_STATUSES.includes(status) : false), [status]);

  const handleRespond = async (action: "accept" | "reject" | "counter") => {
    if (!token) return;
    setSubmitting(true);
    try {
      await respondToProposal({
        token,
        action,
        note: action === "counter" ? counterNote.trim() || null : null,
        attachmentUrl: action === "counter" ? attachmentUrl : null,
        counterAmount:
          action === "counter" && counterAmount ? Number(counterAmount) : null,
      });
      toast.success(
        action === "accept"
          ? "Proposta aceita! O consultor foi avisado."
          : action === "reject"
            ? "Proposta recusada."
            : "Contraproposta enviada ao consultor.",
      );
      setCounterOpen(false);
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

  if (loading) return <LoadingScreen />;
  if (notFound || !view) {
    return (
      <PageStatus
        title="Orçamento não encontrado"
        description="O link pode estar incorreto ou o orçamento foi removido."
      />
    );
  }

  const { proposal, consultant, product } = view;
  const validUntilLabel = proposal.validUntil
    ? new Date(proposal.validUntil).toLocaleDateString("pt-BR")
    : null;

  return (
    <>
      <SEOHead
        title={`Orçamento ${product?.name ?? "iGreen"}${consultant ? ` — ${consultant.name}` : ""}`}
        description="Sua proposta personalizada iGreen Energy."
      />
      <div className="min-h-screen bg-gradient-to-b from-[#0e8028] to-[#081c03] py-8 px-4">
        <div className="max-w-lg mx-auto">
          {/* Cartão da proposta */}
          <div className="bg-background rounded-3xl shadow-2xl overflow-hidden">
            {/* Header com consultor */}
            <div className="p-6 text-center border-b border-border">
              <img
                src="/images/logo-colorida-igreen.png"
                alt="iGreen Energy"
                className="h-8 mx-auto mb-4"
                loading="lazy"
              />
              {consultant && (
                <p className="text-xs text-muted-foreground">
                  Proposta de <span className="font-semibold text-foreground">{consultant.name}</span>
                  {consultant.igreenId ? ` · ID ${consultant.igreenId}` : ""}
                </p>
              )}
            </div>

            {/* Status banner */}
            <StatusBanner status={proposal.status} validUntilLabel={validUntilLabel} />

            {/* Produto + valor */}
            <div className="p-6 space-y-5">
              <div className="text-center">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {product?.brandName}
                </p>
                <h1 className="font-heading text-2xl font-bold text-foreground mt-1">
                  {product?.name}
                </h1>
              </div>

              {proposal.amount != null && (
                <div className="text-center bg-primary/5 rounded-2xl py-5 border border-primary/15">
                  <p className="text-4xl font-bold text-primary">
                    {BRL(proposal.amount)}
                    {proposal.amountPeriod === "month" && (
                      <span className="text-sm font-normal text-muted-foreground">/mês</span>
                    )}
                  </p>
                </div>
              )}

              {proposal.lineItems.length > 0 && (
                <div className="space-y-2">
                  {proposal.lineItems.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-start justify-between gap-3 text-sm border-b border-border/40 pb-2"
                    >
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="text-foreground text-right font-medium">{item.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {proposal.message && (
                <div className="rounded-xl bg-secondary/40 p-4">
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap">{proposal.message}</p>
                </div>
              )}

              {validUntilLabel && !isFinal && (
                <p className="text-center text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                  <Clock className="h-3 w-3" /> Válido até {validUntilLabel}
                </p>
              )}

              {/* Ações do destinatário */}
              {!isFinal && (
                <div className="space-y-3 pt-2">
                  {!counterOpen ? (
                    <>
                      <Button
                        className="w-full h-12 text-base gap-2"
                        disabled={submitting}
                        onClick={() => handleRespond("accept")}
                      >
                        {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                        Aceitar proposta
                      </Button>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="flex-1 gap-1.5"
                          disabled={submitting}
                          onClick={() => setCounterOpen(true)}
                        >
                          Fazer contraproposta
                        </Button>
                        <Button
                          variant="ghost"
                          className="flex-1 gap-1.5 text-muted-foreground"
                          disabled={submitting}
                          onClick={() => handleRespond("reject")}
                        >
                          <XCircle className="h-4 w-4" /> Recusar
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-3 rounded-xl border border-border p-4">
                      <p className="text-sm font-semibold text-foreground">Sua contraproposta</p>
                      <div>
                        <label className="text-[11px] text-muted-foreground font-medium">
                          Valor que você propõe (opcional)
                        </label>
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={counterAmount}
                          onChange={(e) => setCounterAmount(e.target.value)}
                          placeholder="Ex.: 45"
                          className="h-9 text-sm mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground font-medium">Mensagem</label>
                        <Textarea
                          value={counterNote}
                          onChange={(e) => setCounterNote(e.target.value)}
                          placeholder="Explique sua proposta ou anexe um orçamento concorrente..."
                          className="text-sm min-h-[70px] resize-none mt-1"
                        />
                      </div>
                      <div>
                        <input
                          id="counter-attach"
                          type="file"
                          className="hidden"
                          onChange={handleAttach}
                          accept="image/*,application/pdf"
                        />
                        <label
                          htmlFor="counter-attach"
                          className="inline-flex items-center gap-1.5 text-xs text-primary cursor-pointer hover:underline"
                        >
                          {uploading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Paperclip className="h-3.5 w-3.5" />
                          )}
                          {attachmentUrl ? "Anexo enviado ✓" : "Anexar proposta (imagem ou PDF)"}
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          className="flex-1"
                          disabled={submitting}
                          onClick={() => setCounterOpen(false)}
                        >
                          Cancelar
                        </Button>
                        <Button
                          className="flex-1 gap-1.5"
                          disabled={submitting || uploading}
                          onClick={() => handleRespond("counter")}
                        >
                          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          Enviar contraproposta
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer de confiança */}
            <div className="px-6 py-4 bg-secondary/30 border-t border-border flex items-center justify-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] text-muted-foreground">
                Proposta segura iGreen Energy
              </span>
            </div>
          </div>
        </div>
      </div>
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
  if (status === "accepted") {
    return (
      <div className="bg-emerald-500/10 text-emerald-600 px-6 py-3 flex items-center gap-2 text-sm font-medium">
        <CheckCircle2 className="h-4 w-4" /> Você aceitou esta proposta. O consultor foi avisado.
      </div>
    );
  }
  if (status === "rejected") {
    return (
      <div className="bg-red-500/10 text-red-600 px-6 py-3 flex items-center gap-2 text-sm font-medium">
        <XCircle className="h-4 w-4" /> Esta proposta foi recusada.
      </div>
    );
  }
  if (status === "expired") {
    return (
      <div className="bg-zinc-500/10 text-zinc-500 px-6 py-3 flex items-center gap-2 text-sm font-medium">
        <Clock className="h-4 w-4" /> Esta proposta expirou
        {validUntilLabel ? ` em ${validUntilLabel}` : ""}. Fale com o consultor.
      </div>
    );
  }
  if (status === "countered") {
    return (
      <div className="bg-amber-500/10 text-amber-600 px-6 py-3 flex items-center gap-2 text-sm font-medium">
        <Clock className="h-4 w-4" /> Sua contraproposta foi enviada. Aguarde o retorno do consultor.
      </div>
    );
  }
  return null;
}
