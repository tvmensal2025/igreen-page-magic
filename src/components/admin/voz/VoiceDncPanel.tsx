/**
 * Lista Não Perturbe — números bloqueados para ligação/SMS Velip.
 * Mostra nome (CRM), motivo, origem (manual vs automático) e busca.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import { Loader2, Plus, Search, ShieldBan, Trash2, MessageSquare } from "lucide-react";
import { VozCampaignShell, VozSection } from "./VozCampaignShell";
import type { VozCustomer } from "./VozContactPickerDialog";
import { resolveNameByPhone } from "./voiceContactResolve";
import { dncSourceLabel } from "./voiceOutcomeLabels";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  crmClosingSummary,
  resolveCrmByPhoneOrId,
  statusCrmLabel,
} from "./voiceCrmContext";

interface DncRow {
  id: string;
  phone: string;
  reason: string | null;
  source: string | null;
  created_at: string;
}

interface Props {
  consultantId: string;
  customers?: VozCustomer[];
  onOpenChat?: (phone: string) => void;
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

function reasonLabel(reason: string | null | undefined): string {
  const r = String(reason || "").trim();
  if (!r) return "—";
  const lower = r.toLowerCase();
  if (lower.includes("bk") || lower.includes("do_not_disturb") || lower.includes("não perturbe")) {
    return "Não perturbe (retorno iGreen Fone)";
  }
  if (lower.includes("ik") || lower.includes("nonexistent") || lower.includes("inexistente")) {
    return "Número inexistente";
  }
  if (lower.includes("invalid") || lower.includes("inválido") || lower.includes("ek")) {
    return "Número inválido";
  }
  if (lower === "manual") return "Bloqueio manual";
  return r;
}

export function VoiceDncPanel({ consultantId, customers = [], onOpenChat }: Props) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<DncRow[]>([]);
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
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

  const enriched = useMemo(() => {
    return rows.map((r) => {
      const crm = resolveCrmByPhoneOrId(r.phone, null, customers);
      const name = crm?.name?.trim() || resolveNameByPhone(r.phone, customers);
      return { ...r, displayName: name, crm };
    });
  }, [rows, customers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return enriched;
    const digits = q.replace(/\D/g, "");
    return enriched.filter((r) => {
      const name = (r.displayName || "").toLowerCase();
      const phone = r.phone.replace(/\D/g, "");
      const reason = (r.reason || "").toLowerCase();
      return (
        name.includes(q) ||
        reason.includes(q) ||
        (digits.length >= 3 && phone.includes(digits)) ||
        formatPhone(r.phone).toLowerCase().includes(q)
      );
    });
  }, [enriched, search]);

  const autoCount = enriched.filter((r) => r.source === "velip_callback").length;
  const manualCount = enriched.length - autoCount;

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
    const ok = await confirm({
      title: "Remover este número da lista Não Perturbe?",
      description: "O número volta a poder receber ligação e SMS.",
      confirmText: "Remover",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("voice_dnc_list").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removido");
    await load();
  };

  return (
    <VozCampaignShell
      title="Não Perturbe"
      subtitle="Bloqueados do CRM: nome, etapa/status, motivo e origem. Não recebem ligação nem SMS."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm" style={{ color: "var(--pe-text-muted)" }}>
            {enriched.length} bloqueado(s) · {manualCount} manual · {autoCount} automático
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

      <VozSection title="Lista de bloqueados">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            placeholder="Buscar por nome, telefone ou motivo…"
          />
        </div>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {rows.length === 0 ? "Nenhum número na lista ainda." : "Nenhum resultado para a busca."}
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2 rounded-[var(--pe-radius)] border px-3 py-2 text-sm"
                style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface)" }}
              >
                <ShieldBan className="h-4 w-4 shrink-0" style={{ color: "var(--pe-emerald)" }} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate" style={{ color: "var(--pe-text)" }}>
                    {r.displayName || formatPhone(r.phone)}
                    {r.crm?.status ? (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        {statusCrmLabel(r.crm.status)}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-[11px] truncate" style={{ color: "var(--pe-text-muted)" }}>
                    {r.displayName ? `${formatPhone(r.phone)} · ` : ""}
                    {r.crm ? `${crmClosingSummary(r.crm)} · ` : ""}
                    {reasonLabel(r.reason)}
                    {" · "}
                    {new Date(r.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>
                <Badge variant={r.source === "velip_callback" ? "destructive" : "secondary"}>
                  {dncSourceLabel(r.source)}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  title="Abrir chat no WhatsApp"
                  disabled={!onOpenChat}
                  onClick={() => onOpenChat?.(r.phone)}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </Button>
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
