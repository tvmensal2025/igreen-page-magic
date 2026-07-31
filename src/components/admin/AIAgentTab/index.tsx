import { useEffect, useState, lazy, Suspense } from "react";
import { Bot, MessagesSquare, Library, Loader2, Brain, Mic, FileText, BookOpen, HeartPulse } from "lucide-react";
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
import { MonthlyCostsCard } from "@/components/whatsapp/MonthlyCostsCard";
const AdminKnowledge = lazy(() => import("@/pages/AdminKnowledge"));

type SubTab = "atendimentos" | "agente" | "decisoes" | "desempenho" | "conhecimento";
type AgenteSub = "audios" | "midias" | "roteiro";

export function AIAgentTab({ userId, initialSubTab }: { userId: string; initialSubTab?: SubTab | null }) {
  const { toast } = useToast();
  const [sub, setSub] = useState<SubTab>(initialSubTab ?? "atendimentos");
  useEffect(() => { if (initialSubTab) setSub(initialSubTab); }, [initialSubTab]);
  const [agenteSub, setAgenteSub] = useState<AgenteSub>("audios");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  // Fonte da verdade do nome da IA = consultants.assistant_name (é o que as
  // edges usam). ai_agent_config.persona_name é só espelho legado.
  const [personaName, setPersonaName] = useState<string>("");
  const [savedPersonaName, setSavedPersonaName] = useState<string>("");
  const [savingPersona, setSavingPersona] = useState(false);
  const [savingEnabled, setSavingEnabled] = useState(false);

  useEffect(() => {
    (async () => {
      const [cfgRes, consRes] = await Promise.all([
        supabase.from("ai_agent_config").select("enabled, persona_name").eq("consultant_id", userId).maybeSingle(),
        supabase.from("consultants").select("assistant_name").eq("id", userId).maybeSingle(),
      ]);
      const data = cfgRes.data as any;
      setEnabled(data ? !!data.enabled : true);
      const nm =
        String((consRes.data as any)?.assistant_name || "").trim() ||
        String(data?.persona_name || "").trim();
      setPersonaName(nm);
      setSavedPersonaName(nm);
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

  // Salva só no clique. Grava em consultants.assistant_name (fonte usada pelas
  // ligações/mensagens) e espelha no ai_agent_config.
  async function savePersonaName() {
    const trimmed = personaName.trim();
    if (trimmed.length < 2) {
      toast({ title: "Nome muito curto", description: "Use pelo menos 2 letras.", variant: "destructive" });
      return;
    }
    setSavingPersona(true);
    try {
      const { error: consErr } = await supabase
        .from("consultants")
        .update({ assistant_name: trimmed })
        .eq("id", userId);
      if (consErr) throw consErr;
      const error = await saveConfig({ enabled: enabled ?? true, persona_name: trimmed });
      if (error) throw error;
      setPersonaName(trimmed);
      setSavedPersonaName(trimmed);
      toast({ title: "✅ Nome atualizado", description: `Sua IA agora se chama "${trimmed}".` });
    } catch (e: any) {
      const raw = e?.message || String(e);
      const friendly = /reservado/i.test(raw)
        ? `O nome "${trimmed}" já pertence à IA de outro consultor. Escolha outro (ex.: Bia, Lara, Nina).`
        : raw;
      toast({ title: "Erro ao salvar nome", description: friendly, variant: "destructive", duration: 8000 });
    } finally {
      setSavingPersona(false);
    }
  }


  const subs: { id: SubTab; label: string; icon: typeof Bot }[] = [
    { id: "atendimentos", label: "Atendimentos", icon: MessagesSquare },
    { id: "agente", label: "Agente & Mídias", icon: Library },
    { id: "decisoes", label: "Decisões da IA", icon: Brain },
    { id: "conhecimento", label: "Conhecimento", icon: BookOpen },
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
            Atendimento humanizado 24/7. Desligar bloqueia a IA para clientes interessados atuais e futuros.
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card">
          {savingEnabled || enabled === null ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          ) : null}
          <span className="text-xs font-medium text-foreground">IA ativa para meus clientes interessados</span>
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
        {sub === "conhecimento" && (
          <div className="h-full overflow-y-auto pr-1">
            <Suspense fallback={<div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
              <AdminKnowledge embedded />
            </Suspense>
          </div>
        )}
        {sub === "desempenho" && (
          <div className="h-full overflow-y-auto pr-1 space-y-4">
            <MonthlyCostsCard userId={userId} className="rounded-xl p-3 space-y-3" />
            <BotHealthDashboard userId={userId} />
          </div>
        )}
      </div>
    </div>
  );
}