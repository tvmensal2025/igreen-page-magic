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
import { toast } from "sonner";

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
      toast.error(e instanceof Error ? e.message : "Erro ao carregar leads fora da pizza");
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
      toast.error(result.lastError || "Falha ao devolver à pizza");
      return;
    }
    if (result.failed) {
      toast.warning(`${result.ok} devolvido(s); ${result.failed} falhou(aram)`);
    } else {
      toast.success(`${result.ok} lead(s) voltaram à pizza — motor retoma no próximo tick`);
    }
    await reload();
    onChanged?.();
  }

  async function forgetSelected(ids: string[]) {
    if (!ids.length) return;
    const ok = window.confirm(
      `Esquecer ${ids.length} lead(s)?\n\nEles saem do ciclo automático (como “já cliente”). Você ainda pode falar no WhatsApp à mão. Não é bloqueio.`,
    );
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
    const ok = window.confirm(
      `Bloquear ${row.displayName}?\n\nO lead sai do handoff e nunca mais recebe mensagem automática (WhatsApp, SMS ou ligação). Não volta para a pizza.`,
    );
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HandHelping className="h-5 w-5 text-amber-600" />
              Leads fora da pizza — escolha o que fazer
            </DialogTitle>
            <DialogDescription>
              Só handoff com telefone útil (sem celular / já bloqueados não entram). Clique no{" "}
              <strong>nome</strong> para ver a conversa.{" "}
              <strong>Voltar à pizza</strong> reativa o ciclo;{" "}
              <strong>Esquecer</strong> tira do automático;{" "}
              <strong>Bloquear</strong> encerra o contato.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {counts.all} lead(s) aguardando você
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void reload()}
              disabled={loading || busy}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>

          {loading && rows.length === 0 ? (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : filteredRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {rows.length === 0 ? "Nenhum lead fora da pizza." : "Nenhum lead nesta categoria."}
            </p>
          ) : (
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
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => {
                  return (
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
                          Handoff
                        </Badge>
                        <div>
                          {formatHandoffReason(
                            row.alertReason || row.botPausedReason || "handoff_humano",
                          )}
                        </div>
                        {row.botPaused && (
                          <Badge variant="outline" className="mt-1 text-[10px]">
                            Bot pausado
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>{row.grupoLabel}</div>
                        <div className="text-muted-foreground">{row.stageLabel}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1 flex-wrap">
                          {onOpenChat && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              onClick={() => openConversation(row)}
                              title="Abrir no WhatsApp"
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            className="h-8 text-xs"
                            disabled={busy}
                            onClick={() => void returnSelected([row.cadenceId])}
                            title="Devolve o lead à pizza A/B/C"
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />
                            Voltar à pizza
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-8 text-xs"
                            disabled={busy}
                            onClick={() => void forgetSelected([row.cadenceId])}
                            title="Sai do ciclo automático — WhatsApp manual continua ok"
                          >
                            <UserMinus className="h-3.5 w-3.5 mr-1" />
                            Esquecer
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            className="h-8 text-xs"
                            disabled={busy}
                            onClick={() => void blockContact(row)}
                            title="Bloqueia contato e remove sem voltar para a pizza"
                          >
                            <Ban className="h-3.5 w-3.5 mr-1" />
                            Bloquear
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <span className="text-xs text-muted-foreground self-center">
              {selectedIds.length} selecionado(s)
            </span>
            <div className="flex gap-2 flex-wrap">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || selectedIds.length === 0}
                onClick={() => void forgetSelected(selectedIds)}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <UserMinus className="h-4 w-4 mr-1" />
                )}
                Esquecer selecionados
              </Button>
              <Button
                type="button"
                disabled={busy || selectedIds.length === 0}
                onClick={() => void returnSelected(selectedIds)}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-1" />
                )}
                Voltar selecionados à pizza
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
            {count} lead(s) em handoff — fora da pizza
          </span>
          <span className="block text-[11px] text-sky-900/80 dark:text-sky-100/80">
            Clique no nome para ver a conversa. <strong>Voltar à pizza</strong>,{" "}
            <strong>Esquecer</strong> ou <strong>Bloquear</strong>.
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
