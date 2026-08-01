import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface Lead {
  id: string;
  name: string | null;
  phone_whatsapp: string;
  conversation_step: string;
  status: string;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaignId: string;
  consultantId: string;
  fromDate: string;
  toDate: string;
}

const PAGE_SIZE = 50;

export function CampaignDetailDialog({ open, onOpenChange, campaignId, consultantId, fromDate, toDate }: Props) {
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [costPerLead, setCostPerLead] = useState<number | null>(null);
  const [campaignName, setCampaignName] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setPage(0);
    load(0);
    loadCampaign();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaignId]);

  async function loadCampaign() {
    const { data } = await supabase
      .from("facebook_campaigns")
      .select("name")
      .eq("id", campaignId)
      .maybeSingle();
    setCampaignName((data as any)?.name || "");
  }

  async function load(p: number) {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setLoading(false); return; }
      const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || "";
      const url = `${supabaseUrl}/functions/v1/meta-ads-metrics?campaign_id=${campaignId}&from=${fromDate}&to=${toDate}&page=${p}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) {
        setLeads(data.leads || []);
        setTotal(Number(data.total || 0));
        setCostPerLead(data.cost_per_lead_cents ?? null);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{campaignName || "Campanha"}</DialogTitle>
          <DialogDescription>
            {total} leads no período · custo por lead {costPerLead != null ? `R$ ${(costPerLead / 100).toFixed(2)}` : "—"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="grid place-items-center py-8">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            <div className="max-h-[400px] overflow-y-auto overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/30">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Nome</th>
                    <th className="px-2 py-1.5 text-left">Telefone</th>
                    <th className="px-2 py-1.5 text-left">Passo</th>
                    <th className="px-2 py-1.5 text-left">Status</th>
                    <th className="px-2 py-1.5 text-left">Criado</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="px-2 py-1.5">{l.name || "—"}</td>
                      <td className="px-2 py-1.5 font-mono">{l.phone_whatsapp}</td>
                      <td className="px-2 py-1.5">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">
                          {l.conversation_step}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge variant={l.status === "approved" ? "default" : "outline"} className="text-[9px]">
                          {l.status}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5">
                        {new Date(l.created_at).toLocaleDateString("pt-BR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex justify-center gap-2 pt-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => { setPage(page - 1); load(page - 1); }}>
                  Anterior
                </Button>
                <span className="text-xs text-muted-foreground self-center">
                  Página {page + 1} de {totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => { setPage(page + 1); load(page + 1); }}>
                  Próxima
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
