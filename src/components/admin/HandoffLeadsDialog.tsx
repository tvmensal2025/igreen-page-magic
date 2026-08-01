/**
 * Banner + dialog: leads em handoff (fora da pizza) com ação “Voltar à pizza”.
 */
import { useCallback, useEffect, useState } from "react";
import {
  HandHelping,
  Loader2,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Ban,
  UserMinus,
} from "lucide-react";
import { suppressContact } from "@/services/contactSuppression";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import {
  formatHandoffReason,
  forgetHandoffLeads,
  loadHandoffLeads,
  returnHandoffsToPizza,
  type HandoffLead,
} from "@/lib/handoffReturnToPizza";
import { HandoffLeadPreviewDialog } from "@/components/admin/HandoffLeadPreviewDialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";

const SESSION_AUTO_KEY = "igreen-handoff-modal-auto";

function initials(name: string, phone: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1 && parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
  const d = String(phone || "").replace(/\D/g, "");
  return d.slice(-2) || "?";
}

type DialogProps = {
  consultantId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChat?: (phone: string) => void;
  onChanged?: () => void;
};

export function HandoffLeadsDialog({
  consultantId,
  open,
  onOpenChange,
  onOpenChat,
  onChanged,
}: DialogProps) {
  const confirm = useConfirm();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<HandoffLead[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewLead, setPreviewLead] = useState<HandoffLead | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await loadHandoffLeads(consultantId);
      setRows(list);
      setSelected(new Set());
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar atendimentos pausados");
    } finally {
      setLoading(false);
    }
  }, [consultantId]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const filteredRows = rows;
  const counts = { all: rows.length };

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(filteredRows.map((r) => r.cadenceId)) : new Set());
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  async function returnSelected(ids: string[]) {
    if (!ids.length) return;
    const { data: auth } = await supabase.auth.getUser();
    const resolvedBy = auth.user?.id || consultantId;
    setBusy(true);
    const byId = new Map(rows.map((r) => [r.cadenceId, r]));
    const items = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((r) => ({ customerId: r!.customerId, cadenceId: r!.cadenceId }));
    const result = await returnHandoffsToPizza({ items, resolvedBy });
    setBusy(false);
    if (result.failed && !result.ok) {
      toast.error(result.lastError || "Falha ao devolver ao acompanhamento");
      return;
    }
    if (result.failed) {
      toast.warning(`${result.ok} devolvido(s); ${result.failed} falhou(aram)`);
    } else {
      toast.success(`${result.ok} contato(s) voltaram ao acompanhamento — o sistema retoma em breve`);
    }
    await reload();
    onChanged?.();
  }

  async function forgetSelected(ids: string[]) {
    if (!ids.length) return;
    const ok = await confirm({
      title:
        ids.length === 1
          ? "Esquecer acompanhamento deste contato?"
          : `Esquecer acompanhamento de ${ids.length} contatos?`,
      description:
        "Eles saem do ciclo automático (como “já cliente”). Você ainda pode falar no WhatsApp à mão. Isso não é bloqueio.",
      confirmText: "Esquecer acompanhamento",
      cancelText: "Voltar",
      tone: "info",
    });
    if (!ok) return;
    setBusy(true);
    const byId = new Map(rows.map((r) => [r.cadenceId, r]));
    const items = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((r) => ({ customerId: r!.customerId, cadenceId: r!.cadenceId }));
    const result = await forgetHandoffLeads({ items });
    setBusy(false);
    if (result.failed && !result.ok) {
      toast.error(result.lastError || "Não deu para esquecer");
      return;
    }
    if (result.failed) {
      toast.warning(`${result.ok} esquecido(s); ${result.failed} falhou(aram)`);
    } else {
      toast.success(`${result.ok} esquecido(s) — fora do ciclo automático`);
    }
    await reload();
    onChanged?.();
  }

  const openConversation = (row: HandoffLead) => {
    if (!row.phone) {
      toast.error("Sem telefone para abrir o chat");
      return;
    }
    onOpenChat?.(row.phone);
    onOpenChange(false);
  };

  async function blockContact(row: HandoffLead) {
    const ok = await confirm({
      title: `Bloquear ${row.displayName}?`,
      description:
        "O contato sai desta lista e nunca mais recebe mensagem automática (WhatsApp, SMS ou ligação). Não volta para o acompanhamento automático.",
      confirmText: "Bloquear contato",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    const res = await suppressContact({
      consultantId,
      customerId: row.customerId,
      phone: row.phone,
      reason: "requested",
      channel: "handoff_dialog",
      notes: "Bloqueado a partir do painel de handoff",
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Falha ao bloquear contato");
      return;
    }
    toast.success(`${row.displayName} bloqueado — não recebe mais contatos`);
    await reload();
    onChanged?.();
  }

  const selectedIds = Array.from(selected);

  function renderLeadActions(row: HandoffLead, compact?: boolean) {
    return (
      <div
        className={cn(
          "gap-1.5",
          compact ? "grid grid-cols-2 w-full" : "flex justify-end flex-wrap",
        )}
      >
        <Button
          type="button"
          size="sm"
          className={cn("h-8 text-xs", compact && "col-span-2 justify-center")}
          disabled={busy}
          onClick={() => void returnSelected([row.cadenceId])}
          title="Devolve o lead ao acompanhamento automático"
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5 shrink-0" />
          {compact ? "Voltar ao ciclo" : "Voltar ao acompanhamento"}
        </Button>
        {onOpenChat && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => openConversation(row)}
            title="Abrir no WhatsApp"
          >
            <MessageCircle className="h-3.5 w-3.5 mr-1.5 shrink-0" />
            WhatsApp
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(
            "h-8 text-xs text-muted-foreground hover:text-foreground",
            !onOpenChat && compact && "col-span-2",
          )}
          disabled={busy}
          onClick={() => void forgetSelected([row.cadenceId])}
          title="Sai do ciclo automático — use se já é cliente. WhatsApp manual continua ok"
        >
          <UserMinus className="h-3.5 w-3.5 mr-1.5 shrink-0" />
          Esquecer
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(
            "h-8 text-xs border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive",
            !onOpenChat && compact && "col-span-2",
          )}
          disabled={busy}
          onClick={() => void blockContact(row)}
          title="Bloqueia contato e remove sem voltar ao acompanhamento automático"
        >
          <Ban className="h-3.5 w-3.5 mr-1.5 shrink-0" />
          Bloquear
        </Button>
      </div>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(
            "w-[calc(100%-1rem)] max-w-4xl p-0 gap-0 overflow-hidden flex flex-col",
            "max-h-[min(92dvh,900px)] h-[min(92dvh,900px)] sm:h-auto sm:max-h-[min(90dvh,860px)]",
          )}
        >
          <DialogHeader className="px-4 sm:px-6 pt-5 pb-3 pr-12 border-b shrink-0 text-left space-y-2">
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <HandHelping className="h-5 w-5 text-amber-600 shrink-0" />
              <span className="leading-snug">Atendimentos pausados</span>
            </DialogTitle>
            <DialogDescription className="text-left text-xs sm:text-sm leading-relaxed">
              Contatos em que a IA pausou. Toque no nome para ver a conversa.{" "}
              <strong>Voltar</strong> reativa o ciclo · <strong>Esquecer</strong> tira do automático ·{" "}
              <strong>Bloquear</strong> encerra o contato.
            </DialogDescription>
          </DialogHeader>

          <div className="px-4 sm:px-6 py-2.5 flex items-center justify-between gap-2 flex-wrap border-b bg-muted/30 shrink-0">
            <Badge variant="secondary" className="text-xs">
              {counts.all} aguardando você
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => void reload()}
              disabled={loading || busy}
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1", loading && "animate-spin")} />
              Atualizar
            </Button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-4 py-3">
            {loading && rows.length === 0 ? (
              <div className="flex justify-center items-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Carregando…</span>
              </div>
            ) : filteredRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-12 text-center px-4">
                {rows.length === 0
                  ? "Nenhum atendimento pausado aguardando."
                  : "Nenhum contato nesta categoria."}
              </p>
            ) : (
              <>
                {/* Mobile: cards (padrão SlaBacklog) */}
                <div className="md:hidden space-y-3">
                  <label className="flex items-center gap-2 px-2 py-2 rounded-md border border-border/50 bg-muted/40">
                    <Checkbox
                      checked={selected.size === filteredRows.length && filteredRows.length > 0}
                      onCheckedChange={(v) => toggleAll(!!v)}
                      aria-label="Selecionar todos"
                    />
                    <span className="text-xs font-medium">
                      Selecionar todos ({filteredRows.length})
                    </span>
                  </label>
                  {filteredRows.map((row) => (
                    <div
                      key={row.cadenceId}
                      className="rounded-lg border border-border/70 bg-card p-3 space-y-3"
                    >
                      <div className="flex items-start gap-2">
                        <Checkbox
                          className="mt-1.5"
                          checked={selected.has(row.cadenceId)}
                          onCheckedChange={(v) => toggleOne(row.cadenceId, !!v)}
                          aria-label={`Selecionar ${row.displayName}`}
                        />
                        <button
                          type="button"
                          className="flex items-start gap-2 text-left min-w-0 flex-1 rounded-md hover:bg-muted/50 -m-1 p-1 transition-colors"
                          onClick={() => setPreviewLead(row)}
                          title="Ver conversa"
                        >
                          <Avatar className="h-10 w-10 shrink-0 border border-border">
                            {row.photoUrl ? <AvatarImage src={row.photoUrl} alt="" /> : null}
                            <AvatarFallback className="text-[11px] font-semibold">
                              {initials(row.displayName, row.phone)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-sm truncate underline-offset-2 hover:underline">
                              {row.displayName}
                            </div>
                            <div className="text-[11px] text-muted-foreground font-mono">
                              {row.phoneFormatted}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-1">
                              {row.grupoLabel} · {row.stageLabel}
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              <Badge variant="secondary" className="text-[10px]">
                                Precisa de você
                              </Badge>
                              {row.botPaused && (
                                <Badge variant="outline" className="text-[10px]">
                                  Automático pausado
                                </Badge>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
                              {formatHandoffReason(
                                row.alertReason || row.botPausedReason || "handoff_humano",
                              )}
                            </p>
                            {row.alertMessage && (
                              <p className="text-[11px] italic text-foreground/70 mt-1 line-clamp-2">
                                “{row.alertMessage.slice(0, 120)}”
                              </p>
                            )}
                          </div>
                        </button>
                      </div>
                      {renderLeadActions(row, true)}
                    </div>
                  ))}
                </div>

                {/* Desktop: tabela */}
                <div className="hidden md:block overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={selected.size === filteredRows.length && filteredRows.length > 0}
                            onCheckedChange={(v) => toggleAll(!!v)}
                            aria-label="Selecionar todos"
                          />
                        </TableHead>
                        <TableHead>Lead</TableHead>
                        <TableHead>Motivo</TableHead>
                        <TableHead>Estágio</TableHead>
                        <TableHead className="text-right min-w-[280px]">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRows.map((row) => (
                        <TableRow key={row.cadenceId}>
                          <TableCell>
                            <Checkbox
                              checked={selected.has(row.cadenceId)}
                              onCheckedChange={(v) => toggleOne(row.cadenceId, !!v)}
                              aria-label={`Selecionar ${row.displayName}`}
                            />
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              className="flex items-center gap-2 text-left w-full rounded-md hover:bg-muted/60 -mx-1 px-1 py-0.5 transition-colors"
                              onClick={() => setPreviewLead(row)}
                              title="Ver conversa"
                            >
                              <Avatar className="h-9 w-9 shrink-0 border border-border">
                                {row.photoUrl ? <AvatarImage src={row.photoUrl} alt="" /> : null}
                                <AvatarFallback className="text-[11px] font-semibold">
                                  {initials(row.displayName, row.phone)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <div className="font-medium text-sm truncate underline-offset-2 hover:underline">
                                  {row.displayName}
                                </div>
                                <div className="text-xs text-muted-foreground">{row.phoneFormatted}</div>
                                {row.alertMessage && (
                                  <div className="text-[11px] italic text-foreground/70 mt-0.5 line-clamp-2">
                                    “{row.alertMessage.slice(0, 120)}”
                                  </div>
                                )}
                              </div>
                            </button>
                          </TableCell>
                          <TableCell className="text-xs max-w-[200px]">
                            <Badge variant="secondary" className="mb-1 text-[10px]">
                              Precisa de você
                            </Badge>
                            <div>
                              {formatHandoffReason(
                                row.alertReason || row.botPausedReason || "handoff_humano",
                              )}
                            </div>
                            {row.botPaused && (
                              <Badge variant="outline" className="mt-1 text-[10px]">
                                Automático pausado
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div>{row.grupoLabel}</div>
                            <div className="text-muted-foreground">{row.stageLabel}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            {renderLeadActions(row)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="shrink-0 border-t px-4 sm:px-6 py-3 gap-2 flex-col-reverse sm:flex-row sm:items-center sm:justify-between bg-background">
            <span className="text-xs text-muted-foreground self-center sm:self-auto order-last sm:order-first">
              {selectedIds.length} selecionado(s)
            </span>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => onOpenChange(false)}
              >
                Fechar
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto text-muted-foreground"
                disabled={busy || selectedIds.length === 0}
                onClick={() => void forgetSelected(selectedIds)}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <UserMinus className="h-4 w-4 mr-1" />
                )}
                Esquecer
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={busy || selectedIds.length === 0}
                onClick={() => void returnSelected(selectedIds)}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-1" />
                )}
                Voltar ao acompanhamento
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HandoffLeadPreviewDialog
        lead={previewLead}
        open={!!previewLead}
        onOpenChange={(next) => {
          if (!next) setPreviewLead(null);
        }}
        onOpenChat={onOpenChat}
      />
    </>
  );
}

/** Banner na pizza — avisa handoffs fora do ciclo. */
export function HandoffLeadsBanner({
  consultantId,
  onOpenChat,
  onChanged,
}: {
  consultantId: string;
  onOpenChat?: (phone: string) => void;
  onChanged?: () => void;
}) {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);

  const reloadCount = useCallback(async () => {
    try {
      const list = await loadHandoffLeads(consultantId);
      setCount(list.length);
      if (list.length > 0) {
        try {
          if (!sessionStorage.getItem(SESSION_AUTO_KEY)) {
            sessionStorage.setItem(SESSION_AUTO_KEY, "1");
            setOpen(true);
          }
        } catch {
          /* ignore storage */
        }
      }
    } catch {
      /* silencioso no banner */
    }
  }, [consultantId]);

  useEffect(() => {
    void reloadCount();
    const t = setInterval(() => void reloadCount(), 120_000);
    return () => clearInterval(t);
  }, [reloadCount]);

  if (count === 0) return null;

  return (
    <>
      <div
        role="alert"
        className="mb-3 rounded-lg border-2 border-sky-500/70 bg-sky-500/12 px-3 py-2.5 flex flex-wrap items-center gap-2"
      >
        <HandHelping className="h-4 w-4 text-sky-700 shrink-0" />
        <div className="min-w-0 flex-1 text-sm">
          <span className="font-semibold text-sky-950 dark:text-sky-50">
            {count} atendimento(s) pausado(s) — escolha o que fazer
          </span>
          <span className="block text-[11px] text-sky-900/80 dark:text-sky-100/80">
            Clique no nome para ver a conversa.{" "}
            <strong>Voltar ao acompanhamento</strong>,{" "}
            <strong>Esquecer acompanhamento</strong> ou <strong>Bloquear</strong>.
          </span>
        </div>
        <Button type="button" size="sm" className="h-8 text-xs" onClick={() => setOpen(true)}>
          Ver todos
        </Button>
      </div>
      <HandoffLeadsDialog
        consultantId={consultantId}
        open={open}
        onOpenChange={setOpen}
        onOpenChat={onOpenChat}
        onChanged={() => {
          void reloadCount();
          onChanged?.();
        }}
      />
    </>
  );
}
