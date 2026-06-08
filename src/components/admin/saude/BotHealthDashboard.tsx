// BotHealthDashboard — conteúdo unificado de saúde/desempenho do bot.
// Extraído de pages/SaudeBot.tsx para ser reutilizável tanto na página
// /admin/saude-bot quanto embutido na aba "Atendente IA" (sub-aba Desempenho).
//
// Reúne num só lugar: Análise Gemini (BotHealthIntel) + Cérebro IA (AIBrainPanel)
// + Motor v3 (FlowEngineHealthCard) + alertas de handoff + leads parados + funil.
// NÃO contém navegação de página (header/voltar) — quem embute decide o chrome.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, MessageCircle, RefreshCw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import BotHealthIntel from "./BotHealthIntel";
import AIBrainPanel from "./AIBrainPanel";
import FlowEngineHealthCard from "./FlowEngineHealthCard";

type Alert = {
  id: string;
  customer_id: string;
  reason: string;
  user_message: string | null;
  created_at: string;
  metadata: any;
  customer?: { name: string | null; phone_whatsapp: string | null; conversation_step: string | null };
};

type StuckLead = {
  id: string;
  name: string | null;
  phone_whatsapp: string | null;
  conversation_step: string | null;
  last_step_advanced_at: string | null;
  hours_stuck: number;
};

function formatReason(r: string): string {
  const map: Record<string, string> = {
    auto_loop_detected: "Loop detectado — lead repetiu o mesmo passo várias vezes",
    auto_orphan_step_detected: "Passo órfão — fluxo foi alterado e o lead ficou em um passo inexistente",
    custom_step_no_match_retries_exhausted: "IA não entendeu a resposta após 3 tentativas",
    duvida_fora_faq: "Lead fez uma pergunta que não está na base de conhecimento",
    cadastro_falhou: "Cadastro no portal falhou",
    no_media_received: "Lead não enviou a foto/documento solicitado",
    step_misconfigured_or_lead_off_topic: "Passo mal configurado ou lead saiu do roteiro",
  };
  return map[r] || r.replace(/_/g, " ");
}

export default function BotHealthDashboard({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stuck, setStuck] = useState<StuckLead[]>([]);
  const [stepFunnel, setStepFunnel] = useState<{ step: string; total: number }[]>([]);

  async function load(uid: string) {
    setLoading(true);
    try {
      // 1) Handoff alerts abertos
      const { data: rawAlerts } = await supabase
        .from("bot_handoff_alerts")
        .select("id, customer_id, reason, user_message, created_at, metadata")
        .eq("consultant_id", uid)
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(50);

      const customerIds = (rawAlerts || []).map((a) => a.customer_id).filter(Boolean);
      const { data: customers } = customerIds.length
        ? await supabase
            .from("customers")
            .select("id, name, phone_whatsapp, conversation_step")
            .in("id", customerIds)
        : { data: [] };
      const customerMap = new Map((customers || []).map((c: any) => [c.id, c]));
      setAlerts((rawAlerts || []).map((a: any) => ({ ...a, customer: customerMap.get(a.customer_id) })));

      // 2) Leads parados +24h (não pausados)
      const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
      const { data: stuckRows } = await supabase
        .from("customers")
        .select("id, name, phone_whatsapp, conversation_step, last_step_advanced_at")
        .eq("consultant_id", uid)
        .eq("bot_paused", false)
        .not("conversation_step", "is", null)
        .lt("last_step_advanced_at", cutoff)
        .order("last_step_advanced_at", { ascending: true })
        .limit(30);

      setStuck((stuckRows || []).map((r: any) => ({
        ...r,
        hours_stuck: r.last_step_advanced_at
          ? Math.floor((Date.now() - new Date(r.last_step_advanced_at).getTime()) / 3600_000)
          : 0,
      })));

      // 3) Funil: quantos leads em cada passo (snapshot atual)
      const { data: funnelRows } = await supabase
        .from("customers")
        .select("conversation_step")
        .eq("consultant_id", uid)
        .not("conversation_step", "is", null)
        .limit(2000);

      const counts = new Map<string, number>();
      for (const r of funnelRows || []) {
        const k = (r as any).conversation_step as string;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      const arr = Array.from(counts.entries())
        .map(([step, total]) => ({ step, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 8);
      setStepFunnel(arr);
    } catch (e: any) {
      toast.error("Erro ao carregar: " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (userId) load(userId); }, [userId]);

  async function resolveAlert(alertId: string) {
    if (!userId) return;
    const { error } = await supabase
      .from("bot_handoff_alerts")
      .update({ resolved_at: new Date().toISOString(), resolved_by: userId })
      .eq("id", alertId);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Alerta marcado como resolvido");
    load(userId);
  }

  async function resumeBot(customerId: string) {
    const { error } = await supabase
      .from("customers")
      .update({ bot_paused: false, bot_paused_reason: null, bot_paused_at: null })
      .eq("id", customerId);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Bot reativado para esse lead");
    load(userId);
  }

  const criticalAlerts = useMemo(() =>
    alerts.filter((a) => a.reason.startsWith("auto_") || a.reason === "custom_step_no_match_retries_exhausted"),
  [alerts]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={() => userId && load(userId)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      {/* IA — Análise Gemini 7d */}
      {userId && <BotHealthIntel consultantId={userId} />}

      {/* Cérebro IA — decisões + custos */}
      {userId && <AIBrainPanel consultantId={userId} />}

      {/* Motor de Fluxo v3 — saúde por consultor */}
      {userId && <FlowEngineHealthCard consultantId={userId} />}

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 sm:p-4">
          <div className="text-xs text-muted-foreground">Alertas abertos</div>
          <div className={`text-2xl font-bold ${alerts.length > 0 ? "text-amber-600" : "text-emerald-600"}`}>
            {alerts.length}
          </div>
        </Card>
        <Card className="p-3 sm:p-4">
          <div className="text-xs text-muted-foreground">Leads parados +24h</div>
          <div className={`text-2xl font-bold ${stuck.length > 0 ? "text-amber-600" : "text-emerald-600"}`}>
            {stuck.length}
          </div>
        </Card>
        <Card className="p-3 sm:p-4">
          <div className="text-xs text-muted-foreground">Crítico (auto-detectado)</div>
          <div className={`text-2xl font-bold ${criticalAlerts.length > 0 ? "text-red-600" : "text-emerald-600"}`}>
            {criticalAlerts.length}
          </div>
        </Card>
      </div>

      {/* Alertas */}
      <Card className="p-4">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Leads que precisam de você ({alerts.length})
        </h2>
        {alerts.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nenhum alerta aberto. 🎉
          </div>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li key={a.id} className="border rounded-lg p-3 bg-muted/30">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">
                      {a.customer?.name?.trim() || "(sem nome)"}
                      <span className="text-muted-foreground font-normal ml-2">{a.customer?.phone_whatsapp}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatReason(a.reason)}
                    </div>
                    {a.user_message && (
                      <div className="text-xs italic mt-1 text-foreground/80">"{a.user_message.slice(0, 200)}"</div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {new Date(a.created_at).toLocaleString("pt-BR")} · passo: {a.customer?.conversation_step || "—"}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => resumeBot(a.customer_id)}>
                      Reativar bot
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => resolveAlert(a.id)}>
                      Resolvi
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Leads parados */}
      <Card className="p-4">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-500" />
          Parados há mais de 24h ({stuck.length})
        </h2>
        {stuck.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nenhum lead estagnado.</div>
        ) : (
          <ul className="space-y-1.5 max-h-96 overflow-auto text-sm">
            {stuck.map((s) => (
              <li key={s.id} className="flex items-center gap-2 py-1.5 px-2 hover:bg-muted/40 rounded">
                <MessageCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">
                  {s.name || "(sem nome)"} · <span className="text-muted-foreground">{s.phone_whatsapp}</span>
                </span>
                <Badge variant="outline" className="text-[10px]">{s.conversation_step}</Badge>
                <span className="text-xs text-amber-600 tabular-nums">{s.hours_stuck}h</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Funil */}
      <Card className="p-4">
        <h2 className="font-semibold mb-3">Onde seus leads estão agora</h2>
        {stepFunnel.length === 0 ? (
          <div className="text-sm text-muted-foreground">Sem dados.</div>
        ) : (
          <div className="space-y-1.5">
            {stepFunnel.map((s) => {
              const max = stepFunnel[0]?.total || 1;
              const pct = (s.total / max) * 100;
              return (
                <div key={s.step} className="flex items-center gap-2 text-sm">
                  <span className="w-44 truncate text-xs">{s.step}</span>
                  <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                    <div className="h-full bg-primary/70" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs tabular-nums w-10 text-right">{s.total}</span>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-3">
          Passos com muitos leads parados costumam indicar copy fraca ou regra confusa — revise no <Link to="/admin/fluxos" className="underline">editor de fluxo</Link>.
        </p>
      </Card>
    </div>
  );
}
