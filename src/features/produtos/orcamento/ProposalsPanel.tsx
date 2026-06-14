// =============================================================================
// Orçamento — Painel de propostas enviadas
// =============================================================================
// Lista os orçamentos do consultor com status, validade, ações (copiar link,
// WhatsApp, responder contraproposta) e timeline de eventos expandível.
// =============================================================================

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

type StatusFilter = "all" | "pending" | "accepted" | "closed";

const PENDING: ProposalStatus[] = ["sent", "viewed", "countered"];
const CLOSED: ProposalStatus[] = ["rejected", "expired", "draft"];

const STATUS_COLOR: Record<ProposalStatus, string> = {
  draft: "bg-zinc-500/15 text-zinc-300",
  sent: "bg-sky-500/15 text-sky-300",
  viewed: "bg-indigo-500/15 text-indigo-300",
  accepted: "bg-emerald-500/15 text-emerald-300",
  rejected: "bg-red-500/15 text-red-300",
  countered: "bg-amber-500/15 text-amber-300",
  expired: "bg-zinc-500/15 text-zinc-400",
};

const PUBLIC_BASE = "https://igreen.cloud";
const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Orçamentos enviados</h3>
          <Badge variant="secondary" className="text-[10px]">{proposals.length}</Badge>
        </div>
        <div className="flex gap-1">
          {(
            [
              ["all", "Todas"],
              ["pending", "Aguardando"],
              ["accepted", "Aceitas"],
              ["closed", "Encerradas"],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              variant={filter === key ? "default" : "outline"}
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => setFilter(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-10">
          {proposals.length === 0
            ? "Nenhum orçamento criado ainda. Use o botão Orçamento no topo para enviar sua primeira proposta."
            : "Nenhum orçamento neste filtro."}
        </p>
      ) : (
        <div className="rounded-xl border border-border/60 overflow-hidden divide-y divide-border/40">
          {filtered.map((proposal) => (
            <ProposalRow
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

interface ProposalRowProps {
  proposal: Proposal;
  productName: string;
  consultantId: string;
  instanceName?: string | null;
  isWhapi?: boolean;
  onDelete: () => void;
}

function ProposalRow({
  proposal,
  productName,
  consultantId,
  instanceName,
  isWhapi,
  onDelete,
}: ProposalRowProps) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyAmount, setReplyAmount] = useState(String(proposal.amount ?? ""));
  const [replyNote, setReplyNote] = useState("");
  const [sending, setSending] = useState(false);

  const replyToCounter = useReplyToCounter(consultantId);
  const { data: events = [], isLoading: eventsLoading } = useProposalEvents(
    expanded ? proposal.id : undefined,
  );

  const link = `${PUBLIC_BASE}/proposta/${proposal.publicToken}`;
  const recipientLabel =
    proposal.recipientName ||
    proposal.recipientPhone ||
    "Destinatário";

  const amountLabel = proposal.amount
    ? `${BRL(proposal.amount)}${proposal.amountPeriod === "month" ? "/mês" : ""}`
    : "—";

  const handleCopy = () => {
    navigator.clipboard.writeText(link);
    toast({ title: "Link copiado!" });
  };

  const handleWhatsApp = async () => {
    const phone = proposal.recipientPhone;
    if (!phone) {
      toast({ title: "Telefone não disponível", description: "Este orçamento foi enviado a um cliente da base.", variant: "destructive" });
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
      `${proposal.amount ? `Valor: *${amountLabel}*\n` : ""}` +
      `\nVeja os detalhes e responda por aqui:\n${link}`;

    const result = await sendWhatsAppMessage({
      instanceName,
      phone,
      mediaCategory: "text",
      text,
      isWhapi,
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
    const amount = Number(replyAmount);
    if (!amount || amount <= 0) {
      toast({ title: "Informe um valor válido", variant: "destructive" });
      return;
    }
    try {
      await replyToCounter.mutateAsync({
        proposalId: proposal.id,
        patch: { amount, note: replyNote.trim() || null },
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
        <div className="px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-medium text-foreground truncate">{recipientLabel}</p>
                <Badge className={`text-[10px] ${STATUS_COLOR[proposal.status]}`}>
                  {PROPOSAL_STATUS_LABEL[proposal.status]}
                </Badge>
                <ValidityBadge validUntil={proposal.validUntil} status={proposal.status} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {productName} · {amountLabel}
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy} title="Copiar link">
                <Copy className="h-3.5 w-3.5" />
              </Button>
              {proposal.recipientPhone && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleWhatsApp}
                  disabled={sending}
                  title="Enviar no WhatsApp"
                >
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              )}
              {proposal.status === "countered" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setReplyOpen(true)}
                  title="Responder contraproposta"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </Button>
              )}
              {["draft", "sent", "expired"].includes(proposal.status) && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete} title="Excluir">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver histórico">
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>

          <CollapsibleContent className="mt-3">
            {eventsLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : events.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">Sem eventos registrados.</p>
            ) : (
              <div className="space-y-2 border-l-2 border-border/60 pl-3 ml-1">
                {events.map((ev, i) => (
                  <div key={i} className="text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground capitalize">{ev.type.replace("_", " ")}</span>
                      <span className="text-muted-foreground">
                        {new Date(ev.createdAt).toLocaleString("pt-BR")}
                      </span>
                    </div>
                    {ev.counterAmount !== null && (
                      <p className="text-muted-foreground">Valor: {BRL(ev.counterAmount)}</p>
                    )}
                    {ev.note && <p className="text-muted-foreground">{ev.note}</p>}
                    {ev.attachmentUrl && (
                      <a
                        href={ev.attachmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        Ver anexo
                      </a>
                    )}
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
                placeholder="Mensagem para acompanhar a contraproposta..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplyOpen(false)}>Cancelar</Button>
            <Button onClick={handleReply} disabled={replyToCounter.isPending}>
              {replyToCounter.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Enviar resposta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ValidityBadge({
  validUntil,
  status,
}: {
  validUntil: string | null;
  status: ProposalStatus;
}) {
  if (!validUntil || status === "accepted" || status === "rejected" || status === "expired") {
    if (status === "expired") {
      return <Badge variant="outline" className="text-[10px] text-zinc-400">Expirada</Badge>;
    }
    return null;
  }

  const daysLeft = Math.ceil((new Date(validUntil).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 0) {
    return <Badge variant="outline" className="text-[10px] text-zinc-400">Expirada</Badge>;
  }
  if (daysLeft <= 2) {
    return <Badge variant="outline" className="text-[10px] text-amber-400">Expira em {daysLeft}d</Badge>;
  }
  return <Badge variant="outline" className="text-[10px] text-muted-foreground">Válida {daysLeft}d</Badge>;
}
