import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Search, UserPlus, Users, Check, Loader2 } from "lucide-react";

interface AddLeadDialogProps {
  consultantId: string;
  stages: { stage_key: string; label: string; color: string }[];
  onLeadAdded: () => void;
}

interface CustomerRow {
  id: string;
  name: string | null;
  phone_whatsapp: string;
  tipo_produto: string;
}

function formatRemoteJid(phone: string): string {
  const cleaned = phone.replace(/[\s\-\(\)\+]/g, "");
  const digits = cleaned.startsWith("55") ? cleaned : `55${cleaned}`;
  return `${digits}@s.whatsapp.net`;
}

export function AddLeadDialog({ consultantId, stages, onLeadAdded }: AddLeadDialogProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"existing" | "new">("existing");
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState("novo_lead");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // New contact fields
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");

  const { toast } = useToast();

  const fetchCustomers = useCallback(async () => {
    const { data } = await supabase
      .from("customers")
      .select("id, name, phone_whatsapp, tipo_produto")
      .eq("consultant_id", consultantId)
      .neq("tipo_produto", "telefonia")
      .order("name", { ascending: true })
      .limit(500);
    if (data) setCustomers(data as CustomerRow[]);
  }, [consultantId]);

  useEffect(() => {
    if (open) {
      fetchCustomers();
      setSelectedIds(new Set());
      setSearch("");
      setNotes("");
      setNewPhone("");
      setNewName("");
      setStage("novo_lead");
      setTab("existing");
    }
  }, [open, fetchCustomers]);

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase();
    return (
      (c.name || "").toLowerCase().includes(q) ||
      c.phone_whatsapp.includes(q)
    );
  });

  const toggleCustomer = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (tab === "existing") {
        if (selectedIds.size === 0) {
          toast({ title: "Selecione ao menos um cliente", variant: "destructive" });
          setSaving(false);
          return;
        }
        const selected = customers.filter((c) => selectedIds.has(c.id));
        const inserts = selected.map((c) => ({
          consultant_id: consultantId,
          customer_id: c.id,
          remote_jid: formatRemoteJid(c.phone_whatsapp),
          stage,
          notes: notes.trim() || null,
        }));
        const { error } = await supabase.from("crm_deals").insert(inserts);
        if (error) throw error;
        toast({ title: `${inserts.length} lead(s) adicionado(s)!` });
      } else {
        if (!newPhone.trim()) {
          toast({ title: "Informe o número de WhatsApp", variant: "destructive" });
          setSaving(false);
          return;
        }
        const { error } = await supabase.from("crm_deals").insert({
          consultant_id: consultantId,
          remote_jid: formatRemoteJid(newPhone),
          stage,
          notes: (newName.trim() ? `${newName.trim()} — ` : "") + (notes.trim() || ""),
        });
        if (error) throw error;
        toast({ title: "Cliente interessado adicionado!" });
      }
      onLeadAdded();
      setOpen(false);
    } catch (err: unknown) {
      toast({ title: "Erro ao adicionar cliente interessado", description: err instanceof Error ? err.message : "Falha", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Adicionar Cliente interessado
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Adicionar cliente interessado ao funil</DialogTitle>
        </DialogHeader>

        {/* Tab selector */}
        <div className="flex gap-1.5">
          <Button
            variant={tab === "existing" ? "default" : "outline"}
            size="sm"
            className="h-7 text-[10px] gap-1 flex-1"
            onClick={() => setTab("existing")}
          >
            <Users className="h-3 w-3" />
            Clientes Existentes
          </Button>
          <Button
            variant={tab === "new" ? "default" : "outline"}
            size="sm"
            className="h-7 text-[10px] gap-1 flex-1"
            onClick={() => setTab("new")}
          >
            <UserPlus className="h-3 w-3" />
            Novo Contato
          </Button>
        </div>

        {tab === "existing" ? (
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou telefone..."
                className="h-8 text-xs pl-8"
              />
            </div>
            <ScrollArea className="max-h-[220px] border rounded-md">
              <div className="p-1 space-y-0.5">
                {filtered.length === 0 && (
                  <p className="text-[10px] text-muted-foreground text-center py-4">Nenhum cliente encontrado</p>
                )}
                {filtered.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 p-1.5 rounded hover:bg-secondary/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedIds.has(c.id)}
                      onCheckedChange={() => toggleCustomer(c.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{c.name || "Sem nome"}</p>
                      <p className="text-[10px] text-muted-foreground">{c.phone_whatsapp}</p>
                    </div>
                  </label>
                ))}
              </div>
            </ScrollArea>
            {selectedIds.size > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {selectedIds.size} selecionado(s)
              </Badge>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-muted-foreground font-medium">Número WhatsApp *</label>
              <Input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="11999998888"
                className="h-8 text-xs mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-medium">Nome (opcional)</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="João Silva"
                className="h-8 text-xs mt-1"
              />
            </div>
          </div>
        )}

        {/* Stage selector */}
        <div>
          <label className="text-[10px] text-muted-foreground font-medium">Estágio inicial</label>
          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger className="w-full h-8 text-xs mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stages.map((s) => (
                <SelectItem key={s.stage_key} value={s.stage_key}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Notes */}
        <div>
          <label className="text-[10px] text-muted-foreground font-medium">Notas (opcional)</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observações sobre o cliente interessado..."
            className="min-h-[60px] text-xs mt-1 resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {saving ? "Salvando..." : "Adicionar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
