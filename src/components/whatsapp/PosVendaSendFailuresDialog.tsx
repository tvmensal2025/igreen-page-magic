import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle, Ban, Loader2, Phone, PhoneOff, Pencil, Trash2, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  formatPhoneBR, initialsFrom, avatarTone, isPlaceholderPhone, POS_VENDA_STAGES,
} from "@/lib/posVenda/format";
import { isValidBrNationalPhone, toWhatsappCanonical } from "@/lib/captacao/portalPhone";

type FailureRow = {
  log_id: string;
  customer_id: string;
  stage_key: string;
  status: string;
  message_preview: string | null;
  created_at: string;
  name: string | null;
  phone_whatsapp: string;
  whatsapp_chat_id: string | null;
  pos_venda_stage: string | null;
  andamento_igreen: string | null;
};

interface Props {
  consultantId: string;
  onResolved?: () => void;
  /** Incrementa para forçar abrir (botão do header). */
  openSignal?: number;
  onCountChange?: (count: number) => void;
}

function isFailureStatus(status: string): boolean {
  const st = String(status || "");
  if (!st || st === "sent" || st.startsWith("sent")) return false;
  if (st === "dismissed" || st === "skipped_prior" || st === "claimed") return false;
  return (
    st === "failed" ||
    st.startsWith("partial:") ||
    st.startsWith("no_channel:") ||
    st === "no_content" ||
    st === "claimed_retry"
  );
}

function stageLabel(stageKey: string): string {
  const bare = stageKey.replace(/^pv_/, "") as typeof POS_VENDA_STAGES[number]["key"];
  return POS_VENDA_STAGES.find((s) => s.key === bare)?.label ?? stageKey.replace(/^pv_/, "").toUpperCase();
}

function failureReason(status: string, preview: string | null, phone: string): string {
  if (isPlaceholderPhone(phone) || /sem_celular/i.test(phone)) return "Sem celular válido";
  if (/_\d+$/.test(phone) && phone.includes("_")) return "Telefone com sufixo inválido";
  if (status.startsWith("partial:audio")) return "Imagem ok, áudio falhou";
  if (status.startsWith("partial:")) return "Envio parcial";
  if (status.startsWith("no_channel:")) return `Canal indisponível (${status.replace("no_channel:", "")})`;
  if (status === "no_content") return "Sem conteúdo configurado";
  if (status === "claimed_retry") return "Retry interrompido";
  if (/audio:fail/i.test(preview || "")) return "Falha no áudio";
  if (/img:fail/i.test(preview || "")) return "Falha na imagem";
  return "Falha no envio";
}

export default function PosVendaSendFailuresDialog({
  consultantId,
  onResolved,
  openSignal,
  onCountChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<FailureRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [confirmDrop, setConfirmDrop] = useState<FailureRow | null>(null);
  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;
  /** Evita reabrir o modal a cada realtime se o consultor já fechou. */
  const autoOpenedRef = useRef(false);

  const load = useCallback(async (opts?: { forceOpen?: boolean }) => {
    if (!consultantId) return;
    setLoading(true);
    const { data: logs, error } = await supabase
      .from("customer_auto_message_log")
      .select("id, customer_id, stage_key, status, message_preview, created_at")
      .eq("consultant_id", consultantId)
      .like("stage_key", "pv_%")
      .order("created_at", { ascending: false })
      .limit(400);

    if (error) {
      console.error(error);
      setLoading(false);
      toast.error("Não foi possível carregar falhas do pós-venda");
      return;
    }

    const failLogs = (logs || []).filter((l) => isFailureStatus(String(l.status)));
    if (failLogs.length === 0) {
      setItems([]);
      onCountChangeRef.current?.(0);
      setLoading(false);
      return;
    }

    const customerIds = [...new Set(failLogs.map((l) => l.customer_id))];
    const { data: customers, error: cErr } = await supabase
      .from("customers")
      .select("id, name, phone_whatsapp, whatsapp_chat_id, pos_venda_stage, andamento_igreen, pos_venda_invalid")
      .in("id", customerIds)
      .eq("pos_venda_invalid", false);

    if (cErr) {
      console.error(cErr);
      setLoading(false);
      toast.error("Não foi possível carregar clientes das falhas");
      return;
    }

    const byId = new Map((customers || []).map((c) => [c.id, c]));
    const rows: FailureRow[] = [];
    for (const l of failLogs) {
      const c = byId.get(l.customer_id);
      if (!c) continue;
      rows.push({
        log_id: l.id,
        customer_id: l.customer_id,
        stage_key: l.stage_key,
        status: String(l.status),
        message_preview: l.message_preview,
        created_at: l.created_at,
        name: c.name,
        phone_whatsapp: c.phone_whatsapp,
        whatsapp_chat_id: c.whatsapp_chat_id ?? null,
        pos_venda_stage: c.pos_venda_stage,
        andamento_igreen: c.andamento_igreen,
      });
    }

    setItems(rows);
    onCountChangeRef.current?.(rows.length);
    if (rows.length > 0 && (opts?.forceOpen || !autoOpenedRef.current)) {
      autoOpenedRef.current = true;
      setOpen(true);
    }
    setLoading(false);
  }, [consultantId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (openSignal) {
      setOpen(true);
      void load({ forceOpen: true });
    }
  }, [openSignal, load]);

  useEffect(() => {
    const ch = supabase
      .channel(`pv-send-failures-${consultantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "customer_auto_message_log",
          filter: `consultant_id=eq.${consultantId}`,
        },
        () => { void load(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [consultantId, load]);

  async function markLogDismissed(logId: string) {
    const { error } = await supabase
      .from("customer_auto_message_log")
      .update({ status: "dismissed", message_preview: "dismissed_by_consultant" })
      .eq("id", logId);
    return error;
  }

  async function forget(row: FailureRow) {
    setBusyId(row.log_id);
    const { error: cErr } = await supabase
      .from("customers")
      .update({ pos_venda_manual: false } as never)
      .eq("id", row.customer_id);
    if (cErr) {
      setBusyId(null);
      toast.error("Erro ao esquecer: " + cErr.message);
      return;
    }
    const lErr = await markLogDismissed(row.log_id);
    setBusyId(null);
    if (lErr) {
      toast.error("Cliente parado, mas o log não atualizou: " + lErr.message);
    } else {
      toast.success("Esquecido — não envia mais pós-venda para este cliente");
    }
    await load();
    onResolved?.();
  }

  async function dropFromPosVenda(row: FailureRow) {
    setBusyId(row.log_id);
    const { error: cErr } = await supabase
      .from("customers")
      .update({
        pos_venda_invalid: true,
        pos_venda_manual: false,
        pos_venda_pending_stage: null,
      } as never)
      .eq("id", row.customer_id);
    if (cErr) {
      setBusyId(null);
      toast.error("Erro ao excluir do pós-venda: " + cErr.message);
      return;
    }
    await markLogDismissed(row.log_id);
    setBusyId(null);
    setConfirmDrop(null);
    toast.success("Removido do pós-venda (cadastro iGreen permanece)");
    await load();
    onResolved?.();
  }

  async function freePhoneIfTaken(canonical: string, keepCustomerId: string): Promise<string | null> {
    const { data: clash } = await supabase
      .from("customers")
      .select("id, name, phone_whatsapp, status, pos_venda_stage")
      .eq("consultant_id", consultantId)
      .eq("phone_whatsapp", canonical)
      .neq("id", keepCustomerId)
      .maybeSingle();

    if (!clash) return null;

    const placeholder = `${canonical}_dup_${String(clash.id).slice(0, 8)}`;
    const { error } = await supabase
      .from("customers")
      .update({ phone_whatsapp: placeholder, whatsapp_chat_id: null } as never)
      .eq("id", clash.id);
    if (error) return error.message;
    return null;
  }

  async function savePhoneAndRetry(row: FailureRow) {
    const canonical = toWhatsappCanonical(phoneDraft);
    if (!isValidBrNationalPhone(canonical)) {
      toast.error("Informe um celular BR válido (DDD + número)");
      return;
    }

    setBusyId(row.log_id);
    const freeErr = await freePhoneIfTaken(canonical, row.customer_id);
    if (freeErr) {
      setBusyId(null);
      toast.error("Número já usado e não deu para liberar: " + freeErr);
      return;
    }

    const { error } = await supabase
      .from("customers")
      .update({
        phone_whatsapp: canonical,
        whatsapp_chat_id: canonical,
      } as never)
      .eq("id", row.customer_id);

    if (error) {
      setBusyId(null);
      toast.error("Erro ao salvar número: " + error.message);
      return;
    }

    // Garante status retentável para o cron / invoke.
    await supabase
      .from("customer_auto_message_log")
      .update({
        status: "failed",
        message_preview: (row.message_preview || "").replace(/dismissed_by_consultant/g, "") ||
          "[pending_retry_after_phone_fix]",
        remote_jid: `${canonical}@s.whatsapp.net`,
      })
      .eq("id", row.log_id);

    const { data: invokeData, error: invErr } = await supabase.functions.invoke(
      "pos-venda-auto-progress",
      { body: { customer_ids: [row.customer_id] } },
    );

    setBusyId(null);
    setEditingId(null);
    setPhoneDraft("");

    if (invErr || (invokeData as { error?: string } | null)?.error) {
      toast.success("Número salvo. O envio sai na próxima rodada automática (até 1h).");
    } else {
      const sent = Number((invokeData as { sent?: number } | null)?.sent || 0);
      toast.success(sent > 0 ? "Número salvo e mensagem reenviada" : "Número salvo — aguardando nova tentativa");
    }

    await load();
    onResolved?.();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg sm:max-w-xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/60">
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
              Falhas no pós-venda
              {items.length > 0 && (
                <Badge variant="destructive" className="ml-1">{items.length}</Badge>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Clientes cujo envio automático falhou. Esqueça (não manda mais), corrija o número ou tire do pós-venda.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[min(70vh,520px)]">
            <div className="p-4 space-y-3">
              {loading && items.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
                </div>
              ) : items.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Nenhuma falha pendente.
                </div>
              ) : (
                items.map((row) => {
                  const busy = busyId === row.log_id;
                  const editing = editingId === row.log_id;
                  const noPhone = isPlaceholderPhone(row.phone_whatsapp);
                  return (
                    <div
                      key={row.log_id}
                      className="rounded-xl border border-border/60 bg-card/60 p-3 space-y-2.5"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div
                          className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${avatarTone(row.name || row.customer_id)}`}
                        >
                          {initialsFrom(row.name)}
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-sm font-semibold truncate">{row.name || "Sem nome"}</p>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Badge variant="outline" className="text-[10px] font-medium">
                              {stageLabel(row.stage_key)}
                            </Badge>
                            <span className="inline-flex items-center gap-1">
                              {noPhone ? <PhoneOff className="w-3 h-3" /> : <Phone className="w-3 h-3" />}
                              {noPhone ? "Sem celular" : formatPhoneBR(row.phone_whatsapp)}
                            </span>
                          </div>
                          <p className="text-[11px] text-destructive/90 flex items-center gap-1">
                            <XCircle className="w-3 h-3 shrink-0" />
                            {failureReason(row.status, row.message_preview, row.phone_whatsapp)}
                          </p>
                          {row.andamento_igreen && (
                            <p className="text-[10px] text-muted-foreground truncate">
                              iGreen: {row.andamento_igreen}
                            </p>
                          )}
                        </div>
                      </div>

                      {editing ? (
                        <div className="flex flex-col sm:flex-row gap-2">
                          <Input
                            value={phoneDraft}
                            onChange={(e) => setPhoneDraft(e.target.value.replace(/\D/g, ""))}
                            placeholder="5511999999999"
                            className="h-9 rounded-lg text-sm"
                            disabled={busy}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="rounded-lg flex-1"
                              disabled={busy}
                              onClick={() => void savePhoneAndRetry(row)}
                            >
                              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Salvar e reenviar"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="rounded-lg"
                              disabled={busy}
                              onClick={() => { setEditingId(null); setPhoneDraft(""); }}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-lg gap-1.5 h-8 text-xs"
                            disabled={busy}
                            onClick={() => void forget(row)}
                          >
                            <Ban className="w-3.5 h-3.5" />
                            Esquecer
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-lg gap-1.5 h-8 text-xs"
                            disabled={busy}
                            onClick={() => {
                              setEditingId(row.log_id);
                              const digits = (row.whatsapp_chat_id || row.phone_whatsapp || "")
                                .replace(/\D/g, "");
                              setPhoneDraft(
                                digits.length >= 10 && !/_/.test(row.phone_whatsapp)
                                  ? digits
                                  : "",
                              );
                            }}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Editar número
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="rounded-lg gap-1.5 h-8 text-xs"
                            disabled={busy}
                            onClick={() => setConfirmDrop(row)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Excluir do pós-venda
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDrop} onOpenChange={(o) => { if (!o) setConfirmDrop(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tirar do pós-venda?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDrop?.name || "Este cliente"} deixa de receber mensagens automáticas de pós-venda
              e some desta fila. O cadastro na carteira iGreen não é apagado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => { if (confirmDrop) void dropFromPosVenda(confirmDrop); }}
            >
              Excluir do pós-venda
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
