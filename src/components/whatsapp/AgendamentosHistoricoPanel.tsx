import { useCallback, useEffect, useState } from "react";
import { History, Loader2, MessageSquare, Phone, Smartphone, Flame, CalendarClock } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { AutoMessageLog } from "@/components/whatsapp/AutoMessageLog";
import { labelCadenceStage, cadenceStageGroup, CADENCE_GROUP_BADGE } from "@/lib/cadenceStageLabels";
import { formatDurationSec, velipOutcomeLabel } from "@/components/admin/voz/voiceOutcomeLabels";

type Props = { consultantId: string };

type MotorRow = {
  id: string;
  customer_id: string;
  stage: string;
  channel: string;
  status: string;
  created_at: string;
  customer_name?: string | null;
  customer_phone?: string | null;
};

type CallRow = {
  id: string;
  to_phone: string;
  status: string | null;
  velip_status: string | null;
  duration_sec: number | null;
  velip_time_sec: number | null;
  created_at: string;
  error: string | null;
};

type SmsRow = {
  id: string;
  phone: string;
  message: string;
  status: string;
  delivery_status: string | null;
  created_at: string;
  error: string | null;
};

type ManualRow = {
  id: string;
  remote_jid: string;
  message_text: string;
  status: string;
  scheduled_at: string;
  sent_at: string | null;
};

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2">
      <History className="h-7 w-7 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-xs text-muted-foreground/60 max-w-md text-center">{hint}</p>
    </div>
  );
}

function whenLabel(iso: string) {
  return new Date(iso).toLocaleString("pt-BR");
}

export function AgendamentosHistoricoPanel({ consultantId }: Props) {
  const [tab, setTab] = useState<"auto" | "motor" | "ligacoes" | "sms" | "manual">("auto");
  const [loading, setLoading] = useState(false);
  const [motor, setMotor] = useState<MotorRow[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [sms, setSms] = useState<SmsRow[]>([]);
  const [manual, setManual] = useState<ManualRow[]>([]);

  const loadExtras = useCallback(async () => {
    if (!consultantId) return;
    setLoading(true);
    try {
      const [motorRes, callRes, smsRes, manualRes] = await Promise.all([
        (supabase as any)
          .from("cadence_action_log")
          .select("id, customer_id, stage, channel, status, created_at")
          .eq("consultant_id", consultantId)
          .in("status", ["sent", "failed", "delivered", "queued"])
          .order("created_at", { ascending: false })
          .limit(150),
        (supabase as any)
          .from("voice_call_logs")
          .select("id, to_phone, status, velip_status, duration_sec, velip_time_sec, created_at, error")
          .eq("consultant_id", consultantId)
          .order("created_at", { ascending: false })
          .limit(150),
        (supabase as any)
          .from("voice_sms_log")
          .select("id, phone, message, status, delivery_status, created_at, error")
          .eq("consultant_id", consultantId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("scheduled_messages")
          .select("id, remote_jid, message_text, status, scheduled_at, sent_at")
          .eq("consultant_id", consultantId)
          .in("status", ["sent", "failed", "skipped", "cancelled", "canceled"])
          .order("scheduled_at", { ascending: false })
          .limit(100),
      ]);

      const motorRows = (motorRes.data || []) as MotorRow[];
      const custIds = [...new Set(motorRows.map((r) => r.customer_id).filter(Boolean))];
      const custMap = new Map<string, { name: string | null; phone: string | null }>();
      if (custIds.length) {
        const { data: custs } = await supabase
          .from("customers")
          .select("id, name, phone_whatsapp")
          .in("id", custIds);
        for (const c of (custs || []) as Array<{ id: string; name: string | null; phone_whatsapp: string | null }>) {
          custMap.set(c.id, { name: c.name, phone: c.phone_whatsapp });
        }
      }
      setMotor(
        motorRows.map((r) => ({
          ...r,
          customer_name: custMap.get(r.customer_id)?.name ?? null,
          customer_phone: custMap.get(r.customer_id)?.phone ?? null,
        })),
      );
      setCalls((callRes.data || []) as CallRow[]);
      setSms((smsRes.data || []) as SmsRow[]);
      setManual((manualRes.data || []) as ManualRow[]);
    } finally {
      setLoading(false);
    }
  }, [consultantId]);

  useEffect(() => {
    if (tab === "auto") return;
    void loadExtras();
  }, [tab, loadExtras]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-[Sora,ui-sans-serif] font-semibold text-base text-foreground flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" />
          Histórico
        </h3>
        <p className="text-[11px] text-muted-foreground mt-1">
          Só o que já aconteceu — enviados, atendidos, sem resposta e falhas. O que ainda vai sair fica em Futuros.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="space-y-3">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/40 p-1">
          <TabsTrigger value="auto" className="text-[11px] gap-1">
            <MessageSquare className="w-3 h-3" /> Pós-venda / CRM
          </TabsTrigger>
          <TabsTrigger value="motor" className="text-[11px] gap-1">
            <Flame className="w-3 h-3" /> Motor
          </TabsTrigger>
          <TabsTrigger value="ligacoes" className="text-[11px] gap-1">
            <Phone className="w-3 h-3" /> Ligações
          </TabsTrigger>
          <TabsTrigger value="sms" className="text-[11px] gap-1">
            <Smartphone className="w-3 h-3" /> SMS
          </TabsTrigger>
          <TabsTrigger value="manual" className="text-[11px] gap-1">
            <CalendarClock className="w-3 h-3" /> Agenda manual
          </TabsTrigger>
        </TabsList>

        <TabsContent value="auto" className="mt-0">
          <AutoMessageLog consultantId={consultantId} />
        </TabsContent>

        <TabsContent value="motor" className="mt-0">
          {loading ? (
            <Loading />
          ) : motor.length === 0 ? (
            <EmptyState title="Sem ações do motor ainda" hint="Envios WA/SMS/ligação do ciclo A→B→C aparecem aqui depois de saírem." />
          ) : (
            <ScrollArea className="max-h-[520px]">
              <div className="space-y-2">
                {motor.map((r) => {
                  const g = cadenceStageGroup(r.stage);
                  return (
                    <div key={r.id} className="rounded-lg border border-border/30 bg-secondary/30 p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-foreground">
                          {r.customer_name || r.customer_phone || "Lead"}
                        </span>
                        <Badge variant="secondary" className="text-[9px]">
                          {labelCadenceStage(r.stage, "short")}
                        </Badge>
                        <Badge variant="outline" className="text-[9px]">{r.channel}</Badge>
                        {g && g !== "fim" && (
                          <span className="text-[9px] text-muted-foreground">
                            {g} · {CADENCE_GROUP_BADGE[g]}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">{whenLabel(r.created_at)}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1 capitalize">{r.status}</p>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="ligacoes" className="mt-0">
          {loading ? (
            <Loading />
          ) : calls.length === 0 ? (
            <EmptyState title="Sem ligações registradas" hint="Atendidas, sem resposta e falhas da Velip aparecem aqui." />
          ) : (
            <ScrollArea className="max-h-[520px]">
              <div className="space-y-2">
                {calls.map((r) => {
                        const outcome = velipOutcomeLabel(r.velip_status || r.status);
                  const sec = r.velip_time_sec ?? r.duration_sec;
                  const dur = sec != null && Number.isFinite(sec) ? formatDurationSec(sec) : null;
                  return (
                    <div key={r.id} className="rounded-lg border border-border/30 bg-secondary/30 p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Phone className="w-3.5 h-3.5 text-info shrink-0" />
                        <span className="text-xs font-medium tabular-nums">{r.to_phone}</span>
                        <Badge variant="secondary" className="text-[9px]">{outcome || r.status || "—"}</Badge>
                        {dur && <span className="text-[10px] text-muted-foreground">{dur}</span>}
                        <span className="text-[10px] text-muted-foreground ml-auto">{whenLabel(r.created_at)}</span>
                      </div>
                      {r.error && <p className="text-[10px] text-destructive mt-1 line-clamp-2">{r.error}</p>}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="sms" className="mt-0">
          {loading ? (
            <Loading />
          ) : sms.length === 0 ? (
            <EmptyState title="Sem SMS no histórico" hint="SMS enviados/entregues/falhos da Velip aparecem aqui." />
          ) : (
            <ScrollArea className="max-h-[520px]">
              <div className="space-y-2">
                {sms.map((r) => (
                  <div key={r.id} className="rounded-lg border border-border/30 bg-secondary/30 p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Smartphone className="w-3.5 h-3.5 text-info shrink-0" />
                      <span className="text-xs font-medium tabular-nums">{r.phone}</span>
                      <Badge variant="secondary" className="text-[9px]">
                        {r.delivery_status || r.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground ml-auto">{whenLabel(r.created_at)}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 line-clamp-3">{r.message}</p>
                    {r.error && <p className="text-[10px] text-destructive mt-1 line-clamp-2">{r.error}</p>}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="manual" className="mt-0">
          {loading ? (
            <Loading />
          ) : manual.length === 0 ? (
            <EmptyState title="Sem agenda manual concluída" hint="Mensagens manuais enviadas, falhas ou canceladas aparecem aqui." />
          ) : (
            <ScrollArea className="max-h-[520px]">
              <div className="space-y-2">
                {manual.map((r) => (
                  <div key={r.id} className="rounded-lg border border-border/30 bg-secondary/30 p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CalendarClock className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="text-xs font-medium tabular-nums">
                        {r.remote_jid.split("@")[0]}
                      </span>
                      <Badge variant="secondary" className="text-[9px]">{r.status}</Badge>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {whenLabel(r.sent_at || r.scheduled_at)}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 line-clamp-3">{r.message_text}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
    </div>
  );
}

export default AgendamentosHistoricoPanel;
