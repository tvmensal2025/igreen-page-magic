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
  short_code: string | null;
}

/** Textos claros para o consultor — sem jargão técnico. */
const REASON_LABEL: Record<string, string> = {
  no_campaign_ctwa_phrase:
    "Veio do anúncio, mas sem campanha identificada (faltou o protocolo FB-xxxxx na mensagem)",
  rodizio_pool_empty: "A fila de rodízio dessa campanha está vazia ou pausada",
  rodizio_rpc_error: "Falha técnica ao escolher o próximo parceiro da fila",
  no_campaign_generic: "Sinal de anúncio detectado, sem campanha vinculada",
};

const ERROR_LABEL: Record<string, string> = {
  missing_auth: "Sessão expirada. Faça login novamente.",
  invalid_auth: "Sessão inválida. Faça login novamente.",
  consultant_not_found: "Seu usuário não está cadastrado como consultor.",
  customer_not_found: "Lead não encontrado.",
  partner_not_found: "Parceiro não encontrado.",
  partner_inactive: "Este parceiro foi removido e não pode receber leads.",
  forbidden_customer: "Você não tem permissão para atribuir este lead.",
  partner_wrong_consultant: "Este parceiro não pertence ao dono do lead.",
  invalid_body: "Dados inválidos. Recarregue a página e tente de novo.",
};

/**
 * Card na aba Parceiros: leads que caíram na fila de revisão manual
 * (customers.needs_manual_review = true). O consultor escolhe o parceiro
 * — o sistema nunca chuta sozinho nesses casos.
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

  // Mesmo critério do dashboard (`useReferralPartners`): só ativos.
  // Sem `is_active`, a fila listava parceiros removidos e inflava o select.
  const { data: partners = [] } = useQuery({
    queryKey: ["referral-partners-simple", consultantId],
    enabled: !!consultantId && leads.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Partner[]> => {
      const { data, error } = await supabase
        .from("referral_partners")
        .select("id, nome, short_code")
        .eq("consultant_id", consultantId)
        .eq("is_active", true)
        .order("nome");
      if (error) throw error;
      return (data || []) as Partner[];
    },
  });

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
        (payload: any) => {
          const before = payload?.old?.needs_manual_review;
          const after = payload?.new?.needs_manual_review;
          if (before === true || after === true) {
            qc.invalidateQueries({ queryKey: ["manual-review-leads", consultantId] });
          }
        },
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
      const { data, error } = await supabase.functions.invoke("assign-lead-manual", {
        body: { customer_id: lead.id, partner_id: partnerId },
      });

      const payload = (data || {}) as {
        ok?: boolean;
        error?: string;
        protocol?: string | null;
        partner_name?: string;
        notify_ok?: boolean;
        notify_error?: string | null;
      };

      if (error || payload.ok === false) {
        const code = payload.error || error?.message || "unknown";
        throw new Error(ERROR_LABEL[code] || code);
      }

      const partnerName = payload.partner_name || "parceiro";
      const proto = payload.protocol ? ` · Protocolo ${payload.protocol}` : "";

      if (payload.notify_ok === false) {
        const notifyReason = payload.notify_error === "partner_no_phone"
          ? "Parceiro sem WhatsApp de aviso cadastrado."
          : payload.notify_error === "send_failed"
            ? "Não foi possível enviar o WhatsApp agora."
            : "Aviso ao parceiro não foi enviado.";
        toast({
          title: `Lead atribuído a ${partnerName}`,
          description: `${notifyReason}${proto}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: `Lead atribuído a ${partnerName}`,
          description: `Parceiro avisado no WhatsApp${proto}`,
        });
      }
      setSelectedPartner((s) => {
        const next = { ...s };
        delete next[lead.id];
        return next;
      });
      qc.invalidateQueries({ queryKey: ["manual-review-leads", consultantId] });
    } catch (e: any) {
      toast({
        title: "Não foi possível atribuir",
        description: e?.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setAssigningId(null);
    }
  }

  async function handleDismiss(lead: ManualReviewLead) {
    setAssigningId(lead.id);
    try {
      const { error } = await supabase
        .from("customers")
        .update({ needs_manual_review: false, manual_review_reason: null })
        .eq("id", lead.id);
      if (error) throw error;
      toast({
        title: "Lead saiu da fila",
        description: "Ele continua com você — sem enviar para parceiro.",
      });
      qc.invalidateQueries({ queryKey: ["manual-review-leads", consultantId] });
    } catch (e: any) {
      toast({ title: "Erro ao remover da fila", description: e?.message, variant: "destructive" });
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
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <div>
            <h3 className="font-semibold text-sm">
              Fila de revisão · {leads.length} lead{leads.length > 1 ? "s" : ""}
            </h3>
            <p className="text-xs text-muted-foreground">
              Estes leads vieram de anúncio, mas o sistema não identificou a campanha
              com segurança. Escolha o parceiro certo — assim ninguém recebe lead errado.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} title="Atualizar fila">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-2">
        {leads.map((lead) => {
          const reasonLabel =
            REASON_LABEL[lead.manual_review_reason || ""] ||
            lead.manual_review_reason ||
            "Motivo não informado";
          return (
            <div
              key={lead.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card p-3"
            >
              <div className="flex-1 min-w-[200px]">
                <p className="text-sm font-medium">{lead.name || "(sem nome)"}</p>
                <p className="text-xs text-muted-foreground">
                  {lead.phone_whatsapp || "sem telefone"}
                </p>
                <p className="text-[11px] text-amber-700/90 dark:text-amber-400/90 mt-0.5">
                  {reasonLabel}
                </p>
              </div>

              <Select
                value={selectedPartner[lead.id] || ""}
                onValueChange={(v) => setSelectedPartner((s) => ({ ...s, [lead.id]: v }))}
              >
                <SelectTrigger className="h-8 w-[220px] text-xs">
                  <SelectValue placeholder="Escolher parceiro..." />
                </SelectTrigger>
                <SelectContent>
                  {partners.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome}
                      {p.short_code ? ` · ${p.short_code}` : ""}
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
                {assigningId === lead.id ? "Atribuindo…" : "Atribuir"}
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
