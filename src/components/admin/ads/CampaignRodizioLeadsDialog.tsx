import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Users, Phone, MessageCircle, ChevronDown, ChevronRight, Bell } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaignId: string | null;
  campaignName: string;
  onOpenConversation?: (phone: string) => void;
}

interface PartnerRow {
  partner_id: string;
  nome: string;
  notification_phone: string | null;
  position: number;
  leads: LeadRow[];
}
interface LeadRow {
  id: string;
  name: string | null;
  phone: string;
  created_at: string;
}

export function CampaignRodizioLeadsDialog({
  open,
  onOpenChange,
  campaignId,
  campaignName,
  onOpenConversation,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<PartnerRow[]>([]);
  const [unassigned, setUnassigned] = useState<LeadRow[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [poolId, setPoolId] = useState<string | null>(null);
  const [interval, setIntervalMin] = useState<number>(60);
  const [savingInterval, setSavingInterval] = useState(false);

  useEffect(() => {
    if (!open || !campaignId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 1) Pool ativa (mais recente ativa da campanha)
        const { data: pool, error: e1 } = await supabase
          .from("rodizio_pools")
          .select("id, metrics_broadcast_interval_minutes")
          .eq("campaign_id", campaignId)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (e1) throw e1;
        if (!cancelled) {
          setPoolId(pool?.id ?? null);
          setIntervalMin(Number((pool as any)?.metrics_broadcast_interval_minutes ?? 60));
        }

        // 2) Membros + parceiros
        let members: any[] = [];
        if (pool?.id) {
          const { data: mem, error: e2 } = await supabase
            .from("rodizio_pool_members")
            .select("partner_id, position, referral_partners:partner_id(id,nome,notification_phone)")
            .eq("pool_id", pool.id)
            .order("position", { ascending: true });
          if (e2) throw e2;
          members = mem || [];
        }

        // 3) Leads (customers) da campanha com referral_partner_id
        const { data: leads, error: e3 } = await supabase
          .from("customers")
          .select("id, name, phone_whatsapp, created_at, referral_partner_id")
          .eq("source_campaign_id", campaignId)
          .order("created_at", { ascending: false });
        if (e3) throw e3;

        const byPartner: Record<string, LeadRow[]> = {};
        const noPartner: LeadRow[] = [];
        for (const c of (leads || []) as any[]) {
          const row: LeadRow = {
            id: c.id,
            name: c.name,
            phone: c.phone_whatsapp,
            created_at: c.created_at,
          };
          if (c.referral_partner_id) {
            (byPartner[c.referral_partner_id] ||= []).push(row);
          } else {
            noPartner.push(row);
          }
        }

        // Combina: membros do rodízio + qualquer parceiro histórico que apareça
        // nos leads mas não esteja na pool atual (pool antiga trocada).
        const seen = new Set<string>();
        const built: PartnerRow[] = [];
        for (const m of members) {
          const pid = m.partner_id;
          seen.add(pid);
          built.push({
            partner_id: pid,
            nome: m.referral_partners?.nome || "(parceiro removido)",
            notification_phone: m.referral_partners?.notification_phone || null,
            position: m.position,
            leads: byPartner[pid] || [],
          });
        }
        const orphanIds = Object.keys(byPartner).filter((id) => !seen.has(id));
        if (orphanIds.length) {
          const { data: orphanPartners } = await supabase
            .from("referral_partners")
            .select("id,nome,notification_phone")
            .in("id", orphanIds);
          for (const p of (orphanPartners || []) as any[]) {
            built.push({
              partner_id: p.id,
              nome: `${p.nome} (fora do rodízio atual)`,
              notification_phone: p.notification_phone,
              position: 999,
              leads: byPartner[p.id] || [],
            });
          }
        }

        // Ordena: mais leads primeiro, depois posição
        built.sort((a, b) => b.leads.length - a.leads.length || a.position - b.position);

        if (!cancelled) {
          setRows(built);
          setUnassigned(noPartner);
          // Expande todos que têm leads
          const exp: Record<string, boolean> = {};
          for (const r of built) exp[r.partner_id] = r.leads.length > 0;
          setExpanded(exp);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, campaignId]);

  const totalAssigned = rows.reduce((s, r) => s + r.leads.length, 0);

  async function handleIntervalChange(v: string) {
    if (!poolId) return;
    const n = Number(v);
    setIntervalMin(n);
    setSavingInterval(true);
    try {
      const { error: uerr } = await supabase
        .from("rodizio_pools")
        .update({ metrics_broadcast_interval_minutes: n } as any)
        .eq("id", poolId);
      if (uerr) throw uerr;
      toast.success(n === 0 ? "Atualizações desligadas" : `Atualizações a cada ${n < 60 ? `${n} min` : `${n / 60}h`}`);
    } catch (e) {
      toast.error("Falha ao salvar: " + (e as Error).message);
    } finally {
      setSavingInterval(false);
    }
  }


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Leads do rodízio — {campaignName}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && error && (
          <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm">
            Erro ao carregar: {error}
          </div>
        )}

        {!loading && !error && (
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {poolId && (
              <div className="rounded-lg border bg-muted/30 p-3 flex items-center gap-3">
                <Bell className="w-4 h-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Atualizações no WhatsApp dos parceiros</div>
                  <div className="text-[11px] text-muted-foreground">
                    Métricas ao vivo da Meta (gasto, alcance, conversas, leads)
                  </div>
                </div>
                <Select value={String(interval)} onValueChange={handleIntervalChange} disabled={savingInterval}>
                  <SelectTrigger className="w-[140px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Desligado</SelectItem>
                    <SelectItem value="30">A cada 30 min</SelectItem>
                    <SelectItem value="60">A cada 1 hora</SelectItem>
                    <SelectItem value="120">A cada 2 horas</SelectItem>
                    <SelectItem value="240">A cada 4 horas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="text-xs text-muted-foreground px-1">
              {rows.length} parceiro(s) no rodízio · {totalAssigned} lead(s) distribuído(s)
              {unassigned.length > 0 && ` · ${unassigned.length} sem parceiro`}
            </div>


            {rows.length === 0 && unassigned.length === 0 && (
              <div className="text-center py-10 text-sm text-muted-foreground">
                Nenhum lead atribuído ao rodízio ainda.
              </div>
            )}

            {rows.map((r) => {
              const isOpen = !!expanded[r.partner_id];
              return (
                <div key={r.partner_id} className="rounded-lg border bg-card">
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((prev) => ({ ...prev, [r.partner_id]: !prev[r.partner_id] }))
                    }
                    className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/40"
                  >
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{r.nome}</div>
                      {r.notification_phone && (
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {r.notification_phone}
                        </div>
                      )}
                    </div>
                    <div className="text-xs shrink-0 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                      {r.leads.length} lead{r.leads.length === 1 ? "" : "s"}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t divide-y">
                      {r.leads.length === 0 && (
                        <div className="px-4 py-3 text-xs text-muted-foreground">
                          Ainda não recebeu leads dessa campanha.
                        </div>
                      )}
                      {r.leads.map((l) => (
                        <div key={l.id} className="px-4 py-2 flex items-center gap-2 text-sm">
                          <div className="flex-1 min-w-0">
                            <div className="truncate">{l.name || "(sem nome)"}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {l.phone} · {new Date(l.created_at).toLocaleString("pt-BR")}
                            </div>
                          </div>
                          {onOpenConversation && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 text-xs"
                              onClick={() => onOpenConversation(l.phone)}
                            >
                              <MessageCircle className="w-3.5 h-3.5" /> Abrir
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {unassigned.length > 0 && (
              <div className="rounded-lg border bg-muted/20">
                <div className="p-3 text-xs font-medium text-muted-foreground">
                  Leads sem parceiro atribuído ({unassigned.length})
                </div>
                <div className="border-t divide-y">
                  {unassigned.slice(0, 50).map((l) => (
                    <div key={l.id} className="px-4 py-2 flex items-center gap-2 text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{l.name || "(sem nome)"}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {l.phone} · {new Date(l.created_at).toLocaleString("pt-BR")}
                        </div>
                      </div>
                      {onOpenConversation && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-xs"
                          onClick={() => onOpenConversation(l.phone)}
                        >
                          <MessageCircle className="w-3.5 h-3.5" /> Abrir
                        </Button>
                      )}
                    </div>
                  ))}
                  {unassigned.length > 50 && (
                    <div className="px-4 py-2 text-[11px] text-muted-foreground">
                      … +{unassigned.length - 50} leads
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
