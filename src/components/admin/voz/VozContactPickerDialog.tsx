/**
 * Modal de seleção de contatos — mesmo padrão do Disparo PRO:
 * aba Base (ContactImporter) + aba Leads parados (list_stuck_leads).
 */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Users, Flame, Check } from "lucide-react";
import { ContactImporter } from "@/components/whatsapp/ContactImporter";
import { supabase } from "@/integrations/supabase/client";
import type { BulkContact } from "@/types/whatsapp";
import { KNOWN_REACTIVATION_STEPS } from "@/lib/reactivation-steps";
import { normalizeBrazilPhone } from "@/lib/phone";

export interface VozCustomer {
  id: string;
  name: string;
  phone_whatsapp: string;
  electricity_bill_value?: number;
  status?: string;
  devolutiva?: string | null;
  registered_by_name?: string | null;
  last_inbound_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface StuckLead {
  id: string;
  name: string | null;
  phone_whatsapp: string;
  conversation_step: string;
  hours_stuck: number;
  total_count: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantId: string;
  customers: VozCustomer[];
  value: BulkContact[];
  onConfirm: (contacts: BulkContact[]) => void;
}

function formatHoursStuck(hours: number): string {
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  const rem = Math.round(hours % 24);
  return `${days}d ${rem}h`;
}

function stepLabel(step: string): string {
  return KNOWN_REACTIVATION_STEPS.find((s) => s.step === step)?.label ?? step;
}

export function VozContactPickerDialog({
  open,
  onOpenChange,
  consultantId,
  customers,
  value,
  onConfirm,
}: Props) {
  const [draft, setDraft] = useState<BulkContact[]>(value);
  const [stuck, setStuck] = useState<StuckLead[]>([]);
  const [stuckLoading, setStuckLoading] = useState(false);
  const [stepFilter, setStepFilter] = useState<string>("all");
  const [stuckSelected, setStuckSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setDraft(value);
    setStuckSelected(new Set(value.filter((c) => c.source === "database").map((c) => c.id)));
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      setStuckLoading(true);
      const { data, error } = await (supabase as any).rpc("list_stuck_leads", {
        p_consultant: consultantId,
        p_step: stepFilter === "all" ? null : stepFilter,
        p_limit: 100,
        p_offset: 0,
      });
      if (!alive) return;
      if (error) {
        console.error(error);
        setStuck([]);
      } else {
        setStuck((data as StuckLead[]) || []);
      }
      setStuckLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [open, consultantId, stepFilter]);

  const toggleStuck = (lead: StuckLead) => {
    const phone = normalizeBrazilPhone(lead.phone_whatsapp);
    if (!phone) return;

    setStuckSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lead.id)) next.delete(lead.id);
      else next.add(lead.id);
      return next;
    });

    setDraft((prev) => {
      const exists = prev.some((c) => c.id === lead.id);
      if (exists) return prev.filter((c) => c.id !== lead.id);
      return [
        ...prev,
        {
          id: lead.id,
          name: lead.name || "Lead parado",
          phone,
          source: "database" as const,
        },
      ];
    });
  };

  const selectAllStuck = () => {
    const nextDraft = [...draft];
    const nextIds = new Set(stuckSelected);
    for (const lead of stuck) {
      const phone = normalizeBrazilPhone(lead.phone_whatsapp);
      if (!phone || nextIds.has(lead.id)) continue;
      nextIds.add(lead.id);
      nextDraft.push({
        id: lead.id,
        name: lead.name || "Lead parado",
        phone,
        source: "database",
      });
    }
    setStuckSelected(nextIds);
    setDraft(nextDraft);
  };

  const handleConfirm = () => {
    // dedupe por telefone
    const seen = new Set<string>();
    const unique: BulkContact[] = [];
    for (const c of draft) {
      const k = c.phone.replace(/\D/g, "");
      if (!k || seen.has(k)) continue;
      seen.add(k);
      unique.push(c);
    }
    onConfirm(unique);
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
            Escolha clientes da base ou leads parados (mesmo estilo do Disparo em massa).
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4" style={{ background: "var(--pe-surface)" }}>
          <Tabs defaultValue="base">
            <TabsList className="mb-3" style={{ background: "var(--pe-surface-muted)" }}>
              <TabsTrigger value="base" className="gap-1.5 data-[state=active]:bg-[var(--pe-surface)]">
                <Users className="h-3.5 w-3.5" /> Clientes
              </TabsTrigger>
              <TabsTrigger value="stuck" className="gap-1.5 data-[state=active]:bg-[var(--pe-surface)]">
                <Flame className="h-3.5 w-3.5" /> Leads parados
              </TabsTrigger>
            </TabsList>

            <TabsContent value="base" className="mt-0">
              <ContactImporter
                customers={customers}
                contacts={draft}
                onContactsChange={setDraft}
              />
            </TabsContent>

            <TabsContent value="stuck" className="mt-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Select value={stepFilter} onValueChange={setStepFilter}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Filtrar passo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os passos</SelectItem>
                    {KNOWN_REACTIVATION_STEPS.map((s) => (
                      <SelectItem key={s.step} value={s.step}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="sm" onClick={selectAllStuck} disabled={stuck.length === 0}>
                  Selecionar página
                </Button>
                <span className="text-xs text-muted-foreground">
                  {stuckSelected.size} selecionado(s) nesta lista
                </span>
              </div>

              {stuckLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : stuck.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Nenhum lead parado neste filtro.
                </p>
              ) : (
                <ul className="max-h-72 space-y-1.5 overflow-y-auto rounded-[var(--pe-radius)] border p-2" style={{ borderColor: "var(--pe-border)" }}>
                  {stuck.map((lead) => {
                    const checked = stuckSelected.has(lead.id);
                    return (
                      <li key={lead.id}>
                        <button
                          type="button"
                          onClick={() => toggleStuck(lead)}
                          className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors border"
                          style={
                            checked
                              ? { background: "var(--pe-emerald-10)", borderColor: "var(--pe-emerald-20)" }
                              : { background: "transparent", borderColor: "transparent" }
                          }
                        >
                          <Checkbox checked={checked} className="pointer-events-none" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{lead.name || "Sem nome"}</p>
                            <p className="text-xs text-muted-foreground">{stepLabel(lead.conversation_step)}</p>
                          </div>
                          <Badge variant="secondary" className="shrink-0 text-[10px]">
                            {formatHoursStuck(Number(lead.hours_stuck) || 0)}
                          </Badge>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </TabsContent>
          </Tabs>
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
