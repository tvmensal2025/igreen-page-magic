// =============================================================================
// Orçamento — Painel de propostas enviadas (Magazine 7+5 redesign)
// =============================================================================

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { sendWhatsAppMessage } from "@/services/messageSender";
import { useProducts } from "../catalogo/hooks";
import {
  useProposals,
  useProposalEvents,
  useReplyToCounter,
  useDeleteProposal,
} from "./hooks";
import {
  PROPOSAL_STATUS_LABEL,
  type Proposal,
  type ProposalStatus,
} from "./types";
import {
  ChevronDown,
  Copy,
  Loader2,
  MessageSquare,
  Send,
  Trash2,
} from "lucide-react";
import { pvSerif } from "../theme";
import { formatBRLFromCents, reaisToCents, centsToReais } from "../lib/money";

type StatusFilter = "all" | "pending" | "accepted" | "closed";

const PENDING: ProposalStatus[] = ["sent", "viewed", "countered"];
const CLOSED: ProposalStatus[] = ["rejected", "expired", "draft"];

const STATUS_COLOR: Record<ProposalStatus, string> = {
  draft: "bg-pv-bg text-pv-ink/60 border-pv-surface",
  sent: "bg-pv-surface text-pv-ink border-pv-mid",
  viewed: "bg-pv-mid/30 text-pv-ink border-pv-mid",
  accepted: "bg-pv-accent text-white border-pv-accent",
  rejected: "bg-red-100 text-red-700 border-red-200",
  countered: "bg-pv-gold/20 text-pv-gold-ink border-pv-gold/40",
  expired: "bg-pv-bg text-pv-ink/40 border-pv-surface",
};

const PUBLIC_BASE = "https://igreen.cloud";
// Formata centavos (inteiro) como moeda BRL na camada de apresentação.
const BRL = (cents: number) => formatBRLFromCents(cents);

interface ProposalsPanelProps {
  consultantId: string;
  instanceName?: string | null;
  isWhapi?: boolean;
}

export function ProposalsPanel({ consultantId, instanceName, isWhapi }: ProposalsPanelProps) {
  const { toast } = useToast();
  const { data: proposals = [], isLoading } = useProposals(consultantId);
  const { data: products = [] } = useProducts();
  const deleteProposal = useDeleteProposal(consultantId);

  const [filter, setFilter] = useState<StatusFilter>("all");

  const productById = useMemo(() => {
    const map = new Map<string, (typeof products)[number]>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  const kpis = useMemo(() => {
    const pending = proposals.filter((p) => PENDING.includes(p.status));
    const accepted = proposals.filter((p) => p.status === "accepted");
    const totalPending = pending.reduce((acc, p) => acc + (p.amountCents ?? 0), 0);
    const ticketAvg = proposals.length
      ? proposals.reduce((acc, p) => acc + (p.amountCents ?? 0), 0) / proposals.length
      : 0;
    const totalDecided = accepted.length + proposals.filter((p) => p.status === "rejected").length;
    const acceptRate = totalDecided > 0 ? Math.round((accepted.length / totalDecided) * 100) : 0;
    const expiringSoon = pending.filter((p) => {
      if (!p.validUntil) return false;
      const days = (new Date(p.validUntil).getTime() - Date.now()) / 86400000;
      return days > 0 && days <= 2;
    }).length;
    return {
      abertos: pending.length,
      totalPending,
      acceptRate,
      ticketAvg,
      expiringSoon,
    };
  }, [proposals]);

  const filtered = useMemo(() => {
    return proposals.filter((p) => {
      if (filter === "all") return true;
      if (filter === "pending") return PENDING.includes(p.status);
      if (filter === "accepted") return p.status === "accepted";
      if (filter === "closed") return CLOSED.includes(p.status);
      return true;
    });
  }, [proposals, filter]);

  const handleDelete = async (proposal: Proposal) => {
    if (!["draft", "sent", "expired"].includes(proposal.status)) {
      toast({ title: "Não é possível excluir", description: "Propostas respondidas não podem ser removidas.", variant: "destructive" });
      return;
    }
    try {
      await deleteProposal.mutateAsync(proposal.id);
      toast({ title: "Orçamento removido" });
    } catch (err) {
      toast({
        title: "Erro ao excluir",
        description: err instanceof Error ? err.message : "Falha desconhecida",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-pv-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Hero magazine 7+5 */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
        <div className="lg:col-span-7">
          <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-pv-accent mb-3 block">
            Orçamentos
          </span>
          <h1 className={`text-5xl md:text-7xl text-pv-ink leading-[1.05] ${pvSerif}`}>
            Propostas em<br />andamento
          </h1>
          <p className="mt-5 text-base text-pv-ink/70 max-w-md leading-relaxed">
            {proposals.length} orçamento(s) emitido(s), {kpis.abertos} aguardando resposta
            {kpis.expiringSoon > 0 && (
              <> — <span className="text-pv-gold font-semibold">{kpis.expiringSoon} vencendo em até 2 dias</span></>
            )}
            .
          </p>
        </div>
        <div className="lg:col-span-5 grid grid-cols-2 gap-3">
          <KpiBlock kicker="Em aberto" value={String(kpis.abertos)} accent="accent" />
          <KpiBlock kicker="Taxa de aceite" value={`${kpis.acceptRate}%`} accent="gold" />
          <KpiBlock kicker="Ticket médio" value={BRL(kpis.ticketAvg)} accent="accent" />
          <KpiBlock kicker="Vencendo (≤2d)" value={String(kpis.expiringSoon)} accent="ink" />
        </div>
      </section>

      {/* Filtros + lista */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", `Todas (${proposals.length})`],
            ["pending", `Aguardando (${kpis.abertos})`],
            ["accepted", "Aceitas"],
            ["closed", "Encerradas"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 border transition-colors ${
              filter === key
                ? "bg-pv-ink text-white border-pv-ink"
                : "bg-white text-pv-ink/70 border-pv-surface hover:border-pv-accent"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-pv-ink/50 text-center py-12 italic">
          {proposals.length === 0
            ? "Nenhum orçamento criado ainda. Use o botão Novo orçamento no topo."
            : "Nenhum orçamento neste filtro."}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              productName={productById.get(proposal.productId)?.name ?? "Produto"}
              consultantId={consultantId}
              instanceName={instanceName}
              isWhapi={isWhapi}
              onDelete={() => handleDelete(proposal)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KpiBlock({
  kicker,
  value,
  accent,
}: {
  kicker: string;
  value: string;
  accent: "gold" | "accent" | "ink";
}) {
  const borderColor =
    accent === "gold" ? "border-pv-gold" : accent === "ink" ? "border-pv-ink" : "border-pv-accent";
  const bg = accent === "gold" ? "bg-pv-surface" : "bg-white/60";
  return (
    <div className={`${bg} p-5 border-l-4 ${borderColor} min-h-[110px] flex flex-col justify-between`}>
      <span className="text-[10px] uppercase tracking-[0.18em] text-pv-ink/60 font-semibold">
        {kicker}
      </span>
      <div className={`text-2xl font-light text-pv-ink mt-1 ${pvSerif}`}>{value}</div>
    </div>
  );
}

interface ProposalCardProps {
  proposal: Proposal;
  productName: string;
  consultantId: string;
  instanceName?: string | null;
  isWhapi?: boolean;
  onDelete: () => void;
}

function ProposalCard({
  proposal,
  productName,
  consultantId,
  instanceName,
  isWhapi,
  onDelete,
}: ProposalCardProps) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  // Campo de novo valor exibido em reais (o consultor digita em reais).
  const [replyAmount, setReplyAmount] = useState(
    proposal.amountCents != null ? String(centsToReais(proposal.amountCents)) : "",
  );
  const [replyNote, setReplyNote] = useState("");
  const [sending, setSending] = useState(false);

  const replyToCounter = useReplyToCounter(consultantId);
  const { data: events = [], isLoading: eventsLoading } = useProposalEvents(
    expanded ? proposal.id : undefined,
  );

  const link = `${PUBLIC_BASE}/proposta/${proposal.publicToken}`;
  const recipientLabel = proposal.recipientName || proposal.recipientPhone || "Destinatário";

  const amountLabel = proposal.amountCents
    ? `${BRL(proposal.amountCents)}${proposal.amountPeriod === "month" ? "/mês" : ""}`
    : "—";

  const daysLeft = proposal.validUntil
    ? Math.ceil((new Date(proposal.validUntil).getTime() - Date.now()) / 86400000)
    : null;
  const validityLabel =
    daysLeft === null
      ? null
      : daysLeft <= 0
      ? "Expirada"
      : daysLeft <= 2
      ? `Expira em ${daysLeft}d`
      : `Válida ${daysLeft}d`;
  const validityUrgent = daysLeft !== null && daysLeft > 0 && daysLeft <= 2;

  const handleCopy = () => {
    navigator.clipboard.writeText(link);
    toast({ title: "Link copiado!" });
  };

  const handleWhatsApp = async () => {
    const phone = proposal.recipientPhone;
    if (!phone) {
      toast({ title: "Telefone não disponível", variant: "destructive" });
      return;
    }
    if (!instanceName) {
      toast({ title: "WhatsApp não conectado", variant: "destructive" });
      return;
    }
    setSending(true);
    const text =
      `Olá ${proposal.recipientName || ""}! 👋\n\n` +
      `Segue o orçamento de *${productName}*:\n` +
      `${proposal.amountCents ? `Valor: *${amountLabel}*\n` : ""}` +
      `\nVeja os detalhes e responda por aqui:\n${link}`;
    const result = await sendWhatsAppMessage({
      instanceName,
      phone: proposal.recipientPhone,
      mediaCategory: "text",
      text,
      isWhapi,
      customerId: proposal.customerId ?? undefined,
      conversationStep: "orcamento_enviado",
    });
    setSending(false);
    if (result.status === "sent" || result.status === "pending") {
      toast({ title: "Orçamento enviado no WhatsApp!" });
    } else {
      toast({
        title: "Não foi possível enviar",
        description: result.error || "Tente copiar o link.",
        variant: "destructive",
      });
    }
  };

  const handleReply = async () => {
    const reais = Number(replyAmount);
    if (!reais || reais <= 0) {
      toast({ title: "Informe um valor válido", variant: "destructive" });
      return;
    }
    try {
      await replyToCounter.mutateAsync({
        proposalId: proposal.id,
        // Consultor digita em reais → convertemos para centavos ao salvar.
        patch: { amountCents: reaisToCents(reais), note: replyNote.trim() || null },
      });
      toast({ title: "Contraproposta enviada!" });
      setReplyOpen(false);
      setReplyNote("");
    } catch (err) {
      toast({
        title: "Erro ao responder",
        description: err instanceof Error ? err.message : "Falha desconhecida",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="bg-white border border-pv-surface hover:border-pv-accent transition-colors p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 border ${STATUS_COLOR[proposal.status]}`}
                >
                  {PROPOSAL_STATUS_LABEL[proposal.status]}
                </span>
                {validityLabel && (
                  <span
                    className={`text-[10px] font-medium ${
                      validityUrgent ? "text-pv-gold" : "text-pv-ink/50"
                    }`}
                  >
                    {validityLabel}
                  </span>
                )}
              </div>
              <h4 className={`text-xl text-pv-ink mt-2 leading-tight ${pvSerif}`}>
                {recipientLabel}
              </h4>
              <p className="text-xs text-pv-ink/60 mt-1">
                {productName} · <span className="text-pv-ink font-semibold">{amountLabel}</span>
              </p>
            </div>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="text-pv-ink/40 hover:text-pv-ink p-1"
                title="Ver histórico"
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </button>
            </CollapsibleTrigger>
          </div>

          <div className="mt-4 pt-3 border-t border-pv-bg flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1">
              <IconBtn onClick={handleCopy} title="Copiar link">
                <Copy className="h-3.5 w-3.5" />
              </IconBtn>
              {proposal.recipientPhone && (
                <IconBtn onClick={handleWhatsApp} disabled={sending} title="Enviar no WhatsApp">
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </IconBtn>
              )}
              {proposal.status === "countered" && (
                <IconBtn onClick={() => setReplyOpen(true)} title="Responder contraproposta">
                  <MessageSquare className="h-3.5 w-3.5" />
                </IconBtn>
              )}
              {["draft", "sent", "expired"].includes(proposal.status) && (
                <IconBtn onClick={onDelete} title="Excluir" danger>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconBtn>
              )}
            </div>
          </div>

          <CollapsibleContent className="mt-4 pt-4 border-t border-pv-bg">
            {eventsLoading ? (
              <div className="flex justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin text-pv-ink/40" />
              </div>
            ) : events.length === 0 ? (
              <p className="text-[10px] text-pv-ink/50 italic">Sem eventos registrados.</p>
            ) : (
              <div className="space-y-2 border-l-2 border-pv-mid/40 pl-3">
                {events.map((ev, i) => (
                  <div key={i} className="text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="font-bold uppercase tracking-wider text-pv-ink text-[10px]">
                        {ev.type.replace("_", " ")}
                      </span>
                      <span className="text-pv-ink/50">
                        {new Date(ev.createdAt).toLocaleString("pt-BR")}
                      </span>
                    </div>
                    {ev.counterAmountCents !== null && (
                      <p className="text-pv-ink/70">Valor: {BRL(ev.counterAmountCents)}</p>
                    )}
                    {ev.note && <p className="text-pv-ink/70 italic">{ev.note}</p>}
                  </div>
                ))}
              </div>
            )}
          </CollapsibleContent>
        </div>
      </Collapsible>

      <Dialog open={replyOpen} onOpenChange={setReplyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Responder contraproposta</DialogTitle>
            <DialogDescription>
              Envie uma nova proposta com valor atualizado para {recipientLabel}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Novo valor (R$)</label>
              <Input
                type="number"
                value={replyAmount}
                onChange={(e) => setReplyAmount(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Nota (opcional)</label>
              <Textarea
                value={replyNote}
                onChange={(e) => setReplyNote(e.target.value)}
                className="text-sm min-h-[60px] resize-none"
                placeholder="Mensagem para acompanhar..."
              />
            </div>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setReplyOpen(false)}
              className="px-4 py-2 text-xs uppercase tracking-widest text-pv-ink/60 hover:text-pv-ink"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleReply}
              disabled={replyToCounter.isPending}
              className="inline-flex items-center gap-2 bg-pv-ink hover:bg-pv-accent text-white px-5 py-2.5 text-xs font-semibold uppercase tracking-widest transition-colors disabled:opacity-50"
            >
              {replyToCounter.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Enviar resposta
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-7 w-7 inline-flex items-center justify-center border transition-colors ${
        danger
          ? "border-red-200 text-red-500 hover:bg-red-50"
          : "border-pv-surface text-pv-ink/70 hover:border-pv-accent hover:text-pv-ink"
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}
