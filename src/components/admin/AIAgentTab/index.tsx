import { useEffect, useState } from "react";
import { Bot, MessagesSquare, Library, Loader2, Brain, Mic, FileText, BookOpen, Workflow, HeartPulse } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { LiveConversationsPanel } from "./LiveConversationsPanel";
import { MediaColumn } from "./MediaColumn";
import { RoteiroColumn } from "./RoteiroColumn";
import { AIDecisionsPanel } from "./AIDecisionsPanel";
import { SlotsPanel } from "./SlotsPanel";
import { BotTelemetryStrip } from "./BotTelemetryStrip";
import BotHealthDashboard from "@/components/admin/saude/BotHealthDashboard";

type SubTab = "atendimentos" | "agente" | "decisoes" | "desempenho";
type AgenteSub = "audios" | "midias" | "roteiro";

export function AIAgentTab({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [sub, setSub] = useState<SubTab>("atendimentos");
  const [agenteSub, setAgenteSub] = useState<AgenteSub>("audios");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [personaName, setPersonaName] = useState<string>("Camila");
  const [savingEnabled, setSavingEnabled] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("ai_agent_config")
        .select("enabled, persona_name")
        .eq("consultant_id", userId)
        .maybeSingle();
      setEnabled(data ? !!(data as any).enabled : true);
      if (data && (data as any).persona_name) {
        setPersonaName((data as any).persona_name);
      }
    })();
  }, [userId]);

  async function saveConfig(patch: { enabled?: boolean; persona_name?: string }) {
    const { data: existing } = await supabase
      .from("ai_agent_config")
      .select("id")
      .eq("consultant_id", userId)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await supabase
        .from("ai_agent_config")
        .update(patch)
        .eq("id", existing.id);
      return error;
    }
    const { error } = await supabase
      .from("ai_agent_config")
      .insert({
        consultant_id: userId,
        enabled: patch.enabled ?? true,
        persona_name: patch.persona_name ?? personaName,
      });
    return error;
  }

  async function toggleEnabled(v: boolean) {
    setSavingEnabled(true);
    setEnabled(v);
    const error = await saveConfig({ enabled: v, persona_name: personaName });
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      setEnabled(!v);
      setSavingEnabled(false);
      return;
    }

    // Propaga a decisão: ao desligar, pausa TODAS as conversas do consultor
    // (atuais e qualquer status). Ao religar, libera só as pausadas globalmente.
    try {
      if (!v) {
        const { error: pErr, count } = await supabase
          .from("customers")
          .update(
            {
              bot_paused: true,
              bot_paused_reason: "manual_global_pause",
              bot_paused_at: new Date().toISOString(),
              bot_paused_until: null,
              assigned_human_id: userId,
              updated_at: new Date().toISOString(),
            },
            { count: "exact" },
          )
          .eq("consultant_id", userId);
        if (pErr) throw pErr;
        toast({
          title: "🛑 IA desligada",
          description: `${count ?? 0} lead(s) silenciados. Leads novos também não receberão mensagens automáticas.`,
        });
      } else {
        const { error: rErr, count } = await supabase
          .from("customers")
          .update(
            {
              bot_paused: false,
              bot_paused_reason: null,
              bot_paused_at: null,
              bot_paused_until: null,
              assigned_human_id: null,
              updated_at: new Date().toISOString(),
            },
            { count: "exact" },
          )
          .eq("consultant_id", userId)
          .eq("bot_paused", true)
          .in("bot_paused_reason", ["manual_global_pause", "humano_assumiu_backfill"]);
        if (rErr) throw rErr;
        toast({ title: "🤖 IA reativada", description: `${count ?? 0} lead(s) religados.` });
      }
    } catch (e: any) {
      toast({ title: "Config salva, mas falhou ao propagar", description: e?.message, variant: "destructive" });
    } finally {
      setSavingEnabled(false);
    }
  }

  async function savePersonaName() {
    const error = await saveConfig({ enabled: enabled ?? true, persona_name: personaName });
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "✅ Nome atualizado" });
    }
  }

  const subs: { id: SubTab; label: string; icon: typeof Bot }[] = [
    { id: "atendimentos", label: "Atendimentos", icon: MessagesSquare },
    { id: "agente", label: "Agente & Mídias", icon: Library },
    { id: "decisoes", label: "Decisões da IA", icon: Brain },
    { id: "desempenho", label: "Desempenho & Saúde", icon: HeartPulse },
  ];

  return (
    <div className="flex flex-col h-full gap-4">
      <header className="flex items-center gap-3 flex-wrap">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
          <Bot className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold font-heading text-foreground">Atendente IA — </h1>
            <input
              type="text"
              value={personaName}
              onChange={(e) => setPersonaName(e.target.value)}
              onBlur={savePersonaName}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
              className="text-lg font-bold font-heading text-foreground bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none px-1 -mx-1 w-32"
              maxLength={20}
              title="Clique para renomear (só você vê esse nome)"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Atendimento humanizado 24/7. Desligar bloqueia a IA para leads atuais e futuros.
          </p>
        </div>
        <Link
          to="/admin/fluxos"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium transition-colors"
        >
          <Workflow className="w-3.5 h-3.5" />
          Construtor de Fluxos
        </Link>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card">
          {savingEnabled || enabled === null ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          ) : null}
          <span className="text-xs font-medium text-foreground">IA ativa para meus leads</span>
          <Switch
            checked={!!enabled}
            disabled={enabled === null || savingEnabled}
            onCheckedChange={toggleEnabled}
          />
        </div>
      </header>

      <nav className="flex gap-1 border-b border-border">
        {subs.map((s) => {
          const Icon = s.icon;
          const active = sub === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSub(s.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {s.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 min-h-0">
        {sub === "atendimentos" && (
          <div className="flex flex-col h-full gap-3">
            <BotTelemetryStrip userId={userId} />
            <div className="flex-1 min-h-0"><LiveConversationsPanel userId={userId} /></div>
          </div>
        )}
        {sub === "agente" && (
          <div className="flex flex-col h-full gap-3">
            <div className="flex gap-1 flex-wrap">
              {[
                { id: "audios" as const, label: `Áudios de ${personaName}`, icon: Mic },
                { id: "midias" as const, label: "Mídias livres", icon: FileText },
                { id: "roteiro" as const, label: "Roteiro", icon: BookOpen },
              ].map((t) => {
                const Icon = t.icon;
                const active = agenteSub === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setAgenteSub(t.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {agenteSub === "audios" && <SlotsPanel userId={userId} />}
              {agenteSub === "midias" && <MediaColumn userId={userId} />}
              {agenteSub === "roteiro" && <RoteiroColumn userId={userId} />}
            </div>
          </div>
        )}
        {sub === "decisoes" && <AIDecisionsPanel userId={userId} />}
        {sub === "desempenho" && (
          <div className="h-full overflow-y-auto pr-1">
            <BotHealthDashboard userId={userId} />
          </div>
        )}
      </div>
    </div>
  );
}