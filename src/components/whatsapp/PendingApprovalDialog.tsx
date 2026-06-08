import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, AlertTriangle, Clock, Phone } from "lucide-react";
import { toast } from "sonner";

interface Pending {
  id: string;
  name: string | null;
  phone_whatsapp: string;
  electricity_bill_value: number | null;
  andamento_igreen: string | null;
  pos_venda_pending_stage: string;
  consultant_id: string;
  assigned_consultant_id: string | null;
}

interface Props {
  consultantId: string;
  onResolved?: () => void;
}

export default function PendingApprovalDialog({ consultantId, onResolved }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("customers")
      .select("id,name,phone_whatsapp,electricity_bill_value,andamento_igreen,pos_venda_pending_stage,consultant_id,assigned_consultant_id,pending_snoozed_until")
      .eq("customer_origin", "igreen_sync")
      .not("pos_venda_pending_stage", "is", null)
      .or(`consultant_id.eq.${consultantId},assigned_consultant_id.eq.${consultantId}`)
      .or(`pending_snoozed_until.is.null,pending_snoozed_until.lt.${nowIso}`);
    setLoading(false);
    if (error) { console.error(error); return; }
    const list = (data || []) as Pending[];
    setItems(list);
    if (list.length > 0) setOpen(true);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [consultantId]);

  // Realtime: novos clientes com pending
  useEffect(() => {
    const ch = supabase
      .channel(`pending-${consultantId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "customers",
        filter: `consultant_id=eq.${consultantId}`,
      }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [consultantId]);

  const grouped = useMemo(() => {
    const g: Record<string, Pending[]> = { aprovado: [], reprovado: [], devolutiva: [] };
    for (const it of items) {
      const k = it.pos_venda_pending_stage || "aprovado";
      (g[k] ||= []).push(it);
    }
    return g;
  }, [items]);

  async function act(customerId: string, action: "approve" | "review" | "snooze") {
    const { data, error } = await supabase.rpc("confirm_pending_classification" as any, { _customer_id: customerId, _action: action });
    if (error) { toast.error(error.message); return; }
    const ok = (data as any)?.ok;
    if (!ok) { toast.error((data as any)?.error || "Erro"); return; }
    setItems((prev) => prev.filter((p) => p.id !== customerId));
    toast.success(action === "approve" ? "Confirmado! Mensagem disparada." : action === "snooze" ? "Adiado 24h" : "Mantido em Espera");
    onResolved?.();
  }

  async function actBulk(stageKey: string) {
    const ids = (grouped[stageKey] || []).map((p) => p.id);
    for (const id of ids) {
      await supabase.rpc("confirm_pending_classification" as any, { _customer_id: id, _action: "approve" });
    }
    setItems((prev) => prev.filter((p) => !ids.includes(p.id)));
    toast.success(`${ids.length} confirmados`);
    onResolved?.();
  }

  if (loading || items.length === 0) return null;

  const sections: { key: string; label: string; icon: any; color: string }[] = [
    { key: "aprovado", label: "Aprovados", icon: CheckCircle2, color: "text-emerald-500" },
    { key: "reprovado", label: "Reprovados", icon: XCircle, color: "text-red-500" },
    { key: "devolutiva", label: "Devolutiva", icon: AlertTriangle, color: "text-amber-500" },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novos clientes aguardando sua confirmação</DialogTitle>
          <DialogDescription>
            Estes clientes foram sincronizados do iGreen e estão em <b>Em Espera</b>. Confirme para entrar na autoprogressão (30 / 60 / 90 / 120 dias) ou no fluxo de devolutiva.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-4">
            {sections.map((sec) => {
              const list = grouped[sec.key] || [];
              if (!list.length) return null;
              const Icon = sec.icon;
              return (
                <div key={sec.key} className="border rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className={`flex items-center gap-2 font-semibold ${sec.color}`}>
                      <Icon className="w-4 h-4" />
                      {list.length} {sec.label}
                    </div>
                    {sec.key === "aprovado" && (
                      <Button size="sm" variant="default" onClick={() => actBulk(sec.key)}>
                        Confirmar todos ({list.length})
                      </Button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {list.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 bg-muted/30 rounded-lg p-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{c.name || "Sem nome"}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Phone className="w-3 h-3" />{c.phone_whatsapp}
                            {c.electricity_bill_value != null && <span className="ml-2">R$ {Number(c.electricity_bill_value).toFixed(2)}</span>}
                          </p>
                          {c.andamento_igreen && (
                            <Badge variant="outline" className="text-[10px] mt-1">{c.andamento_igreen}</Badge>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button size="sm" variant="default" onClick={() => act(c.id, "approve")}>Confirmar</Button>
                          <Button size="sm" variant="outline" onClick={() => act(c.id, "review")}>Rever</Button>
                          <Button size="icon" variant="ghost" title="Adiar 24h" onClick={() => act(c.id, "snooze")}>
                            <Clock className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
