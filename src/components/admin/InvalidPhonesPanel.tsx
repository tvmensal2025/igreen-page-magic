import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { PhoneOff, RefreshCw, Pencil, ShieldOff, Loader2 } from "lucide-react";

interface DncRow {
  consultant_id: string;
  phone: string;
  reason: string | null;
  source: string | null;
  created_at: string;
}

interface CustomerLite {
  id: string;
  name: string | null;
  phone_whatsapp: string | null;
  phone_landline: string | null;
  do_not_contact: boolean | null;
}

interface Row {
  dnc: DncRow;
  customer: CustomerLite | null;
}

const REASON_LABELS: Record<string, string> = {
  auto_velip_ik: "Número inexistente (IK)",
  auto_velip_ek: "Número inválido (EK)",
  auto_velip_ck: "Bloqueio operadora (CK)",
  auto_velip_bk: "Não perturbe (BK)",
  auto_nonexistent: "Número inexistente",
  auto_invalid_number: "Número inválido",
  auto_do_not_disturb: "Não perturbe",
};

function labelReason(r: string | null): string {
  if (!r) return "—";
  return REASON_LABELS[r.toLowerCase()] || r;
}

function looksAutoInvalid(reason: string | null): boolean {
  const r = String(reason || "").toLowerCase();
  return r.startsWith("auto_velip_") ||
    r === "auto_nonexistent" || r === "auto_invalid_number" || r === "auto_do_not_disturb";
}

export function InvalidPhonesPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [newPhone, setNewPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: dnc, error } = await supabase
        .from("voice_dnc_list")
        .select("consultant_id, phone, reason, source, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const filtered = (dnc || []).filter((d) => looksAutoInvalid(d.reason));
      const phones = filtered.map((d) => d.phone);
      let custMap = new Map<string, CustomerLite>();
      if (phones.length > 0) {
        const { data: custs } = await supabase
          .from("customers")
          .select("id, name, phone_whatsapp, phone_landline, do_not_contact")
          .in("phone_whatsapp", phones);
        (custs || []).forEach((c: CustomerLite) => {
          if (c.phone_whatsapp) custMap.set(c.phone_whatsapp, c);
        });
      }
      setRows(filtered.map((d) => ({ dnc: d as DncRow, customer: custMap.get(d.phone) ?? null })));
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const openEdit = (row: Row) => {
    setEditing(row);
    setNewPhone(row.customer?.phone_whatsapp || row.dnc.phone);
  };

  const savePhone = async () => {
    if (!editing?.customer?.id) return;
    const clean = newPhone.replace(/\D/g, "");
    if (clean.length < 10) {
      toast({ title: "Telefone inválido", description: "Informe DDD + número.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("customers")
        .update({ phone_whatsapp: clean })
        .eq("id", editing.customer.id);
      if (error) throw error;
      // Remove o número antigo do DNC para o motor voltar a tentar.
      await supabase.from("voice_dnc_list")
        .delete()
        .eq("consultant_id", editing.dnc.consultant_id)
        .eq("phone", editing.dnc.phone);
      toast({ title: "Telefone corrigido", description: `Novo: ${clean}` });
      setEditing(null);
      void load();
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const markDnc = async (row: Row) => {
    if (!row.customer?.id) {
      toast({ title: "Sem cadastro", description: "Este número não está vinculado a um lead." });
      return;
    }
    try {
      const { error } = await supabase
        .from("customers")
        .update({ do_not_contact: true })
        .eq("id", row.customer.id);
      if (error) throw error;
      toast({ title: "Lead marcado como Não Perturbe" });
      void load();
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <PhoneOff className="w-5 h-5 text-destructive" />
          <div>
            <h3 className="text-base font-semibold">Números inválidos</h3>
            <p className="text-xs text-muted-foreground">
              Reprovados pela operadora (IK/EK/CK/BK). O motor não tenta novas ligações nem SMS aqui.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center border rounded-lg bg-muted/20">
          Nenhum número inválido detectado. 
        </div>
      ) : (
        <div className="border rounded-lg divide-y bg-card">
          {rows.map((r) => (
            <div key={`${r.dnc.consultant_id}-${r.dnc.phone}`} className="p-3 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold">{r.dnc.phone}</span>
                  <Badge variant="destructive" className="text-[10px]">{labelReason(r.dnc.reason)}</Badge>
                  {r.customer?.do_not_contact ? (
                    <Badge variant="outline" className="text-[10px]">Não Perturbe</Badge>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {r.customer ? (
                    <>Lead: <span className="font-medium text-foreground">{r.customer.name || "sem nome"}</span></>
                  ) : (
                    <span>Sem cadastro vinculado</span>
                  )}
                  {" · "}
                  Detectado {new Date(r.dnc.created_at).toLocaleDateString("pt-BR")}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(r)} disabled={!r.customer}>
                  <Pencil className="w-3.5 h-3.5 mr-1" /> Corrigir telefone
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void markDnc(r)} disabled={!r.customer || !!r.customer?.do_not_contact}>
                  <ShieldOff className="w-3.5 h-3.5 mr-1" /> Não perturbe
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Corrigir telefone do lead</DialogTitle>
            <DialogDescription>
              O número antigo será removido da lista Não Perturbe automaticamente para que o motor volte a tentar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Lead: <span className="font-medium text-foreground">{editing?.customer?.name || "—"}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Número antigo: <span className="font-mono">{editing?.dnc.phone}</span>
            </div>
            <Input
              placeholder="Ex.: 5511987654321"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={() => void savePhone()} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Salvando…</> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
