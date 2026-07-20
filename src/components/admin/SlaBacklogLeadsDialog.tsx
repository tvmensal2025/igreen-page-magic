import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MessageCircle,
  PauseCircle,
  RefreshCw,
  UserMinus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { normalizeBrazilPhone, validateBrazilPhone } from "@/lib/phone";
import { supabase } from "@/integrations/supabase/client";
import { suppressContact } from "@/services/contactSuppression";
import {
  loadSlaBacklogLeads,
  summarizeSlaBacklog,
  type SlaBacklogLead,
} from "@/lib/slaBacklogLeads";
import { toast } from "sonner";

const FAR_FUTURE_MS = 3650 * 24 * 3600_000;
const SESSION_AUTO_KEY = "igreen-sla-backlog-modal-auto";

type Props = {
  consultantId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChat?: (phone: string) => void;
  onChanged?: () => void;
};

type GrupoFilter = "all" | "A" | "B";

export function SlaBacklogLeadsDialog({
  consultantId,
  open,
  onOpenChange,
  onOpenChat,
  onChanged,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<SlaBacklogLead[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<GrupoFilter>("all");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await loadSlaBacklogLeads(consultantId);
      setRows(list);
      setSelected(new Set(list.map((r) => r.id)));
    } finally {
      setLoading(false);
    }
  }, [consultantId]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const summary = useMemo(() => summarizeSlaBacklog(rows), [rows]);

  const visible = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.grupo === filter);
  }, [rows, filter]);

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(visible.map((r) => r.id)) : new Set());
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  async function releaseIds(ids: string[]) {
    if (!ids.length) return;
    setBusy(true);
    const now = new Date().toISOString();
    for (let i = 0; i < ids.length; i += 80) {
      const { error } = await supabase
        .from("lead_cadence_state")
        .update({
          paused_until: null,
          paused_reason: null,
          next_action_at: now,
        })
        .in("id", ids.slice(i, i + 80));
      if (error) {
        toast.error(error.message);
        setBusy(false);
        return;
      }
    }
    toast.success(`${ids.length} lead(s) liberado(s) — entram na fila do motor agora`);
    setBusy(false);
    await reload();
    onChanged?.();
  }

  /** Já cliente / família — sai do ciclo sem bloquear o Zap manual. */
  async function forgetIds(ids: string[]) {
    if (!ids.length) return;
    setBusy(true);
    for (let i = 0; i < ids.length; i += 80) {
      const { error } = await supabase
        .from("lead_cadence_state")
        .update({
          stage: "WON",
          paused_until: null,
          paused_reason: "manual_won",
          next_action_at: null,
        } as never)
        .in("id", ids.slice(i, i + 80));
      if (error) {
        toast.error(error.message);
        setBusy(false);
        return;
      }
    }
    toast.success(`${ids.length} esquecido(s) — fora do ciclo (já cliente)`);
    setBusy(false);
    await reload();
    onChanged?.();
  }

  async function dncIds(ids: string[]) {
    if (!ids.length) return;
    setBusy(true);
    const until = new Date(Date.now() + FAR_FUTURE_MS).toISOString();
    const byId = new Map(rows.map((r) => [r.id, r]));
    let ok = 0;
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) continue;
      const block = await suppressContact({
        consultantId,
        customerId: row.customerId,
        phone: row.phone,
        reason: "opt_out",
        channel: "sla_backlog_review",
        notes: "Validado no dashboard — nunca mais contatar",
      });
      if (!block.ok) {
        toast.error(`Falha ao bloquear ${row.displayName}`, { description: block.error });
        continue;
      }
      const { error } = await supabase
        .from("lead_cadence_state")
        .update({
          paused_until: until,
          paused_reason: "dnc",
          next_action_at: until,
        })
        .eq("id", id);
      if (error) {
        toast.error(error.message);
        setBusy(false);
        return;
      }
      ok++;
    }
    toast.success(`${ok} marcado(s) como bloqueado — sem mensagens automáticas`);
    setBusy(false);
    await reload();
    onChanged?.();
  }

  const selectedIds = [...selected].filter((id) => visible.some((r) => r.id === id));

  const openConversation = (row: SlaBacklogLead) => {
    if (!onOpenChat) {
      toast.error("Abra pelo painel do consultor (dashboard com WhatsApp conectado).");
      return;
    }
    const phone = normalizeBrazilPhone(row.phone);
    const check = validateBrazilPhone(phone);
    if (!check.valid) {
      toast.error("Telefone inválido — não dá para abrir o histórico.");
      return;
    }
    onOpenChange(false);
    onOpenChat(phone);
  };

  const LeadActions = ({ row, compact }: { row: SlaBacklogLead; compact?: boolean }) => (
    <div className={cn("flex gap-1.5", compact ? "flex-col w-full" : "justify-end flex-wrap")}>
      <Button
        type="button"
        size="sm"
        variant="default"
        className={cn("gap-1.5", compact ? "w-full h-9" : "h-8 text-xs")}
        disabled={!row.phone || busy}
        onClick={() => openConversation(row)}
      >
        <MessageCircle className="h-3.5 w-3.5 shrink-0" />
        Ver conversa
      </Button>
      <div className={cn("flex gap-1.5 flex-wrap", compact && "w-full")}>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={cn("gap-1", compact ? "flex-1 h-8 text-xs min-w-[5.5rem]" : "h-8 text-xs")}
          disabled={busy}
          onClick={() => void forgetIds([row.id])}
          title="Já cliente / fora do ciclo — sem automação"
        >
          <UserMinus className="h-3 w-3" />
          Esquecer
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn("gap-1", compact ? "flex-1 h-8 text-xs" : "h-8 text-xs")}
          disabled={busy}
          onClick={() => void releaseIds([row.id])}
          title="Volta à onda do motor"
        >
          <CheckCircle2 className="h-3 w-3" />
          Liberar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className={cn("gap-1", compact ? "flex-1 h-8 text-xs" : "h-8 text-xs")}
          disabled={busy}
          onClick={() => void dncIds([row.id])}
          title="Nunca mais contatar"
        >
          <Ban className="h-3 w-3" />
          Bloquear
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <PauseCircle className="h-5 w-5 text-amber-600" />
            Leads pausados — backlog SLA
          </DialogTitle>
          <DialogDescription className="text-left text-sm">
            <strong>Esquecer</strong> = já cliente / fora do ciclo (sem automação, Zap manual ok).{" "}
            <strong>Liberar</strong> = volta à onda. <strong>Bloquear</strong> = nunca mais contatar.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-3 flex flex-wrap items-center gap-2 border-b bg-muted/30">
          <Badge variant="secondary">{summary.total} pausados</Badge>
          {Object.entries(summary.byGrupo).map(([g, n]) => (
            <Badge key={g} variant="outline" className="text-[10px]">
              {g}: {n}
            </Badge>
          ))}
          <div className="ml-auto flex gap-1">
            {(["all", "A", "B"] as const).map((g) => (
              <Button
                key={g}
                type="button"
                size="sm"
                variant={filter === g ? "default" : "outline"}
                className="h-7 text-[10px]"
                onClick={() => setFilter(g)}
              >
                {g === "all" ? "Todos" : `Grupo ${g}`}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => void reload()}
              disabled={loading || busy}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-3 sm:px-4 pb-2">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </div>
          ) : visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhum lead neste filtro.
            </p>
          ) : (
            <>
              {/* Mobile: cards legíveis */}
              <div className="md:hidden space-y-3 py-2">
                <label className="flex items-center gap-2 px-1 py-1.5 rounded-md border border-border/50 bg-muted/40">
                  <Checkbox
                    checked={visible.length > 0 && selectedIds.length === visible.length}
                    onCheckedChange={(v) => toggleAll(v === true)}
                  />
                  <span className="text-xs font-medium">
                    Selecionar todos ({visible.length})
                  </span>
                </label>
                {visible.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-lg border border-border/70 bg-card/80 p-3 space-y-2"
                  >
                    <div className="flex items-start gap-2">
                      <Checkbox
                        className="mt-1"
                        checked={selected.has(row.id)}
                        onCheckedChange={(v) => toggleOne(row.id, v === true)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm sensitive-name truncate">
                          {row.displayName}
                        </p>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          {row.phoneFormatted}
                        </p>
                        {row.nameSourceLabel && row.displayName !== "Sem nome" && (
                          <p className="text-[10px] text-muted-foreground">{row.nameSourceLabel}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {row.grupoLabel} · {row.stageLabel} · {row.chatLabel}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
                          Se liberar: {row.nextOnRelease}
                        </p>
                        {row.flags.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {row.flags.map((f) => (
                              <Badge key={f} variant="outline" className="text-[9px] px-1 py-0">
                                {f}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <LeadActions row={row} compact />
                  </div>
                ))}
              </div>

              {/* Desktop: tabela */}
              <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={visible.length > 0 && selectedIds.length === visible.length}
                      onCheckedChange={(v) => toggleAll(v === true)}
                    />
                  </TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>Grupo</TableHead>
                  <TableHead>Estágio</TableHead>
                  <TableHead>Chat</TableHead>
                  <TableHead className="min-w-[160px]">Se liberar →</TableHead>
                  <TableHead className="text-right min-w-[280px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={(v) => toggleOne(row.id, v === true)}
                      />
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left w-full group"
                        onClick={() => openConversation(row)}
                        title="Abrir histórico no WhatsApp"
                      >
                        <div className="font-medium text-sm group-hover:text-primary sensitive-name flex items-center gap-1">
                          {row.displayName}
                          <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-70 shrink-0" />
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono">
                          {row.phoneFormatted}
                        </div>
                        {row.nameSourceLabel && row.displayName !== "Sem nome" && (
                          <div className="text-[10px] text-muted-foreground">{row.nameSourceLabel}</div>
                        )}
                      </button>
                      {row.flags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {row.flags.map((f) => (
                            <Badge
                              key={f}
                              variant={f.includes("convertido") ? "default" : "outline"}
                              className="text-[9px] px-1 py-0"
                            >
                              {f}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{row.grupoLabel}</TableCell>
                    <TableCell className="text-xs">{row.stageLabel}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground max-w-[120px]">
                      {row.chatLabel}
                    </TableCell>
                    <TableCell className="text-[10px] leading-snug text-muted-foreground">
                      {row.nextOnRelease}
                    </TableCell>
                    <TableCell className="text-right align-top">
                      <LeadActions row={row} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t flex-col sm:flex-row gap-2 sm:flex-wrap">
          <p className="text-[10px] text-muted-foreground sm:mr-auto sm:text-left text-center w-full sm:w-auto">
            {selectedIds.length} selecionado(s) · Esquecer = já cliente · Liberar = onda · Bloquear = nunca mais
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy || selectedIds.length === 0}
            onClick={() => void dncIds(selectedIds)}
          >
            Bloquear selecionados
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || selectedIds.length === 0}
            onClick={() => void releaseIds(selectedIds)}
          >
            Liberar selecionados
          </Button>
          <Button
            type="button"
            disabled={busy || selectedIds.length === 0}
            onClick={() => void forgetIds(selectedIds)}
            className="gap-1.5"
          >
            <UserMinus className="h-3.5 w-3.5" />
            Esquecer selecionados
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Banner + auto-abertura (1x por sessão) no dashboard. */
export function SlaBacklogLeadsBanner({
  consultantId,
  onOpenChat,
}: {
  consultantId: string;
  onOpenChat?: (phone: string) => void;
}) {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);

  const reloadCount = useCallback(async () => {
    const list = await loadSlaBacklogLeads(consultantId);
    setCount(list.length);
    if (list.length > 0) {
      try {
        if (!sessionStorage.getItem(SESSION_AUTO_KEY)) {
          sessionStorage.setItem(SESSION_AUTO_KEY, "1");
          setOpen(true);
        }
      } catch {
        setOpen(true);
      }
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
        className="mb-3 rounded-lg border-2 border-amber-500/70 bg-amber-500/12 px-3 py-2.5 flex flex-wrap items-center gap-2"
      >
        <PauseCircle className="h-4 w-4 text-amber-700 shrink-0" />
        <div className="min-w-0 flex-1 text-sm">
          <span className="font-semibold text-amber-950 dark:text-amber-50">
            {count} lead(s) pausados no backlog SLA
          </span>
          <span className="block text-[11px] text-amber-900/80 dark:text-amber-100/80">
            Use <strong>Esquecer</strong> para já-cliente/família, <strong>Liberar</strong> para voltar à onda, ou{" "}
            <strong>Bloquear</strong> se nunca mais contatar.
          </span>
        </div>
        <Button type="button" size="sm" className="h-8 text-xs" onClick={() => setOpen(true)}>
          Revisar agora
        </Button>
      </div>
      <SlaBacklogLeadsDialog
        consultantId={consultantId}
        open={open}
        onOpenChange={setOpen}
        onOpenChat={onOpenChat}
        onChanged={() => void reloadCount()}
      />
    </>
  );
}
