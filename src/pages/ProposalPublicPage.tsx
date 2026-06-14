// =============================================================================
// Página pública profissional do orçamento — /proposta/:token
// =============================================================================
// "Site de proposta" completo e convincente: hero com imagem, economia em
// destaque, como funciona, diferenciais, parceria/credibilidade, iGreen Club,
// prova social (depoimentos) e CTA fixo de resposta. Mantém a identidade verde
// iGreen. NÃO acessa o banco direto: tudo passa pelas edge functions
// (proposal-public-get / proposal-respond) via publicApi. Cada seção só
// renderiza quando há dado, então serve a todos os produtos.
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
  Gift,
  Pill,
  Film,
  UtensilsCrossed,
  ShoppingBag,
  Plane,
  Coins,
} from "lucide-react";
import {
  getPublicProposal,
  respondToProposal,
  getSlugProfile,
  IGREEN_CLUB_BENEFITS,
  IGREEN_CLUB_SUMMARY,
  type ClubBenefit,
  type PublicProposalView,
  type ProposalStatus,
} from "@/features/produtos/orcamento";
import { useProducts } from "@/features/produtos/catalogo/hooks";
import LazyVideo from "@/components/ui/LazyVideo";
import { conexaoVideoUrl, conexaoPosterUrl } from "@/lib/conexaoVideos";

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

  // Catálogo público (leitura anônima permitida por RLS). Usado para resolver
  // o slug do produto quando a edge function ainda não o envia (sem depender de
  // deploy): casa pelo nome do produto retornado na proposta.
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

  // Perfil comercial do produto. A edge function já manda o slug; se faltar,
  // resolvemos pelo catálogo (leitura pública), casando pelo NOME do produto.
  const resolvedSlug =
    product?.slug ??
    catalogProducts.find((p) => p.name === product?.name)?.slug ??
    null;
  const profile = resolvedSlug ? getSlugProfile(resolvedSlug) : null;

  // Primeiro nome do destinatário, para personalizar o site.
  const firstName = proposal.recipientName?.trim().split(/\s+/)[0] ?? null;
  const heroImage = profile?.heroImage ?? null;

  return (
    <>
      <SEOHead
        title={`Proposta ${product?.name ?? "iGreen"}${consultant ? ` — ${consultant.name}` : ""}`}
        description={profile?.heroSubtitle ?? "Sua proposta personalizada iGreen Energy."}
      />
      <div className="min-h-screen bg-gradient-to-b from-[#0e8028] to-[#081c03] pb-28">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
          {/* ── HERO ──────────────────────────────────────────────── */}
          {/* A imagem é um banner SEM texto sobreposto: várias imagens da
              iGreen já têm escrita gravada, então sobrepor título causaria
              "texto sobre texto". O título vai num painel sólido abaixo. */}
          <section className="rounded-3xl overflow-hidden shadow-2xl bg-background">
            {heroImage && (
              <div className="h-44 sm:h-56 w-full">
                <img
                  src={heroImage}
                  alt={product?.name ?? "iGreen"}
                  className="w-full h-full object-cover"
                  loading="eager"
                />
              </div>
            )}

            {/* Título em painel sólido verde (legível, sem conflito) */}
            <div className="bg-gradient-to-br from-[#0e8028] to-[#081c03] px-6 py-6 text-white">
              <img
                src="/images/logo-colorida-igreen.png"
                alt="iGreen Energy"
                className="h-7 mb-3"
                loading="eager"
              />
              <p className="text-[11px] uppercase tracking-[0.2em] text-white/80">
                {product?.brandName}
              </p>
              <h1 className="font-heading text-2xl sm:text-3xl font-bold leading-tight">
                {profile?.headline ?? product?.name}
              </h1>
            </div>

            {/* Saudação personalizada */}
            <div className="px-6 pt-5 pb-2 text-center">
              {firstName ? (
                <p className="text-sm text-foreground">
                  Olá <span className="font-semibold">{firstName}</span>, preparei esta proposta
                  especialmente para você.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Uma proposta personalizada iGreen Energy.
                </p>
              )}
              {consultant && (
                <p className="text-xs text-muted-foreground mt-1">
                  Por <span className="font-medium text-foreground">{consultant.name}</span>
                  {consultant.igreenId ? ` · ID ${consultant.igreenId}` : ""}
                </p>
              )}
            </div>

            <StatusBanner status={proposal.status} validUntilLabel={validUntilLabel} />

            {profile?.heroSubtitle && (
              <p className="px-6 pb-5 text-sm text-foreground/80 text-center leading-relaxed">
                {profile.heroSubtitle}
              </p>
            )}
          </section>

          {/* ── VALOR / ECONOMIA ──────────────────────────────────── */}
          {(proposal.amount != null || proposal.lineItems.length > 0) && (
            <section className="rounded-3xl bg-background shadow-xl p-6 space-y-4">
              {proposal.amount != null && proposal.amount > 0 && (
                <div className="text-center bg-primary/5 rounded-2xl py-6 border border-primary/15">
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                    {profile?.amountLabel ?? "Valor"}
                  </p>
                  <p className="text-4xl font-bold text-primary mt-1">
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
            </section>
          )}

          {/* ── MÉTRICAS / CREDIBILIDADE ──────────────────────────── */}
          {profile?.stats && profile.stats.length > 0 && (
            <section className="grid grid-cols-3 gap-3">
              {profile.stats.map((s, i) => (
                <div key={i} className="rounded-2xl bg-white/10 backdrop-blur p-4 text-center">
                  <p className="text-xl font-bold text-white">{s.value}</p>
                  <p className="text-[10px] uppercase tracking-wide text-white/70 mt-1 leading-tight">
                    {s.label}
                  </p>
                </div>
              ))}
            </section>
          )}

          {/* ── COMO FUNCIONA ─────────────────────────────────────── */}
          {profile?.steps && profile.steps.length > 0 && (
            <section className="rounded-3xl bg-background shadow-xl p-6 space-y-4">
              <h2 className="font-heading text-lg font-bold text-foreground">Como funciona</h2>
              <ol className="space-y-4">
                {profile.steps.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="shrink-0 w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{step.title}</p>
                      <p className="text-xs text-muted-foreground leading-snug mt-0.5">
                        {step.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              {profile.heroVideoId ? (
                <LazyVideo
                  src={conexaoVideoUrl(profile.heroVideoId)}
                  poster={conexaoPosterUrl(profile.heroVideoId)}
                  label={`Vídeo ${product?.name ?? "iGreen"}`}
                  className="w-full aspect-video rounded-2xl mt-2 bg-black"
                />
              ) : profile.video ? (
                <video
                  src={profile.video}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full rounded-2xl mt-2 bg-black"
                />
              ) : null}
            </section>
          )}

          {/* ── DIFERENCIAIS ──────────────────────────────────────── */}
          {profile?.highlights && profile.highlights.length > 0 && (
            <section className="rounded-3xl bg-background shadow-xl p-6 space-y-3">
              <h2 className="font-heading text-lg font-bold text-foreground">Por que vale a pena</h2>
              <ul className="space-y-2.5">
                {profile.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground/90">
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
              {profile.partnerNote && (
                <p className="text-[11px] text-muted-foreground italic pt-1 border-t border-border/40">
                  {profile.partnerNote}
                </p>
              )}
            </section>
          )}

          {/* ── GALERIA ───────────────────────────────────────────── */}
          {profile?.gallery && profile.gallery.length > 0 && (
            <section className="grid grid-cols-2 gap-3">
              {profile.gallery.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`${product?.name ?? "iGreen"} ${i + 1}`}
                  className="w-full h-32 object-cover rounded-2xl shadow-lg"
                  loading="lazy"
                />
              ))}
            </section>
          )}

          {/* ── iGREEN CLUB ───────────────────────────────────────── */}
          {profile?.showClubBenefits && (
            <section className="rounded-3xl bg-background shadow-xl p-6 space-y-3">
              <div className="flex items-center gap-2">
                <Gift className="h-5 w-5 text-primary" />
                <h2 className="font-heading text-lg font-bold text-foreground">
                  iGreen Club incluso, grátis
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {IGREEN_CLUB_BENEFITS.map((b) => (
                  <div key={b.label} className="flex items-start gap-2.5">
                    <ClubIcon icon={b.icon} />
                    <div>
                      <p className="text-xs font-semibold text-foreground">{b.label}</p>
                      <p className="text-[11px] text-muted-foreground leading-snug">{b.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug pt-2 border-t border-border/40">
                {IGREEN_CLUB_SUMMARY}
              </p>
            </section>
          )}

          {/* ── PROVA SOCIAL (depoimentos) ────────────────────────── */}
          {profile?.testimonials && profile.testimonials.length > 0 && (
            <section className="rounded-3xl bg-background shadow-xl p-6 space-y-3">
              <h2 className="font-heading text-lg font-bold text-foreground">
                Quem já economiza com a gente
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {profile.testimonials.map((src, i) => (
                  <video
                    key={i}
                    src={src}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full rounded-2xl bg-black"
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── AÇÕES (inline, além do CTA fixo) ──────────────────── */}
          <section className="rounded-3xl bg-background shadow-xl p-6">
            {validUntilLabel && !isFinal && (
              <p className="text-center text-[11px] text-muted-foreground flex items-center justify-center gap-1 mb-4">
                <Clock className="h-3 w-3" /> Proposta válida até {validUntilLabel}
              </p>
            )}

            {!isFinal ? (
              <div className="space-y-3">
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
            ) : (
              <p className="text-center text-sm text-muted-foreground">
                Esta proposta já foi finalizada. Fale com o consultor para mais informações.
              </p>
            )}

            {/* Footer de confiança */}
            <div className="mt-5 pt-4 border-t border-border flex items-center justify-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] text-muted-foreground">Proposta segura iGreen Energy</span>
            </div>
          </section>
        </div>
      </div>

      {/* ── CTA FIXO (mobile) ───────────────────────────────────── */}
      {!isFinal && !counterOpen && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-background/95 backdrop-blur border-t border-border p-3 shadow-2xl">
          <div className="max-w-2xl mx-auto">
            <Button
              className="w-full h-12 text-base gap-2"
              disabled={submitting}
              onClick={() => handleRespond("accept")}
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              Aceitar proposta
            </Button>
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

// Ícone do benefício do iGreen Club (mapeia o tipo do catálogo para o ícone).
function ClubIcon({ icon }: { icon: ClubBenefit["icon"] }) {
  const cls = "h-4 w-4 text-primary shrink-0 mt-0.5";
  switch (icon) {
    case "pharmacy":
      return <Pill className={cls} />;
    case "cinema":
      return <Film className={cls} />;
    case "food":
      return <UtensilsCrossed className={cls} />;
    case "shopping":
      return <ShoppingBag className={cls} />;
    case "travel":
      return <Plane className={cls} />;
    case "cashback":
      return <Coins className={cls} />;
    default:
      return <Gift className={cls} />;
  }
}
