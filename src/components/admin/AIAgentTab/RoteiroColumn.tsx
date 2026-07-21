import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Lock } from "lucide-react";

type Tab = "roteiro" | "faq";

export function RoteiroColumn({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("roteiro");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [faq, setFaq] = useState("");
  const [stepPrompts, setStepPrompts] = useState<Record<string, any>>({});
  const [cfgId, setCfgId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      setIsSuperAdmin(!!roles?.some((r: any) => r.role === "super_admin"));

      const { data } = await supabase
        .from("ai_agent_config")
        .select("*")
        .is("consultant_id", null)
        .maybeSingle();
      if (data) {
        setCfgId((data as any).id);
        setSystemPrompt((data as any).system_prompt || "");
        const sp = (data as any).step_prompts || {};
        setStepPrompts(sp);
        setFaq(sp?.faq || "");
      }
      setLoading(false);
    })();
  }, [userId]);

  async function save() {
    if (!isSuperAdmin) return;
    setSaving(true);
    const newSp = { ...(stepPrompts || {}), faq };
    const payload: any = { system_prompt: systemPrompt, step_prompts: newSp };
    let error;
    if (cfgId) {
      ({ error } = await supabase.from("ai_agent_config").update(payload).eq("id", cfgId));
    } else {
      ({ error } = await supabase
        .from("ai_agent_config")
        .insert({ ...payload, consultant_id: null, persona_name: "Camila" }));
    }
    setSaving(false);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else toast({ title: "✅ Roteiro salvo" });
  }

  const value = tab === "roteiro" ? systemPrompt : faq;
  const setValue = tab === "roteiro" ? setSystemPrompt : setFaq;

  return (
    <div className="flex flex-col h-full bg-card border border-border rounded-2xl overflow-hidden">
      <header className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h3 className="font-semibold text-foreground">Prompt / Roteiro de Vendas</h3>
          <p className="text-xs text-muted-foreground">
            {isSuperAdmin ? "Persona única usada por todos os consultores" : "Persona definida pelo Super Admin"}
          </p>
        </div>
        <div className="inline-flex items-center gap-1 p-1 bg-muted/40 rounded-lg border border-border/60">
          {(["roteiro", "faq"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs px-3 py-1.5 rounded-md uppercase tracking-wider transition-colors ${
                tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "roteiro" ? "Roteiro" : "FAQ"}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="flex-1 flex justify-center items-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="flex-1 p-4 min-h-0">
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              readOnly={!isSuperAdmin}
              spellCheck={false}
              className="w-full h-full resize-none rounded-xl border border-border/60 bg-muted/40 text-foreground font-mono text-[13px] leading-relaxed p-4 focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder={
                tab === "roteiro"
                  ? "# CONTEXTO E PERSONA\nVocê é Camila, consultora da iGreen Energy...\n\n# REGRAS\n1. ...\n\n# FLUXO DE ATENDIMENTO\n..."
                  : "Pergunta: ...\nResposta: ..."
              }
            />
          </div>

          <footer className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/20">
            <p className="text-[11px] text-muted-foreground">
              {value.length.toLocaleString("pt-BR")} caracteres
            </p>
            {isSuperAdmin ? (
              <Button onClick={save} disabled={saving} size="sm" className="gap-1.5">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Salvar
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Lock className="w-3 h-3" /> Somente leitura
              </span>
            )}
          </footer>
        </>
      )}
    </div>
  );
}