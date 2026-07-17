/**
 * Seleção de contatos para Voz — Base (Clientes + filtro Leads).
 * Busca leads sob demanda no consultor (não depende só da lista do VozTab).
 */
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Check, CalendarDays, Loader2 } from "lucide-react";
import { ContactImporter } from "@/components/whatsapp/ContactImporter";
import { supabase } from "@/integrations/supabase/client";
import type { BulkContact } from "@/types/whatsapp";
import { normalizeBrazilPhone } from "@/lib/phone";
import { isIgreenWalletOrigin } from "@/lib/customerOrigin";

export interface VozCustomer {
  id: string;
  name: string;
  phone_whatsapp: string;
  electricity_bill_value?: number | null;
  status?: string | null;
  devolutiva?: string | null;
  andamento_igreen?: string | null;
  conversation_step?: string | null;
  pos_venda_stage?: string | null;
  bot_paused?: boolean | null;
  registered_by_name?: string | null;
  last_inbound_at?: string | null;
  last_bot_interaction_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  customer_origin?: string | null;
}

const LEAD_SELECT =
  "id, name, phone_whatsapp, electricity_bill_value, status, devolutiva, andamento_igreen, conversation_step, pos_venda_stage, bot_paused, registered_by_name, last_bot_interaction_at, created_at, updated_at, customer_origin";

function dedupeContacts(list: BulkContact[]): BulkContact[] {
  const seen = new Set<string>();
  const unique: BulkContact[] = [];
  for (const c of list) {
    const k = c.phone.replace(/\D/g, "");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    unique.push(c);
  }
  return unique;
}

function mergeCustomers(a: VozCustomer[], b: VozCustomer[]): VozCustomer[] {
  const map = new Map<string, VozCustomer>();
  for (const c of a) map.set(c.id, c);
  for (const c of b) map.set(c.id, c);
  return Array.from(map.values());
}

function pickByPeriod(customers: VozCustomer[], days: number): BulkContact[] {
  const cutoff = Date.now() - days * 86_400_000;
  const picked: BulkContact[] = [];
  const seen = new Set<string>();
  for (const c of customers) {
    const ts = Date.parse(c.updated_at || c.created_at || "");
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const phone = normalizeBrazilPhone(c.phone_whatsapp);
    if (!phone) continue;
    const key = phone.replace(/\D/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({ id: c.id, name: c.name || phone, phone, source: "database" });
  }
  return picked;
}

export interface VozContactPickerPanelProps {
  consultantId: string;
  customers: VozCustomer[];
  value: BulkContact[];
  onChange: (contacts: BulkContact[]) => void;
  active?: boolean;
  showPeriodSelect?: boolean;
}

/** Painel embutível (sem Dialog) — passo Contatos do wizard. */
export function VozContactPickerPanel({
  consultantId,
  customers,
  value,
  onChange,
  active = true,
  showPeriodSelect = true,
}: VozContactPickerPanelProps) {
  const [periodDays, setPeriodDays] = useState<string>("none");
  const [fetchedLeads, setFetchedLeads] = useState<VozCustomer[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState<string | null>(null);

  // Busca leads direto (whatsapp_lead / manual) + last_inbound_at em customer_flow_state
  // (a coluna NÃO existe em customers — erro que zerava a lista).
  useEffect(() => {
    if (!active || !consultantId) return;
    let alive = true;
    (async () => {
      setLeadsLoading(true);
      setLeadsError(null);
      const { data, error } = await supabase
        .from("customers")
        .select(LEAD_SELECT)
        .eq("consultant_id", consultantId)
        .in("customer_origin", ["whatsapp_lead", "manual"])
        .not("phone_whatsapp", "is", null)
        .order("updated_at", { ascending: false })
        .limit(2000);
      if (!alive) return;
      if (error) {
        console.error("[VozContactPicker] leads", error);
        setLeadsError(error.message);
        setFetchedLeads([]);
        setLeadsLoading(false);
        return;
      }
      const leads = (data as VozCustomer[]) ?? [];
      // Enrich 48h filter from customer_flow_state (onde last_inbound_at realmente vive)
      const ids = leads.map((c) => c.id);
      const inboundMap = new Map<string, string | null>();
      for (let i = 0; i < ids.length; i += 200) {
        const slice = ids.slice(i, i + 200);
        const { data: flowRows } = await supabase
          .from("customer_flow_state")
          .select("customer_id, last_inbound_at")
          .in("customer_id", slice);
        if (!alive) return;
        for (const row of (flowRows as { customer_id: string; last_inbound_at: string | null }[]) || []) {
          inboundMap.set(String(row.customer_id), row.last_inbound_at ?? null);
        }
      }
      if (!alive) return;
      setFetchedLeads(
        leads.map((c) => ({ ...c, last_inbound_at: inboundMap.get(c.id) ?? null })),
      );
      setLeadsLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [active, consultantId]);

  const allCustomers = useMemo(
    () => mergeCustomers(fetchedLeads, customers),
    [fetchedLeads, customers],
  );

  const leadCount = useMemo(
    () => allCustomers.filter((c) => !isIgreenWalletOrigin(c.customer_origin)).filter((c) =>
      c.customer_origin === "whatsapp_lead" || c.customer_origin === "manual" || c.status === "lead"
    ).length,
    [allCustomers],
  );

  const dayCounts = useMemo(() => {
    const counts = new Array<number>(9).fill(0);
    const now = Date.now();
    for (const c of allCustomers) {
      const ts = Date.parse(c.updated_at || c.created_at || "");
      if (!Number.isFinite(ts)) continue;
      if (!normalizeBrazilPhone(c.phone_whatsapp)) continue;
      const daysAgo = Math.max(1, Math.ceil((now - ts) / 86_400_000));
      for (let d = daysAgo; d <= 8; d++) counts[d]++;
    }
    return counts;
  }, [allCustomers]);

  const applyPeriod = (daysStr: string) => {
    setPeriodDays(daysStr);
    if (daysStr === "none") return;
    const days = Number(daysStr);
    onChange(pickByPeriod(allCustomers, days));
  };

  return (
    <div className="space-y-3">
      {showPeriodSelect && (
        <div className="rounded-[var(--pe-radius)] border p-3 space-y-2" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface-muted)" }}>
          <Label className="flex items-center gap-1.5 text-xs">
            <CalendarDays className="h-3.5 w-3.5" style={{ color: "var(--pe-emerald)" }} />
            Atalho — atividade recente
          </Label>
          <Select value={periodDays} onValueChange={applyPeriod}>
            <SelectTrigger>
              <SelectValue placeholder="Escolher período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Selecionar manualmente</SelectItem>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  Últimos {d} dia{d > 1 ? "s" : ""} ({dayCounts[d]} contatos)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--pe-text-muted)" }}>
            {leadsLoading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Carregando leads…
              </>
            ) : leadsError ? (
              <span className="text-destructive">Falha ao carregar leads: {leadsError}</span>
            ) : (
              <>
                <strong style={{ color: "var(--pe-emerald-strong)" }}>{leadCount} leads</strong>
                {" "}na base · use o filtro <strong>Leads</strong> abaixo.
              </>
            )}
          </p>
        </div>
      )}

      <ContactImporter
        customers={allCustomers}
        contacts={value}
        onContactsChange={onChange}
        defaultStatusFilter="lead"
      />

      <p className="text-sm font-medium" style={{ color: "var(--pe-text)" }}>
        {value.length} contato(s) selecionado(s)
      </p>
    </div>
  );
}

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantId: string;
  customers: VozCustomer[];
  value: BulkContact[];
  onConfirm: (contacts: BulkContact[]) => void;
}

export function VozContactPickerDialog({
  open,
  onOpenChange,
  consultantId,
  customers,
  value,
  onConfirm,
}: DialogProps) {
  const [draft, setDraft] = useState<BulkContact[]>(value);

  useEffect(() => {
    if (!open) return;
    setDraft(value);
  }, [open, value]);

  const handleConfirm = () => {
    onConfirm(dedupeContacts(draft));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="painel-elite max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface-muted)" }}>
          <DialogTitle className="flex items-center gap-2" style={{ color: "var(--pe-text)" }}>
            <Users className="w-4 h-4" style={{ color: "var(--pe-emerald)" }} /> Selecionar contatos
          </DialogTitle>
          <DialogDescription>
            Clientes da carteira ou leads WhatsApp. Use o filtro Leads para campanhas de ligação.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4" style={{ background: "var(--pe-surface)" }}>
          <VozContactPickerPanel
            consultantId={consultantId}
            customers={customers}
            value={draft}
            onChange={setDraft}
            active={open}
            showPeriodSelect
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-5 py-3" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface-muted)" }}>
          <p className="text-sm font-medium" style={{ color: "var(--pe-text)" }}>
            {draft.length} contato(s) no rascunho
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={draft.length === 0}
              className="gap-1.5"
              style={{ background: "var(--pe-emerald)", color: "#fff" }}
            >
              <Check className="h-4 w-4" /> Confirmar seleção
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
