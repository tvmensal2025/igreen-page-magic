/**
 * Lista Não Perturbe (DNC) — números bloqueados para ligação/SMS Velip.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plus, ShieldBan, Trash2 } from "lucide-react";
import { VozCampaignShell, VozSection } from "./VozCampaignShell";

interface DncRow {
  id: string;
  phone: string;
  reason: string | null;
  source: string | null;
  created_at: string;
}

interface Props {
  consultantId: string;
}

function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

function formatPhone(raw: string): string {
  const d = digitsOnly(raw);
  if (d.length < 10) return raw || "—";
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length < 10) return raw;
  const ddd = local.slice(0, 2);
  const rest = local.slice(2);
  if (rest.length === 9) return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
  if (rest.length === 8) return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return raw;
}

export function VoiceDncPanel({ consultantId }: Props) {
  const [rows, setRows] = useState<DncRow[]>([]);
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("voice_dnc_list")
      .select("id, phone, reason, source, created_at")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) toast.error(error.message);
    setRows((data as DncRow[]) ?? []);
    setLoading(false);
  }, [consultantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const dest = digitsOnly(phone);
    if (dest.length < 10) return toast.error("Telefone inválido");
    setBusy(true);
    try {
      const { error } = await supabase.from("voice_dnc_list").upsert(
        {
          consultant_id: consultantId,
          phone: dest,
          reason: reason.trim() || "manual",
          source: "admin_ui",
        },
        { onConflict: "consultant_id,phone" },
      );
      if (error) throw new Error(error.message);
      toast.success("Número adicionado à lista Não Perturbe");
      setPhone("");
      setReason("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este número da lista Não Perturbe?")) return;
    const { error } = await supabase.from("voice_dnc_list").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removido");
    await load();
  };

  return (
    <VozCampaignShell
      title="Não Perturbe (DNC)"
      subtitle="Números aqui não recebem ligação nem SMS via Velip. Bloqueios da operadora entram automaticamente."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm" style={{ color: "var(--pe-text-muted)" }}>
            {rows.length} número(s) bloqueado(s)
          </span>
          <Button
            onClick={() => void add()}
            disabled={busy || digitsOnly(phone).length < 10}
            style={{ background: "var(--pe-emerald)", color: "#fff" }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Adicionar
          </Button>
        </div>
      }
    >
      <VozSection title="Adicionar número">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Telefone</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="55DDNNNNNNNNN"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Motivo (opcional)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Cliente pediu para não ligar"
            />
          </div>
        </div>
      </VozSection>

      <VozSection title="Lista">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum número na lista ainda.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2 rounded-[var(--pe-radius)] border px-3 py-2 text-sm"
                style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface)" }}
              >
                <ShieldBan className="h-4 w-4 shrink-0" style={{ color: "var(--pe-emerald)" }} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate" style={{ color: "var(--pe-text)" }}>
                    {formatPhone(r.phone)}
                  </p>
                  <p className="text-[11px] truncate" style={{ color: "var(--pe-text-muted)" }}>
                    {r.reason || "—"} · {r.source || "manual"}
                  </p>
                </div>
                <Badge variant="secondary">{r.source === "velip_callback" ? "auto" : "manual"}</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-destructive"
                  onClick={() => void remove(r.id)}
                >
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
