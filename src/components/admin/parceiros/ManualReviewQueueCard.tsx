import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface ManualReviewLead {
  id: string;
  name: string | null;
  phone_whatsapp: string | null;
  manual_review_reason: string | null;
  manual_review_at: string | null;
  source_campaign_id: string | null;
}

interface Partner {
  id: string;
  nome: string;
}

const REASON_LABEL: Record<string, string> = {
  no_campaign_ctwa_phrase: "Lead veio do anúncio mas sem campanha identificada",
  rodizio_pool_empty: "Fila de rodízio vazia ou inativa",
  rodizio_rpc_error: "Erro técnico ao chamar o rodízio",
  no_campaign_generic: "Sinal genérico de anúncio",
};

/**
 * Card exibido na aba Parceiros: leads que caíram na fila de revisão manual
 * (customers.needs_manual_review = true). Nunca vão pro parceiro errado
 * automaticamente — o admin escolhe manualmente. Blindagem do rodízio.
 */
export function ManualReviewQueueCard({ consultantId }: { consultantId: string }) {
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const { toast } = useToast();

  const {
    data: leads = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["manual-review-leads", consultantId],
    enabled: !!consultantId,
    refetchInterval: 30_000,
    staleTime: 15_000,
    queryFn: async (): Promise<ManualReviewLead[]> => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, phone_whatsapp, manual_review_reason, manual_review_at, source_campaign_id")
        .eq("consultant_id", consultantId)
        .eq("needs_manual_review", true)
        .order("manual_review_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as ManualReviewLead[];
    },
  });

  const { data: partners = [] } = useQuery({
    queryKey: ["referral-partners-simple", consultantId],
    enabled: !!consultantId && leads.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Partner[]> => {
      const { data, error } = await supabase
        .from("referral_partners")
        .select("id, nome")
        .eq("consultant_id", consultantId)
        .order("nome");
      if (error) throw error;
      return (data || []) as Partner[];
    },
  });

  // Realtime: atualiza a fila quando algo entra na revisão
  useEffect(() => {
    if (!consultantId) return;
    const channel = supabase
      .channel(`manual-review-${consultantId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "customers",
          filter: `consultant_id=eq.${consultantId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["manual-review-leads", consultantId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [consultantId, qc]);

  async function handleAssign(lead: ManualReviewLead) {
    const partnerId = selectedPartner[lead.id];
    if (!partnerId) {
      toast({ title: "Escolha um parceiro antes de atribuir", variant: "destructive" });
      return;
    }
    setAssigningId(lead.id);
    try {
      const { error } = await supabase
        .from("customers")
        .update({
          referral_partner_id: partnerId,
          referral_detected_at: new Date().toISOString(),
          needs_manual_review: false,
        })
        .eq("id", lead.id);
      if (error) throw error;
      toast({ title: "Lead atribuído ao parceiro" });
      qc.invalidateQueries({ queryKey: ["manual-review-leads", consultantId] });
    } catch (e: any) {
      toast({ title: "Erro ao atribuir", description: e?.message, variant: "destructive" });
    } finally {
      setAssigningId(null);
    }
  }

  async function handleDismiss(lead: ManualReviewLead) {
    setAssigningId(lead.id);
    try {
      const { error } = await supabase
        .from("customers")
        .update({ needs_manual_review: false })
        .eq("id", lead.id);
      if (error) throw error;
      toast({ title: "Lead removido da fila (mantido com você)" });
      qc.invalidateQueries({ queryKey: ["manual-review-leads", consultantId] });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message, variant: "destructive" });
    } finally {
      setAssigningId(null);
    }
  }

  if (isLoading) return null;
  if (leads.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
          <div>
            <h3 className="font-semibold text-sm">
              Fila de revisão manual · {leads.length} lead{leads.length > 1 ? "s" : ""}
            </h3>
            <p className="text-xs text-muted-foreground">
              Estes leads vieram de anúncios mas o sistema não conseguiu identificar
              com <b>certeza</b> a campanha ou o parceiro. Atribua manualmente para
              nunca ir para o parceiro errado.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-2">
        {leads.map((lead) => {
          const reasonLabel = REASON_LABEL[lead.manual_review_reason || ""] ||
            lead.manual_review_reason || "Sem detalhes";
          return (
            <div
              key={lead.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card p-3"
            >
              <div className="flex-1 min-w-[200px]">
                <p className="text-sm font-medium">{lead.name || "(sem nome)"}</p>
                <p className="text-xs text-muted-foreground">
                  {lead.phone_whatsapp} · {reasonLabel}
                </p>
              </div>

              <Select
                value={selectedPartner[lead.id] || ""}
                onValueChange={(v) => setSelectedPartner((s) => ({ ...s, [lead.id]: v }))}
              >
                <SelectTrigger className="h-8 w-[200px] text-xs">
                  <SelectValue placeholder="Escolher parceiro..." />
                </SelectTrigger>
                <SelectContent>
                  {partners.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                size="sm"
                onClick={() => handleAssign(lead)}
                disabled={assigningId === lead.id || !selectedPartner[lead.id]}
              >
                <CheckCircle2 className="w-4 h-4 mr-1" />
                Atribuir
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDismiss(lead)}
                disabled={assigningId === lead.id}
                title="Mantém o lead comigo, sem distribuir"
              >
                Ficar comigo
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
