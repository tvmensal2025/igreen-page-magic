import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert, Loader2, Brain, Zap, Sparkles, Mic, BookCheck } from "lucide-react";

interface SettingsRow {
  key: string;
  value: string;
}

// Perfis de qualidade da IA (espelha ai-config.ts no backend).
type AiProfile = "fast" | "balanced" | "accuracy";
type AiProvider = "google" | "openai";

const PROFILE_OPTIONS: { id: AiProfile; label: string; desc: string; icon: typeof Zap }[] = [
  { id: "fast", label: "Rápido", desc: "Mais barato e veloz (modelos leves). Bom volume, respostas simples.", icon: Zap },
  { id: "balanced", label: "Equilibrado", desc: "Recomendado. Boa qualidade com custo controlado.", icon: Brain },
  { id: "accuracy", label: "Máxima qualidade", desc: "Modelos topo de linha. Respostas melhores, custo maior.", icon: Sparkles },
];

// Chaves persistidas em `settings`.
const KEYS = [
  "strict_script_mode",
  "ai_confidence_threshold_handoff",
  "ai_confidence_threshold_execute",
  "ai_profile_global",
  "ai_provider_global",
  "ai_kb_only_mode",
  "ai_audio_transcribe",
] as const;

export function AIControlPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [strict, setStrict] = useState(false);
  const [handoff, setHandoff] = useState(0.5);
  const [execute, setExecute] = useState(0.75);
  const [profile, setProfile] = useState<AiProfile>("balanced");
  const [provider, setProvider] = useState<AiProvider>("google");
  const [kbOnly, setKbOnly] = useState(true);
  const [audioTranscribe, setAudioTranscribe] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("key,value")
        .in("key", KEYS as unknown as string[]);
      if (!error && data) {
        const map: Record<string, string> = {};
        (data as SettingsRow[]).forEach((r) => (map[r.key] = String(r.value ?? "")));
        setStrict((map.strict_script_mode || "false").toLowerCase() === "true");
        setHandoff(parseFloat(map.ai_confidence_threshold_handoff || "0.5"));
        setExecute(parseFloat(map.ai_confidence_threshold_execute || "0.75"));
        const p = (map.ai_profile_global || "balanced").toLowerCase();
        setProfile(p === "fast" || p === "accuracy" ? (p as AiProfile) : "balanced");
        setProvider((map.ai_provider_global || "google").toLowerCase() === "openai" ? "openai" : "google");
        // Default true (segurança: prioriza respostas gravadas) quando ausente.
        setKbOnly((map.ai_kb_only_mode || "true").toLowerCase() === "true");
        setAudioTranscribe((map.ai_audio_transcribe || "true").toLowerCase() === "true");
      }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const rows = [
      { key: "strict_script_mode", value: strict ? "true" : "false" },
      { key: "ai_confidence_threshold_handoff", value: String(handoff) },
      { key: "ai_confidence_threshold_execute", value: String(execute) },
      { key: "ai_profile_global", value: profile },
      { key: "ai_provider_global", value: provider },
      { key: "ai_kb_only_mode", value: kbOnly ? "true" : "false" },
      { key: "ai_audio_transcribe", value: audioTranscribe ? "true" : "false" },
    ];
    const { error } = await supabase.from("settings").upsert(rows, { onConflict: "key" });
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Salvo", description: "Configurações de IA atualizadas (efetivo em até 60s)." });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Qualidade e provedor da IA ─────────────────────────────── */}
      <div className="bg-card/40 backdrop-blur border border-border/50 rounded-xl p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" />
          <h3 className="text-base font-semibold">Qualidade e custo da IA</h3>
        </div>

        {/* Perfil */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Nível de qualidade</Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {PROFILE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = profile === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setProfile(opt.id)}
                  className={`text-left rounded-xl border p-3 transition-colors ${
                    active
                      ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                      : "border-border/50 hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={`w-4 h-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="text-sm font-semibold">{opt.label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">{opt.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Provedor */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Provedor de IA</Label>
          <div className="flex gap-2">
            {(["google", "openai"] as const).map((pv) => (
              <button
                key={pv}
                type="button"
                onClick={() => setProvider(pv)}
                className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                  provider === pv
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30 text-primary"
                    : "border-border/50 hover:border-primary/40 text-muted-foreground"
                }`}
              >
                {pv === "google" ? "Google (Gemini) · mais barato" : "OpenAI (GPT)"}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Padrão Google: melhor custo-benefício e estável. OpenAI tende a custar mais.
          </p>
        </div>
      </div>

      {/* ── Boas respostas / segurança ──────────────────────────────── */}
      <div className="bg-card/40 backdrop-blur border border-border/50 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <BookCheck className="w-5 h-5 text-primary" />
          <h3 className="text-base font-semibold">Respostas e atendimento</h3>
        </div>

        <div className="flex items-start justify-between gap-4 p-3 rounded-lg bg-secondary/30 border border-border/40">
          <div className="space-y-1">
            <Label className="text-sm font-medium">Priorizar respostas gravadas (recomendado)</Label>
            <p className="text-xs text-muted-foreground max-w-md">
              A IA usa primeiro as respostas prontas da sua base de conhecimento (FAQ/atalhos).
              Reduz custo e evita respostas erradas. Só usa IA livre quando não há resposta gravada.
            </p>
          </div>
          <Switch checked={kbOnly} onCheckedChange={setKbOnly} />
        </div>

        <div className="flex items-start justify-between gap-4 p-3 rounded-lg bg-secondary/30 border border-border/40">
          <div className="space-y-1 flex items-start gap-2">
            <Mic className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <div>
              <Label className="text-sm font-medium">Entender áudios do cliente</Label>
              <p className="text-xs text-muted-foreground max-w-md">
                Quando o cliente manda áudio, transcreve para texto automaticamente e o bot
                responde normalmente. Se a transcrição falhar, pede gentilmente para escrever.
              </p>
            </div>
          </div>
          <Switch checked={audioTranscribe} onCheckedChange={setAudioTranscribe} />
        </div>
      </div>

      {/* ── Segurança / emergência (já existente) ───────────────────── */}
      <div className="bg-card/40 backdrop-blur border border-border/50 rounded-xl p-5 space-y-5">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-primary" />
          <h3 className="text-base font-semibold">Controle de Segurança da IA</h3>
        </div>

        <div className="flex items-start justify-between gap-4 p-3 rounded-lg bg-secondary/30 border border-border/40">
          <div className="space-y-1">
            <Label className="text-sm font-medium">Modo Estrito (desligamento de emergência)</Label>
            <p className="text-xs text-muted-foreground max-w-md">
              Quando ativo, a IA fica restrita ao script: nenhuma geração livre, só passos definidos no fluxo.
              Use em caso de respostas erradas/alucinação em massa.
            </p>
          </div>
          <Switch checked={strict} onCheckedChange={setStrict} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Threshold de Handoff (&lt;)</Label>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={handoff}
              onChange={(e) => setHandoff(parseFloat(e.target.value) || 0)}
            />
            <p className="text-[11px] text-muted-foreground">
              Confiança abaixo disso → transfere para humano.
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Threshold de Execução (≥)</Label>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={execute}
              onChange={(e) => setExecute(parseFloat(e.target.value) || 0)}
            />
            <p className="text-[11px] text-muted-foreground">
              Acima disso → executa a ação. Entre os dois → repergunta.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          Salvar configurações
        </Button>
      </div>
    </div>
  );
}
