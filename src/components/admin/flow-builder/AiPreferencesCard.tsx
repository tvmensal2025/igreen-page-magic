import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Bot, Loader2, Save, Sparkles, Target, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  consultantId: string | null;
}

type AiProfile = "auto" | "accuracy" | "balanced" | "fast";
type AiProvider = "google" | "openai";

const PROFILES: Array<{
  v: AiProfile;
  label: string;
  models: string;
  sub: string;
  icon: any;
  color: string;
}> = [
  {
    v: "auto",
    label: "Automático (recomendado)",
    models: "Roteamento inteligente",
    sub: "Pergunta simples → modelo barato. Pergunta complexa → modelo preciso. Padrão para reduzir custo mantendo qualidade.",
    icon: Sparkles,
    color: "text-primary",
  },
  {
    v: "accuracy",
    label: "Precisão máxima",
    models: "Gemini 3.1 Pro / GPT-5.5",
    sub: "Respostas mais inteligentes. Custo maior, latência ~2-3s.",
    icon: Target,
    color: "text-info",
  },
  {
    v: "balanced",
    label: "Equilibrado",
    models: "Gemini 3.5 Flash / GPT-5",
    sub: "Latência ~1-2s.",
    icon: Sparkles,
    color: "text-info",
  },
  {
    v: "fast",
    label: "Rápido e barato",
    models: "Gemini 2.5 Flash-Lite",
    sub: "Latência <1s. Volume alto e dúvidas simples.",
    icon: Zap,
    color: "text-warning",
  },
];


export default function AiPreferencesCard({ consultantId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<AiProfile>("auto");
  const [provider, setProvider] = useState<AiProvider>("google");
  const [originalProfile, setOriginalProfile] = useState<AiProfile>("auto");

  const [originalProvider, setOriginalProvider] = useState<AiProvider>("google");

  useEffect(() => {
    if (!consultantId) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("consultants")
        .select("ai_profile, ai_provider_pref" as any)
        .eq("id", consultantId)
        .maybeSingle();
      const p = String((data as any)?.ai_profile || "auto") as AiProfile;
      const pr = String((data as any)?.ai_provider_pref || "google") as AiProvider;
      const safeP: AiProfile = (["auto", "accuracy", "balanced", "fast"] as const).includes(p as any) ? p : "auto";

      const safePr = (["google", "openai"] as const).includes(pr) ? pr : "google";
      setProfile(safeP);
      setProvider(safePr);
      setOriginalProfile(safeP);
      setOriginalProvider(safePr);
      setLoading(false);
    })();
  }, [consultantId]);

  const dirty = profile !== originalProfile || provider !== originalProvider;

  async function save() {
    if (!consultantId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("consultants")
        .update({ ai_profile: profile, ai_provider_pref: provider } as any)
        .eq("id", consultantId);
      if (error) throw error;
      setOriginalProfile(profile);
      setOriginalProvider(provider);
      toast.success("Preferências de IA salvas");
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes("ai_profile") || msg.includes("column")) {
        toast.error(
          "Migration faltando. Cole APLICAR_AGORA_2.sql no Supabase SQL Editor primeiro.",
        );
      } else {
        toast.error("Erro ao salvar: " + msg);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bot className="h-4 w-4 text-primary" />
          Preferências de IA
          {dirty && (
            <Badge variant="secondary" className="ml-auto text-[10px]">
              Não salvo
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Provedor</Label>
          <RadioGroup
            value={provider}
            onValueChange={(v) => setProvider(v as AiProvider)}
            className="grid grid-cols-2 gap-2"
            disabled={saving}
          >
            {[
              { v: "google" as const, label: "Google Gemini", note: "Default — mais barato" },
              { v: "openai" as const, label: "OpenAI GPT", note: "Latência menor em alguns casos" },
            ].map((o) => (
              <label
                key={o.v}
                className={`flex cursor-pointer flex-col gap-0.5 rounded-md border p-2 text-xs transition-colors ${
                  provider === o.v
                    ? "border-primary bg-primary/5"
                    : "hover:border-muted-foreground/30"
                }`}
              >
                <RadioGroupItem value={o.v} className="sr-only" />
                <span className="font-medium">{o.label}</span>
                <span className="text-[10px] text-muted-foreground">{o.note}</span>
              </label>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Perfil</Label>
          <RadioGroup
            value={profile}
            onValueChange={(v) => setProfile(v as AiProfile)}
            className="space-y-1.5"
            disabled={saving}
          >
            {PROFILES.map((p) => {
              const Icon = p.icon;
              return (
                <label
                  key={p.v}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 transition-colors ${
                    profile === p.v
                      ? "border-primary bg-primary/5"
                      : "hover:border-muted-foreground/30"
                  }`}
                >
                  <RadioGroupItem value={p.v} className="mt-0.5" />
                  <Icon className={`mt-0.5 h-3.5 w-3.5 ${p.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">{p.label}</div>
                    <div className="text-[10px] text-muted-foreground">{p.models}</div>
                    <div className="text-[10px] text-muted-foreground">{p.sub}</div>
                  </div>
                </label>
              );
            })}
          </RadioGroup>
        </div>

        <Button
          onClick={save}
          disabled={!dirty || saving}
          size="sm"
          className="w-full"
        >
          {saving ? (
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          ) : (
            <Save className="mr-2 h-3 w-3" />
          )}
          Salvar preferências
        </Button>

        <p className="text-[10px] text-muted-foreground">
          Aplica em todos os fluxos deste consultor — bloco de IA de dúvidas, intent
          classifier e respostas de fallback.
        </p>
      </CardContent>
    </Card>
  );
}
