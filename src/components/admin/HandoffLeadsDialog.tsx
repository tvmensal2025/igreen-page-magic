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
import { supabase } from "@/integrations/supabase/client";
import {
  formatHandoffReason,
  formatSecurityReason,
  loadHandoffLeads,
  returnHandoffsToPizza,
  type BlockedCategory,
  type HandoffLead,
} from "@/lib/handoffReturnToPizza";
import { toast } from "sonner";

const SESSION_AUTO_KEY = "igreen-handoff-modal-auto";

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
  const [filter, setFilter] = useState<"all" | BlockedCategory>("all");

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

  const filteredRows = filter === "all" ? rows : rows.filter((r) => r.category === filter);
  const counts = {
    all: rows.length,
    handoff: rows.filter((r) => r.category === "handoff").length,
    security: rows.filter((r) => r.category === "security").length,
    other: rows.filter((r) => r.category === "other").length,
  };

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandHelping className="h-5 w-5 text-amber-600" />
            Leads fora da pizza — escolha o que fazer
          </DialogTitle>
          <DialogDescription>
            Aqui estão <strong>todos os leads fora do ciclo</strong>: handoff humano e bloqueados por segurança
            (telefone inválido, DNC, opt-out). Use <strong>Voltar à pizza</strong> para reativar a cadência, ou
            <strong> Bloquear</strong> para não receber mais contato.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              { key: "all", label: "Todos" },
              { key: "handoff", label: "Handoff humano" },
              { key: "security", label: "Bloqueados por segurança" },
              ...(counts.other > 0 ? [{ key: "other" as const, label: "Outros" }] : []),
            ] as Array<{ key: "all" | BlockedCategory; label: string }>).map((chip) => {
              const active = filter === chip.key;
              const n = counts[chip.key as keyof typeof counts];
              return (
                <Button
                  key={chip.key}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setFilter(chip.key)}
                >
                  {chip.label}
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{n}</Badge>
                </Button>
              );
            })}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()} disabled={loading || busy}>
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
                const isSecurity = row.category === "security";
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
                    <div className="font-medium text-sm">{row.displayName}</div>
                    <div className="text-xs text-muted-foreground">{row.phoneFormatted}</div>
                    {row.alertMessage && (
                      <div className="text-[11px] italic text-foreground/70 mt-0.5 line-clamp-2">
                        “{row.alertMessage.slice(0, 120)}”
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs max-w-[200px]">
                    <Badge
                      variant={isSecurity ? "destructive" : "secondary"}
                      className="mb-1 text-[10px]"
                    >
                      {isSecurity ? "Bloqueado" : row.category === "handoff" ? "Handoff" : "Outro"}
                    </Badge>
                    <div>
                      {isSecurity
                        ? formatSecurityReason(row.pausedReasonRaw)
                        : formatHandoffReason(row.alertReason || row.botPausedReason || "handoff_humano")}
                    </div>
                    {row.botPaused && !isSecurity && (
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
                        title={isSecurity ? "Reativa o lead mesmo bloqueado — use com cuidado" : "Devolve o lead à pizza A/B/C"}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />
                        Voltar à pizza
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
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            <Button
              type="button"
              disabled={busy || selectedIds.length === 0}
              onClick={() => void returnSelected(selectedIds)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RotateCcw className="h-4 w-4 mr-1" />}
              Voltar selecionados à pizza
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
            {count} lead(s) fora da pizza — handoff + bloqueados por segurança
          </span>
          <span className="block text-[11px] text-sky-900/80 dark:text-sky-100/80">
            Escolha lead a lead: <strong>Voltar à pizza</strong> reativa o ciclo, <strong>Bloquear</strong> encerra o contato.
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
