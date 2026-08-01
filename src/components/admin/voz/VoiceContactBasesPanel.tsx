import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Users } from "lucide-react";
import { VozCampaignShell, VozSection } from "./VozCampaignShell";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface Base { id: string; name: string; total: number; created_at: string; }

interface Props { consultantId: string; }

export function VoiceContactBasesPanel({ consultantId }: Props) {
  const confirm = useConfirm();
  const [bases, setBases] = useState<Base[]>([]);
  const [name, setName] = useState("");
  const [phones, setPhones] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("voice_contact_bases")
      .select("id,name,total,created_at")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false });
    setBases((data as Base[]) || []);
    setLoading(false);
  };
  useEffect(() => { void load(); }, [consultantId]);

  const create = async () => {
    if (!name.trim()) return toast.error("Dê um nome pra base");
    const list = phones.split(/[\n,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) return toast.error("Adicione ao menos 1 telefone");
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("voice-contact-base", {
        body: { action: "create", name: name.trim(), phones: list, consultant_id: consultantId },
      });
      if (error) throw new Error(error.message);
      toast.success(`Base "${name}" criada com ${list.length} contatos`);
      setName(""); setPhones(""); await load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    const ok = await confirm({
      title: "Excluir base de contatos?",
      description: "A lista salva será removida. Campanhas já criadas não são afetadas.",
      confirmText: "Excluir base",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;
    await (supabase as any).from("voice_contact_bases").delete().eq("id", id);
    await load();
  };

  return (
    <VozCampaignShell
      title="Bases de contatos"
      subtitle="Salve listas reutilizáveis para não recomeçar do zero em cada campanha."
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button onClick={() => void create()} disabled={busy} style={{ background: "var(--pe-emerald)", color: "#fff" }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Salvar base
          </Button>
        </div>
      }
    >
      <VozSection title="Nova base">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Clientes ativos MG" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Telefones</Label>
          <Textarea value={phones} onChange={(e) => setPhones(e.target.value)} rows={5} placeholder="55DDNNNNNNNNN" />
        </div>
      </VozSection>

      <VozSection title="Bases salvas">
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : bases.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma base ainda.</p>
        ) : (
          <ul className="space-y-2">
            {bases.map((b) => (
              <li key={b.id} className="flex items-center gap-2 rounded-[var(--pe-radius)] border px-3 py-2 text-sm" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface)" }}>
                <Users className="h-4 w-4" style={{ color: "var(--pe-emerald)" }} />
                <span className="flex-1 font-medium truncate" style={{ color: "var(--pe-text)" }}>{b.name}</span>
                <Badge variant="secondary">{b.total} contatos</Badge>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => void remove(b.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </VozSection>
    </VozCampaignShell>
  );
}
